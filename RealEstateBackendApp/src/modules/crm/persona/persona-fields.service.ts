import { HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { ClientSession, Connection, Model, Types } from 'mongoose';
import type { JwtPayload } from '../../../common/decorators/current-user.decorator';
import { PaginationMetaDto } from '../../../common/dto/paginated-response.dto';
import { BusinessException } from '../../../common/exceptions/business.exception';
import { ErrorCode } from '../../../common/exceptions/error-codes';
import { isDuplicateKeyError } from '../../../common/utils/mongo-error.util';
import {
  buildPaginationMeta,
  normalizePagination,
} from '../../../common/utils/pagination.util';
import { withTransaction } from '../../../shared/database/with-transaction.util';
import { diffFields } from '../audit-logs/audit-diff.util';
import {
  CrmAuditAction,
  CrmAuditChange,
  CrmAuditEntityType,
} from '../audit-logs/crm-audit.constants';
import { CrmAuditLogService } from '../audit-logs/crm-audit-log.service';
import {
  Customer,
  CustomerDocument,
} from '../customers/schemas/customer.schema';
import {
  CreatePersonaFieldDto,
  ListPersonaFieldsQueryDto,
  PersonaFieldResponseDto,
  ReorderPersonaFieldsDto,
  UpdatePersonaFieldDto,
} from './dtos/persona-field.dto';
import { PersonaConfigService } from './persona-config.service';
import { PersonaRecomputeService } from './persona-recompute.service';
import { OPTION_FIELD_TYPES } from './persona.constants';
import { findFieldShapeError, mergeOptions } from './persona.rules';
import {
  PersonaField,
  PersonaFieldDocument,
  PersonaFieldLean,
} from './schemas/persona-field.schema';

/** Thuộc tính ghi vào audit khi tạo/sửa trường. */
const AUDIT_FIELDS = [
  'label',
  'helpText',
  'placeholder',
  'groupCode',
  'type',
  'options',
  'weight',
  'suggestPriority',
  'isFilterable',
  'isOccasion',
  'occasionLabel',
  'linkedCriterion',
  'isSensitive',
  'isActive',
] as const;

/** Thuộc tính sửa được qua PATCH (khóa `key` bất biến; `options` xử lý riêng vì là danh sách mong muốn). */
const PATCHABLE_FIELDS = [
  'label',
  'groupCode',
  'type',
  'helpText',
  'placeholder',
  'weight',
  'suggestPriority',
  'isFilterable',
  'isOccasion',
  'occasionLabel',
  'linkedCriterion',
  'isSensitive',
  'isActive',
] as const;

/** Thuộc tính quyết định "hình dạng" hợp lệ của trường (`findFieldShapeError`): chỉ kiểm lại khi PATCH đụng tới. */
const SHAPE_FIELDS = [
  'type',
  'options',
  'isFilterable',
  'isOccasion',
  'isSensitive',
] as const;

/** Đổi các thuộc tính này làm lệch độ đầy đủ/token lọc/dịp đặc biệt của khách => phải tính lại. */
const DERIVED_FIELDS: readonly string[] = [
  'weight',
  'isActive',
  'isFilterable',
  'isOccasion',
  'isSensitive',
  'type',
];

export const toPersonaFieldResponse = (
  doc: PersonaFieldLean,
): PersonaFieldResponseDto => ({
  id: String(doc._id),
  key: doc.key,
  label: doc.label,
  helpText: doc.helpText ?? null,
  placeholder: doc.placeholder ?? null,
  groupCode: doc.groupCode,
  type: doc.type,
  options: (doc.options ?? []).map((option) => ({
    value: option.value,
    label: option.label,
    isActive: option.isActive,
  })),
  order: doc.order,
  weight: doc.weight,
  suggestPriority: doc.suggestPriority,
  isFilterable: doc.isFilterable,
  isOccasion: doc.isOccasion,
  occasionLabel: doc.occasionLabel ?? null,
  linkedCriterion: doc.linkedCriterion ?? null,
  isSensitive: doc.isSensitive,
  isSystem: doc.isSystem,
  isActive: doc.isActive,
});

const validationFailed = (message: string, field: string) =>
  new BusinessException(
    ErrorCode.VALIDATION_FAILED,
    message,
    HttpStatus.BAD_REQUEST,
    { field },
  );

/**
 * Cấu hình trường chân dung (X10): Quản trị tự thêm, sửa, bớt trường mà không cần lập trình.
 *
 * Nguyên tắc "đổi cấu hình không mất dữ liệu cũ": không có thao tác nào ở đây ghi vào `customers.persona`.
 * Bớt trường = tắt hoặc xóa mềm; bớt lựa chọn = `isActive: false`; đổi kiểu bị chặn khi đã có dữ liệu. Sau mỗi thay
 * đổi ảnh hưởng độ đầy đủ/token lọc/dịp đặc biệt, phiên bản cấu hình tăng và job nền tính lại cho khách.
 */
@Injectable()
export class PersonaFieldsService {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(PersonaField.name)
    private readonly fieldModel: Model<PersonaFieldDocument>,
    @InjectModel(Customer.name)
    private readonly customerModel: Model<CustomerDocument>,
    private readonly config: PersonaConfigService,
    private readonly recompute: PersonaRecomputeService,
    private readonly audit: CrmAuditLogService,
  ) {}

  async list(
    query: ListPersonaFieldsQueryDto,
  ): Promise<{ data: PersonaFieldResponseDto[]; meta: PaginationMetaDto }> {
    const { page, limit, skip } = normalizePagination(query.page, query.limit);
    const filter: Record<string, unknown> = { deletedAt: null };
    if (query.isActive !== undefined) filter.isActive = query.isActive;
    if (query.groupCode) filter.groupCode = query.groupCode;

    const [docs, total] = await Promise.all([
      this.fieldModel
        .find(filter)
        .sort({ order: 1, _id: 1 })
        .skip(skip)
        .limit(limit)
        .lean()
        .exec(),
      this.fieldModel.countDocuments(filter).exec(),
    ]);
    return {
      data: (docs as PersonaFieldLean[]).map(toPersonaFieldResponse),
      meta: buildPaginationMeta(total, page, limit),
    };
  }

  async create(
    jwt: JwtPayload,
    dto: CreatePersonaFieldDto,
  ): Promise<PersonaFieldResponseDto> {
    const options = (dto.options ?? []).map((option) => ({
      value: option.value,
      label: option.label,
      isActive: option.isActive ?? true,
    }));
    const shapeError = findFieldShapeError({
      type: dto.type,
      options,
      isFilterable: dto.isFilterable ?? false,
      isOccasion: dto.isOccasion ?? false,
      isSensitive: dto.isSensitive ?? false,
    });
    if (shapeError) throw validationFailed(shapeError, 'type');
    await this.assertGroupExists(dto.groupCode);
    await this.config.ensureState();

    try {
      const created = await withTransaction(
        this.connection,
        async (session) => {
          const [doc] = await this.fieldModel.create(
            [
              {
                key: dto.key,
                label: dto.label,
                helpText: dto.helpText ?? null,
                placeholder: dto.placeholder ?? null,
                groupCode: dto.groupCode,
                type: dto.type,
                options,
                order: await this.nextOrder(session),
                weight: dto.weight ?? 1,
                suggestPriority: dto.suggestPriority ?? 50,
                isFilterable: dto.isFilterable ?? false,
                isOccasion: dto.isOccasion ?? false,
                occasionLabel: dto.occasionLabel ?? null,
                linkedCriterion: dto.linkedCriterion ?? null,
                isSensitive: dto.isSensitive ?? false,
                isSystem: false,
                isActive: true,
                createdBy: new Types.ObjectId(jwt.sub),
              },
            ],
            { session },
          );
          await this.config.bumpVersion(session);
          await this.audit.record(
            {
              entityType: CrmAuditEntityType.PERSONA_FIELD,
              entityId: doc._id,
              action: CrmAuditAction.PERSONA_FIELD_CREATED,
              actor: jwt,
              changes: [
                { field: 'key', from: null, to: doc.key },
                ...diffFields({}, doc.toObject(), AUDIT_FIELDS),
              ],
            },
            session,
          );
          return doc.toObject();
        },
      );
      void this.recompute.run();
      return toPersonaFieldResponse(created);
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        throw new BusinessException(
          ErrorCode.CATALOG_DUPLICATED,
          `Khóa trường "${dto.key}" đã tồn tại (kể cả trường đã xóa), hãy dùng khóa khác`,
          HttpStatus.CONFLICT,
          { field: 'key', value: dto.key },
        );
      }
      throw error;
    }
  }

  async update(
    jwt: JwtPayload,
    id: string,
    dto: UpdatePersonaFieldDto,
  ): Promise<PersonaFieldResponseDto> {
    await this.config.ensureState();
    const result = await withTransaction(this.connection, async (session) => {
      const before = await this.findLive(id, session);
      const typeChanged = dto.type !== undefined && dto.type !== before.type;
      if (typeChanged) await this.assertTypeUnlocked(before.key, session);

      const nextType = dto.type ?? before.type;
      const nextOptions = OPTION_FIELD_TYPES.includes(nextType)
        ? dto.options
          ? mergeOptions(before.options ?? [], dto.options)
          : (before.options ?? [])
        : (dto.options ?? []);
      const patch: Record<string, unknown> = {};
      for (const key of PATCHABLE_FIELDS) {
        if (dto[key] !== undefined) patch[key] = dto[key];
      }
      if (dto.options !== undefined || typeChanged) patch.options = nextOptions;

      const next = { ...before, ...patch } as PersonaFieldLean;
      // Chỉ kiểm hình dạng khi PATCH đụng vào thuộc tính của nó: trường dữ liệu cũ có tổ hợp không còn hợp lệ
      // (vd nhạy cảm + lọc được) vẫn phải tắt/đổi nhãn/sắp xếp được mà không bị 400.
      const touchesShape = SHAPE_FIELDS.some((key) => key in patch);
      const shapeError = touchesShape
        ? findFieldShapeError({
            type: next.type,
            options: next.options,
            isFilterable: next.isFilterable,
            isOccasion: next.isOccasion,
            isSensitive: next.isSensitive,
          })
        : null;
      if (shapeError) throw validationFailed(shapeError, 'type');
      if (dto.groupCode && dto.groupCode !== before.groupCode) {
        await this.assertGroupExists(dto.groupCode, session);
      }

      const changes = diffFields(before, next, AUDIT_FIELDS);
      if (changes.length === 0) return { doc: before, derivedChanged: false };

      const after = (await this.fieldModel
        .findOneAndUpdate(
          { _id: before._id },
          { $set: patch },
          { returnDocument: 'after', session },
        )
        .lean()
        .exec()) as PersonaFieldLean;
      const derivedChanged = changes.some((change) =>
        DERIVED_FIELDS.includes(change.field),
      );
      if (derivedChanged) await this.config.bumpVersion(session);
      await this.audit.record(
        {
          entityType: CrmAuditEntityType.PERSONA_FIELD,
          entityId: before._id,
          action: CrmAuditAction.PERSONA_FIELD_UPDATED,
          actor: jwt,
          changes,
        },
        session,
      );
      return { doc: after, derivedChanged };
    });
    if (result.derivedChanged) void this.recompute.run();
    return toPersonaFieldResponse(result.doc);
  }

  /**
   * "Bớt trường": xóa mềm. Giá trị khách đã nhập vẫn nằm nguyên trong `customers.persona` (chỉ không còn hiển thị và
   * không tính vào độ đầy đủ). Khóa trường vẫn được giữ chỗ nên không tạo lại cùng khóa với kiểu khác. Trường hệ thống
   * (seed) chỉ tắt được, không xóa.
   */
  async remove(jwt: JwtPayload, id: string): Promise<void> {
    await this.config.ensureState();
    await withTransaction(this.connection, async (session) => {
      const field = await this.findLive(id, session);
      if (field.isSystem) {
        throw new BusinessException(
          ErrorCode.PERSONA_FIELD_SYSTEM,
          'Không thể xóa trường hệ thống, hãy tắt hoạt động nếu không dùng',
          HttpStatus.CONFLICT,
          { valueCount: await this.countValues(field.key, session) },
        );
      }
      await this.fieldModel
        .updateOne(
          { _id: field._id },
          { $set: { deletedAt: new Date(), isActive: false } },
          { session },
        )
        .exec();
      await this.config.bumpVersion(session);
      await this.audit.record(
        {
          entityType: CrmAuditEntityType.PERSONA_FIELD,
          entityId: field._id,
          action: CrmAuditAction.PERSONA_FIELD_DELETED,
          actor: jwt,
          changes: [{ field: 'key', from: field.key, to: null }],
        },
        session,
      );
    });
    void this.recompute.run();
  }

  /** Sắp lại thứ tự (và chuyển nhóm) hàng loạt; trả toàn bộ trường theo thứ tự mới. */
  async reorder(
    jwt: JwtPayload,
    dto: ReorderPersonaFieldsDto,
  ): Promise<PersonaFieldResponseDto[]> {
    const ids = dto.items.map((item) => new Types.ObjectId(item.id));
    return withTransaction(this.connection, async (session) => {
      const found = (await this.fieldModel
        .find({ _id: { $in: ids }, deletedAt: null })
        .session(session)
        .lean()
        .exec()) as PersonaFieldLean[];
      if (found.length !== ids.length) {
        throw new NotFoundException('Có trường không tồn tại hoặc đã bị xóa');
      }
      const groupCodes = new Set(
        (await this.config.loadGroups(session)).map((group) => group.code),
      );
      const byId = new Map(found.map((field) => [String(field._id), field]));
      const changes: CrmAuditChange[] = [];
      const operations = dto.items.flatMap((item) => {
        const field = byId.get(item.id)!;
        if (item.groupCode && !groupCodes.has(item.groupCode)) {
          throw validationFailed('Nhóm trường không tồn tại', 'groupCode');
        }
        const groupCode = item.groupCode ?? field.groupCode;
        if (field.order === item.order && field.groupCode === groupCode) {
          return [];
        }
        changes.push({
          field: field.key,
          from: { order: field.order, groupCode: field.groupCode },
          to: { order: item.order, groupCode },
        });
        return [
          {
            updateOne: {
              filter: { _id: field._id },
              update: { $set: { order: item.order, groupCode } },
            },
          },
        ];
      });
      if (operations.length > 0) {
        await this.fieldModel.bulkWrite(operations, { session });
        await this.audit.record(
          {
            entityType: CrmAuditEntityType.PERSONA_FIELD,
            entityId: ids[0],
            action: CrmAuditAction.PERSONA_FIELDS_REORDERED,
            actor: jwt,
            changes,
          },
          session,
        );
      }
      const all = (await this.fieldModel
        .find({ deletedAt: null })
        .sort({ order: 1, _id: 1 })
        .session(session)
        .lean()
        .exec()) as PersonaFieldLean[];
      return all.map(toPersonaFieldResponse);
    });
  }

  /** Số khách (kể cả đã xóa mềm — khôi phục vẫn cần dữ liệu) đang có giá trị của trường. */
  private countValues(key: string, session: ClientSession): Promise<number> {
    return this.customerModel
      .countDocuments({ 'persona.fieldKey': key })
      .session(session)
      .exec();
  }

  private async assertTypeUnlocked(
    key: string,
    session: ClientSession,
  ): Promise<void> {
    const valueCount = await this.countValues(key, session);
    if (valueCount > 0) {
      throw new BusinessException(
        ErrorCode.PERSONA_FIELD_TYPE_LOCKED,
        'Trường đã có dữ liệu của khách nên không đổi kiểu được; hãy tạo trường mới',
        HttpStatus.CONFLICT,
        { valueCount },
      );
    }
  }

  private async findLive(
    id: string,
    session: ClientSession,
  ): Promise<PersonaFieldLean> {
    const field = (await this.fieldModel
      .findOne({ _id: new Types.ObjectId(id), deletedAt: null })
      .session(session)
      .lean()
      .exec()) as PersonaFieldLean | null;
    if (!field) throw new NotFoundException('Không tìm thấy trường chân dung');
    return field;
  }

  private async assertGroupExists(
    groupCode: string,
    session?: ClientSession,
  ): Promise<void> {
    const groups = await this.config.loadGroups(session);
    if (!groups.some((group) => group.code === groupCode)) {
      throw validationFailed(
        `Nhóm trường "${groupCode}" không tồn tại`,
        'groupCode',
      );
    }
  }

  private async nextOrder(session: ClientSession): Promise<number> {
    const last = await this.fieldModel
      .findOne({})
      .sort({ order: -1 })
      .select('order')
      .session(session)
      .lean()
      .exec();
    return (last?.order ?? 0) + 1;
  }
}
