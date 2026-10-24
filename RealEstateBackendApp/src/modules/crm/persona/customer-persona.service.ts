import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model, Types } from 'mongoose';
import type { JwtPayload } from '../../../common/decorators/current-user.decorator';
import { BusinessException } from '../../../common/exceptions/business.exception';
import { ErrorCode } from '../../../common/exceptions/error-codes';
import { withTransaction } from '../../../shared/database/with-transaction.util';
import {
  CrmAuditAction,
  CrmAuditChange,
  CrmAuditEntityType,
} from '../audit-logs/crm-audit.constants';
import {
  ERASED_PLACEHOLDER,
  redactPersonaFieldAudit,
} from '../audit-logs/audit-redaction.util';
import { CrmAuditLogService } from '../audit-logs/crm-audit-log.service';
import { CustomerAccessService } from '../customers/access/customer-access.service';
import {
  customerNotFound,
  resolveClientSource,
  versionConflict,
} from '../customers/customer.errors';
import {
  CustomerRefsService,
  toUserRef,
} from '../customers/customer-refs.service';
import { CustomersRepository } from '../customers/customers.repository';
import {
  CustomerPersonaResponseDto,
  PersonaFieldValueDto,
  PersonaUpdateResponseDto,
  PersonaValueUpdateItemDto,
  UpdatePersonaDto,
} from './dtos/customer-persona.dto';
import { PersonaConfigService, toFieldDef } from './persona-config.service';
import { PersonaRecomputeService } from './persona-recompute.service';
import { PersonaSource } from './persona.constants';
import {
  derivePersona,
  isSamePersonaValue,
  parsePersonaValue,
  PersonaFieldDef,
  pickMissingFields,
  pickValueParts,
  StoredPersonaValue,
  summarizePersonaValue,
} from './persona.rules';
import {
  PersonaField,
  PersonaFieldDocument,
  PersonaFieldLean,
} from './schemas/persona-field.schema';

const SENSITIVE_PLACEHOLDER = '[nhạy cảm]';

const personaInvalid = (fieldKey: string, message: string) =>
  new BusinessException(
    ErrorCode.PERSONA_VALUE_INVALID,
    message,
    HttpStatus.BAD_REQUEST,
    { fieldKey },
  );

const iso = (date: Date | null | undefined): string | null =>
  date ? new Date(date).toISOString() : null;

/** Một trường được sửa trong lần PATCH: giá trị cũ (nếu có) và mới (`null` = xóa). */
interface PersonaChange {
  field: PersonaFieldDef;
  before: StoredPersonaValue | undefined;
  after: StoredPersonaValue | null;
}

/**
 * Chân dung của khách (C10, C12; tài liệu 05 mục 2.7). Mọi truy cập qua `CustomerScope` (ngoài phạm vi => 404).
 *
 * Ghi: kiểm giá trị theo KIỂU trường, trường nhạy cảm cần khách tự chia sẻ + xác nhận (QT9); mỗi giá trị lưu kèm
 * người/ngày/nguồn; độ đầy đủ, token lọc, dịp đặc biệt tính lại trong CÙNG lệnh `updateOne` với khóa lạc quan `__v`.
 * Cấu hình trường đổi (tắt/xóa trường) không làm mất giá trị đã lưu: chỉ trường hoạt động mới hiển thị và được tính.
 */
@Injectable()
export class CustomerPersonaService {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(PersonaField.name)
    private readonly fieldModel: Model<PersonaFieldDocument>,
    private readonly repo: CustomersRepository,
    private readonly access: CustomerAccessService,
    private readonly refs: CustomerRefsService,
    private readonly config: PersonaConfigService,
    private readonly recompute: PersonaRecomputeService,
    private readonly audit: CrmAuditLogService,
  ) {}

  async get(jwt: JwtPayload, id: string): Promise<CustomerPersonaResponseDto> {
    const ctx = await this.access.resolve(jwt);
    const customer = await this.repo.findOne(ctx.scope, id, {
      projection: { persona: 1, __v: 1 },
    });
    if (!customer) throw customerNotFound();

    const [fields, groups] = await Promise.all([
      this.config.loadActiveFields(),
      this.config.loadGroups(),
    ]);
    const defs = fields.map(toFieldDef);
    const persona = (customer.persona ?? []) as StoredPersonaValue[];
    const { users } = await this.refs.resolve({
      userIds: persona.map((item) => item.updatedBy),
    });
    const valueByKey = new Map(persona.map((item) => [item.fieldKey, item]));

    const groupList = [...groups];
    for (const field of defs) {
      if (!groupList.some((group) => group.code === field.groupCode)) {
        groupList.push({
          code: field.groupCode,
          label: field.groupCode,
          order: Number.MAX_SAFE_INTEGER,
        });
      }
    }
    return {
      groups: groupList
        .map((group) => ({
          code: group.code,
          label: group.label,
          fields: defs
            .filter((field) => field.groupCode === group.code)
            .map((field) =>
              this.toFieldValue(field, valueByKey.get(field.key), users),
            ),
        }))
        .filter((group) => group.fields.length > 0),
      completeness: derivePersona(defs, persona).personaCompleteness,
      missingSuggestions: pickMissingFields(defs, persona).map((field) => ({
        fieldKey: field.key,
        label: field.label,
        groupCode: field.groupCode,
      })),
      version: customer.__v,
    };
  }

  async update(
    jwt: JwtPayload,
    id: string,
    dto: UpdatePersonaDto,
    clientType?: string,
  ): Promise<PersonaUpdateResponseDto> {
    const ctx = await this.access.resolve(jwt);
    const { auditSource } = resolveClientSource(clientType);
    const actorId = ctx.actor.userId;
    let usedVersion = 0;

    const result = await withTransaction(this.connection, async (session) => {
      const before = await this.repo.findOne(ctx.scope, id, {
        session,
        projection: { persona: 1, __v: 1 },
      });
      if (!before) throw customerNotFound();
      if (before.__v !== dto.version) throw versionConflict(before.__v);

      usedVersion = await this.config.getVersion(session);
      const keys = dto.values.map((item) => item.fieldKey);
      // Kể cả trường đã xóa mềm: giá trị của chúng vẫn xóa được (quyền xóa dữ liệu cá nhân), chỉ không nhập mới được.
      const targets = (await this.fieldModel
        .find({ key: { $in: keys } })
        .session(session)
        .lean()
        .exec()) as PersonaFieldLean[];
      const targetByKey = new Map(targets.map((field) => [field.key, field]));
      const persona = (before.persona ?? []) as StoredPersonaValue[];
      const storedByKey = new Map(persona.map((item) => [item.fieldKey, item]));

      const now = new Date();
      const changes: PersonaChange[] = [];
      for (const item of dto.values) {
        const target = targetByKey.get(item.fieldKey);
        if (!target) {
          throw personaInvalid(item.fieldKey, 'Trường không tồn tại');
        }
        const change = this.planChange(
          toFieldDef(target),
          item,
          storedByKey.get(item.fieldKey),
          actorId,
          now,
        );
        if (change) changes.push(change);
      }

      if (changes.length === 0) {
        // Không có gì đổi: không ghi, không tăng version, không audit.
        const defs = (await this.config.loadActiveFields(session)).map(
          toFieldDef,
        );
        return {
          completeness: derivePersona(defs, persona).personaCompleteness,
          updated: [] as PersonaChange[],
          version: before.__v,
          now,
        };
      }

      // Khóa ghi các trường được GÁN giá trị: thao tác đổi kiểu trường đồng thời sẽ xung đột ghi và chạy lại.
      const written = changes.filter((change) => change.after !== null);
      if (written.length > 0) {
        const lock = await this.connection
          .collection('persona_fields')
          .updateMany(
            {
              key: { $in: written.map((change) => change.field.key) },
              deletedAt: null,
              isActive: true,
            },
            { $inc: { refLock: 1 } },
            { session },
          );
        if (lock.matchedCount !== written.length) {
          throw personaInvalid(
            written[0].field.key,
            'Trường đang bị tắt hoặc đã bị xóa, không thể nhập giá trị',
          );
        }
      }

      const changedKeys = new Set(changes.map((change) => change.field.key));
      const nextPersona = [
        ...persona.filter((item) => !changedKeys.has(item.fieldKey)),
        ...changes.flatMap((change) => (change.after ? [change.after] : [])),
      ];
      const defs = (await this.config.loadActiveFields(session)).map(
        toFieldDef,
      );
      const derived = derivePersona(defs, nextPersona);

      const matched = await this.repo.updateOne(
        ctx.scope,
        id,
        { __v: dto.version },
        {
          $set: {
            persona: nextPersona,
            ...derived,
            personaConfigVersion: usedVersion,
            lastUpdatedAt: now,
            lastUpdatedBy: actorId,
          },
          $inc: { __v: 1 },
        },
        { session },
      );
      if (!matched) {
        const current = await this.repo.findOne(ctx.scope, id, {
          session,
          projection: { __v: 1 },
        });
        if (!current) throw customerNotFound();
        throw versionConflict(current.__v);
      }

      // Xóa giá trị = quyền xóa dữ liệu cá nhân: lịch sử cũ của đúng trường đó cũng không được giữ lại giá trị.
      for (const change of changes) {
        if (change.after === null) {
          await redactPersonaFieldAudit(
            this.connection,
            new Types.ObjectId(id),
            change.field.key,
            session,
          );
        }
      }
      await this.audit.record(
        {
          entityType: CrmAuditEntityType.CUSTOMER,
          entityId: id,
          customerId: id,
          action: CrmAuditAction.PERSONA_UPDATED,
          actor: { sub: String(actorId) },
          changes: changes.map((change) => this.toAuditChange(change)),
          source: auditSource,
        },
        session,
      );
      return {
        completeness: derived.personaCompleteness,
        updated: changes,
        version: dto.version + 1,
        now,
      };
    });

    // Cấu hình trường vừa đổi giữa lúc ta đọc và lúc commit: nhờ dấu phiên bản, job nền tính lại cho khách này.
    if (
      result.updated.length > 0 &&
      usedVersion !== (await this.config.getVersion())
    ) {
      void this.recompute.run();
    }

    const { users } = await this.refs.resolve({ userIds: [actorId] });
    return {
      completeness: result.completeness,
      updated: result.updated.map((change) =>
        this.toFieldValue(change.field, change.after ?? undefined, users),
      ),
      version: result.version,
    };
  }

  /**
   * Lập thay đổi cho một trường; `null` nếu không đổi gì. Ném 400 khi trường tắt (chỉ được XÓA giá trị, để quyền
   * xóa dữ liệu cá nhân không phụ thuộc cấu hình), giá trị sai kiểu, hoặc trường nhạy cảm thiếu chia sẻ/xác nhận.
   */
  private planChange(
    field: PersonaFieldDef,
    item: PersonaValueUpdateItemDto,
    stored: StoredPersonaValue | undefined,
    actorId: Types.ObjectId,
    now: Date,
  ): PersonaChange | null {
    if (item.value === null) {
      return stored ? { field, before: stored, after: null } : null;
    }
    if (!field.isActive) {
      throw personaInvalid(
        field.key,
        'Trường đang bị tắt, không thể nhập giá trị',
      );
    }
    const parsed = parsePersonaValue(
      field,
      item.value,
      stored?.valueOptions ?? [],
    );
    if (!parsed.ok) throw personaInvalid(field.key, parsed.message);

    if (
      field.isSensitive &&
      (item.source !== PersonaSource.CUSTOMER_SHARED ||
        item.sensitiveAcknowledged !== true)
    ) {
      throw new BusinessException(
        ErrorCode.SENSITIVE_FIELD_CONSENT_REQUIRED,
        'Trường nhạy cảm chỉ được lưu khi khách tự chia sẻ và nhân viên xác nhận',
        HttpStatus.BAD_REQUEST,
        { fieldKey: field.key },
      );
    }
    if (
      stored &&
      stored.source === item.source &&
      isSamePersonaValue(pickValueParts(stored), parsed.value)
    ) {
      return null;
    }
    return {
      field,
      before: stored,
      after: {
        fieldKey: field.key,
        ...parsed.value,
        source: item.source,
        updatedBy: actorId,
        updatedAt: now,
      },
    };
  }

  /**
   * Audit ghi theo `persona.<fieldKey>`; giá trị trường nhạy cảm KHÔNG được ghi (chỉ ghi là có/không); lần XÓA giá trị
   * không ghi lại giá trị bị xóa.
   */
  private toAuditChange(change: PersonaChange): CrmAuditChange {
    const erased = change.after === null;
    const snapshot = (stored: StoredPersonaValue | null | undefined) => {
      if (!stored) return null;
      if (erased) return { value: ERASED_PLACEHOLDER, source: stored.source };
      return {
        value: change.field.isSensitive
          ? SENSITIVE_PLACEHOLDER
          : summarizePersonaValue(change.field.type, stored),
        source: stored.source,
      };
    };
    return {
      field: `persona.${change.field.key}`,
      from: snapshot(change.before),
      to: snapshot(change.after),
    };
  }

  private toFieldValue(
    field: PersonaFieldDef,
    stored: StoredPersonaValue | undefined,
    users: Map<string, string>,
  ): PersonaFieldValueDto {
    return {
      fieldKey: field.key,
      label: field.label,
      groupCode: field.groupCode,
      type: field.type,
      value: stored ? pickValueParts(stored) : null,
      source: stored?.source ?? null,
      updatedAt: iso(stored?.updatedAt),
      updatedBy: stored ? toUserRef(stored.updatedBy, users) : null,
    };
  }
}
