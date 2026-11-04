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
import { escapeRegex } from '../../../common/utils/regex.util';
import { withTransaction } from '../../../shared/database/with-transaction.util';
import { diffFields } from '../audit-logs/audit-diff.util';
import {
  CrmAuditAction,
  CrmAuditEntityType,
} from '../audit-logs/crm-audit.constants';
import { CrmAuditLogService } from '../audit-logs/crm-audit-log.service';
import { CrmRateLimitService } from '../common/security/crm-rate-limit.service';
import { parseSort } from '../common/utils/sort-parser.util';
import { normalizeVietnamese } from '../common/utils/vietnamese-text.util';
import {
  Customer,
  CustomerDocument,
} from '../customers/schemas/customer.schema';
import {
  CreateTagDto,
  ListTagsQueryDto,
  TagResponseDto,
  UpdateTagDto,
} from './dtos/tag.dto';
import { Tag, TagDocument, TagLean } from './schemas/tag.schema';
import { cleanTagName, normalizeTagName } from './tag.rules';

const SORTABLE_FIELDS = ['name', 'usageCount'] as const;
const VIETNAMESE_COLLATION = { locale: 'vi' } as const;
const AUDIT_FIELDS = ['name', 'category', 'color'] as const;

export const toTagResponse = (doc: TagLean): TagResponseDto => ({
  id: String(doc._id),
  label: doc.name,
  category: doc.category,
  usageCount: Math.max(doc.usageCount ?? 0, 0),
  color: doc.color ?? null,
});

const tagNotFound = () => new NotFoundException('Không tìm thấy thẻ');

const duplicated = (name: string) =>
  new BusinessException(
    ErrorCode.CATALOG_DUPLICATED,
    `Thẻ "${name}" đã tồn tại trong nhóm này, hãy dùng chức năng gộp thẻ`,
    HttpStatus.CONFLICT,
    { field: 'name', value: name },
  );

/**
 * Thẻ sở thích/nghề nghiệp (C11). Mọi vai trò CRM xem và tạo thẻ mới khi gắn; chỉ Quản trị sửa, xóa, gộp.
 *
 * Xóa/gộp gỡ thẻ khỏi khách NGAY trong cùng transaction (thay cho "job nền" của tài liệu, vì chưa có BullMQ ở M4):
 * không có thời điểm nào khách còn gắn thẻ đã xóa/đã gộp và `usageCount` luôn khớp. Thao tác đổi `customers` ở đây
 * không tăng `__v`/`lastUpdatedAt` (hành động hệ thống của Quản trị, không phải sửa hồ sơ từng khách).
 */
@Injectable()
export class TagsService {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(Tag.name) private readonly tagModel: Model<TagDocument>,
    @InjectModel(Customer.name)
    private readonly customerModel: Model<CustomerDocument>,
    private readonly audit: CrmAuditLogService,
    private readonly rateLimit: CrmRateLimitService,
  ) {}

  async list(
    query: ListTagsQueryDto,
  ): Promise<{ data: TagResponseDto[]; meta: PaginationMetaDto }> {
    const { page, limit, skip } = normalizePagination(query.page, query.limit);
    const sort = parseSort(query.sort, SORTABLE_FIELDS, {
      field: 'name',
      direction: 1,
    });
    const filter: Record<string, unknown> = { deletedAt: null };
    if (query.category) filter.category = query.category;
    const keyword = query.q ? normalizeVietnamese(query.q) : '';
    if (keyword) {
      filter.nameNormalized = new RegExp(escapeRegex(keyword));
    }

    const [docs, total] = await Promise.all([
      this.tagModel
        .find(filter)
        .sort({ [sort.field]: sort.direction, _id: 1 })
        .collation(VIETNAMESE_COLLATION)
        .skip(skip)
        .limit(limit)
        .lean()
        .exec(),
      this.tagModel.countDocuments(filter).exec(),
    ]);
    return {
      data: (docs as TagLean[]).map(toTagResponse),
      meta: buildPaginationMeta(total, page, limit),
    };
  }

  /** Tạo thẻ; trùng tên đã chuẩn hóa trong cùng nhóm thì trả thẻ có sẵn (`created: false`). */
  async create(
    jwt: JwtPayload,
    dto: CreateTagDto,
  ): Promise<{ tag: TagResponseDto; created: boolean }> {
    await this.rateLimit.consume(jwt.sub, 'TAG_CREATE');
    const { name, nameNormalized } = this.prepareName(dto.name);

    const existing = await this.findLiveByName(dto.category, nameNormalized);
    if (existing) return { tag: toTagResponse(existing), created: false };

    try {
      const created = await withTransaction(
        this.connection,
        async (session) => {
          const [doc] = await this.tagModel.create(
            [
              {
                name,
                nameNormalized,
                category: dto.category,
                usageCount: 0,
                createdBy: new Types.ObjectId(jwt.sub),
              },
            ],
            { session },
          );
          await this.audit.record(
            {
              entityType: CrmAuditEntityType.TAG,
              entityId: doc._id,
              action: CrmAuditAction.TAG_CREATED,
              actor: jwt,
              changes: diffFields({}, doc.toObject(), AUDIT_FIELDS),
            },
            session,
          );
          return doc.toObject();
        },
      );
      return { tag: toTagResponse(created), created: true };
    } catch (error) {
      if (!isDuplicateKeyError(error)) throw error;
      // Hai người tạo cùng tên đồng thời: bên thua nhận thẻ của bên thắng.
      const winner = await this.findLiveByName(dto.category, nameNormalized);
      if (!winner) throw error;
      return { tag: toTagResponse(winner), created: false };
    }
  }

  async update(
    jwt: JwtPayload,
    id: string,
    dto: UpdateTagDto,
  ): Promise<TagResponseDto> {
    if (dto.mergeIntoId) {
      if (
        dto.name !== undefined ||
        dto.category !== undefined ||
        dto.color !== undefined
      ) {
        throw new BusinessException(
          ErrorCode.VALIDATION_FAILED,
          'Gộp thẻ không đi kèm sửa tên, nhóm hoặc màu',
          HttpStatus.BAD_REQUEST,
          { field: 'mergeIntoId' },
        );
      }
      return this.merge(jwt, id, dto.mergeIntoId);
    }

    const requested =
      dto.name === undefined ? undefined : this.prepareName(dto.name);
    // Tên dùng trong thông báo trùng: tên MỚI sẽ có sau khi sửa (đổi riêng nhóm thì là tên hiện tại của thẻ).
    let collidingName = '';
    try {
      return await withTransaction(this.connection, async (session) => {
        const before = await this.findLive(id, session);
        const next = {
          name: requested?.name ?? before.name,
          nameNormalized: requested?.nameNormalized ?? before.nameNormalized,
          category: dto.category ?? before.category,
          color: dto.color === undefined ? (before.color ?? null) : dto.color,
        };
        collidingName = next.name;
        const changes = diffFields(before, next, AUDIT_FIELDS);
        if (changes.length === 0) return toTagResponse(before);

        const after = (await this.tagModel
          .findOneAndUpdate(
            { _id: before._id },
            { $set: next },
            { returnDocument: 'after', session },
          )
          .lean()
          .exec()) as TagLean;
        await this.audit.record(
          {
            entityType: CrmAuditEntityType.TAG,
            entityId: before._id,
            action: CrmAuditAction.TAG_UPDATED,
            actor: jwt,
            changes,
          },
          session,
        );
        return toTagResponse(after);
      });
    } catch (error) {
      if (isDuplicateKeyError(error)) throw duplicated(collidingName);
      throw error;
    }
  }

  /** Xóa mềm thẻ và gỡ khỏi mọi khách trong cùng transaction. */
  async remove(jwt: JwtPayload, id: string): Promise<void> {
    await withTransaction(this.connection, async (session) => {
      const tag = await this.findLive(id, session);
      const detached = await this.customerModel
        .updateMany(
          { tagIds: tag._id },
          { $pull: { tagIds: tag._id } },
          { session, timestamps: false },
        )
        .exec();
      await this.tagModel
        .updateOne(
          { _id: tag._id },
          { $set: { deletedAt: new Date(), usageCount: 0 } },
          { session },
        )
        .exec();
      await this.audit.record(
        {
          entityType: CrmAuditEntityType.TAG,
          entityId: tag._id,
          action: CrmAuditAction.TAG_DELETED,
          actor: jwt,
          changes: [
            { field: 'name', from: tag.name, to: null },
            { field: 'customers', from: detached.modifiedCount, to: 0 },
          ],
        },
        session,
      );
    });
  }

  /**
   * Gộp `sourceId` vào `targetId`: khách đang gắn thẻ nguồn chuyển sang thẻ đích (khách gắn cả hai chỉ còn một),
   * thẻ nguồn xóa mềm kèm `mergedIntoId`, `usageCount` của thẻ đích đếm lại theo dữ liệu thật. Ghi vào cả hai
   * document thẻ nên xung đột ghi với việc gắn thẻ đồng thời (bên kia chạy lại và thấy thẻ nguồn đã xóa).
   */
  private async merge(
    jwt: JwtPayload,
    sourceId: string,
    targetId: string,
  ): Promise<TagResponseDto> {
    if (sourceId === targetId) {
      throw new BusinessException(
        ErrorCode.VALIDATION_FAILED,
        'Không thể gộp thẻ vào chính nó',
        HttpStatus.BAD_REQUEST,
        { field: 'mergeIntoId' },
      );
    }
    return withTransaction(this.connection, async (session) => {
      const source = await this.findLive(sourceId, session);
      const target = await this.findLive(targetId, session);
      if (source.category !== target.category) {
        throw new BusinessException(
          ErrorCode.VALIDATION_FAILED,
          'Chỉ gộp được các thẻ cùng nhóm (sở thích/nghề nghiệp/khác)',
          HttpStatus.BAD_REQUEST,
          { field: 'mergeIntoId' },
        );
      }
      const from = source._id;
      const to = target._id;

      const moved = await this.customerModel
        .updateMany(
          { tagIds: from },
          [
            {
              $set: {
                tagIds: {
                  $setUnion: [
                    {
                      $filter: {
                        input: '$tagIds',
                        cond: { $ne: ['$$this', from] },
                      },
                    },
                    [to],
                  ],
                },
              },
            },
          ],
          { session, timestamps: false, updatePipeline: true },
        )
        .exec();
      const usageCount = await this.customerModel
        .countDocuments({ tagIds: to })
        .session(session)
        .exec();
      await this.tagModel
        .updateOne({ _id: to }, { $set: { usageCount } }, { session })
        .exec();
      await this.tagModel
        .updateOne(
          { _id: from },
          { $set: { deletedAt: new Date(), usageCount: 0, mergedIntoId: to } },
          { session },
        )
        .exec();
      await this.audit.record(
        {
          entityType: CrmAuditEntityType.TAG,
          entityId: from,
          action: CrmAuditAction.TAG_MERGED,
          actor: jwt,
          changes: [
            { field: 'name', from: source.name, to: target.name },
            { field: 'customers', from: null, to: moved.modifiedCount },
          ],
        },
        session,
      );
      return toTagResponse({ ...target, usageCount });
    });
  }

  /** Tên hiển thị + khóa so trùng; tên chỉ gồm ký tự vô hình/dấu rời (khóa rỗng) bị từ chối. */
  private prepareName(raw: string): { name: string; nameNormalized: string } {
    const name = cleanTagName(raw);
    const nameNormalized = normalizeTagName(name);
    if (!nameNormalized) {
      throw new BusinessException(
        ErrorCode.VALIDATION_FAILED,
        'Tên thẻ phải có ít nhất một ký tự hiển thị',
        HttpStatus.BAD_REQUEST,
        { field: 'name' },
      );
    }
    return { name, nameNormalized };
  }

  private findLiveByName(
    category: string,
    nameNormalized: string,
  ): Promise<TagLean | null> {
    return this.tagModel
      .findOne({ category, nameNormalized, deletedAt: null })
      .lean()
      .exec();
  }

  private async findLive(id: string, session: ClientSession): Promise<TagLean> {
    const tag = (await this.tagModel
      .findOne({ _id: new Types.ObjectId(id), deletedAt: null })
      .session(session)
      .lean()
      .exec()) as TagLean | null;
    if (!tag) throw tagNotFound();
    return tag;
  }
}
