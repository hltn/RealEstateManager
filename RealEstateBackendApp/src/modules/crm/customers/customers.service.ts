import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { ClientSession, Connection, Model, Types } from 'mongoose';
import type { JwtPayload } from '../../../common/decorators/current-user.decorator';
import { canBePrimary } from '../../../common/utils/user-roles.util';
import { BusinessException } from '../../../common/exceptions/business.exception';
import { ErrorCode } from '../../../common/exceptions/error-codes';
import { CounterService } from '../../../shared/counters/counter.service';
import { withTransaction } from '../../../shared/database/with-transaction.util';
import { User, UserDocument } from '../../users/schemas/user.schema';
import { teamObjectIdsOf } from '../../users/user-public-profile';
import {
  CrmAuditAction,
  CrmAuditChange,
  CrmAuditEntityType,
  CrmAuditSource,
} from '../audit-logs/crm-audit.constants';
import { CrmAuditLogService } from '../audit-logs/crm-audit-log.service';
import { PiiCryptoService } from '../common/crypto/pii-crypto.service';
import { buildSearchText } from './utils/customer-search.util';
import {
  AccessContext,
  CustomerAccessService,
} from './access/customer-access.service';
import { CareRole, ConsentStatus, CreatedVia } from './customer.constants';
import { COUNTER_KEY, formatCustomerCode } from './customer-code.constants';
import {
  assertValidNationalId,
  customerNotFound,
  normalizeOptionalPhoneOrThrow,
  resolveClientSource,
  versionConflict,
} from './customer.errors';
import { collectRefIds, toDetail } from './customer.mapper';
import { CustomerTagsService } from './customer-tags.service';
import { CustomerRefsService, RefMaps } from './customer-refs.service';
import { CustomerLean, CustomersRepository } from './customers.repository';
import {
  CreateCustomerDto,
  UpdateCustomerDto,
} from './dtos/customer-request.dto';
import { CustomerDetailDto } from './dtos/customer-response.dto';
import { CareTeamEntry } from './schemas/customer.schema';
import { diffTagIds } from '../tags/tag.rules';
import { buildCustomerCreatedNotifications } from './utils/customer-created-notification.util';
import { NotificationDispatcher } from '../../notifications/notification-dispatcher.service';
import {
  buildProfileChanges,
  EMPTY_PROFILE,
  ProfileSnapshot,
} from './utils/customer-audit.util';
import {
  computeProgress,
  lastFourDigits,
  mergeCriteria,
  nationalIdAad,
} from './utils/customer-rules.util';

const oid = (id: string): Types.ObjectId => new Types.ObjectId(id);

interface CareTeamPlan {
  careTeam: CareTeamEntry[];
  primaryAssigneeId: Types.ObjectId | null;
  teamIds: Types.ObjectId[];
}

const uniqueIds = (ids: Types.ObjectId[]): Types.ObjectId[] => [
  ...new Map(ids.map((id) => [String(id), id])).values(),
];

/** Mã danh mục để ghi kép: dịch từ id; danh mục bị xóa cứng (không dịch được) thì giữ mã đã lưu, không có id thì `null`. */
const codeFor = (
  id: Types.ObjectId | null,
  codes: Map<string, string>,
  stored: string | null | undefined,
): string | null => (id ? (codes.get(String(id)) ?? stored ?? null) : null);

/** Mã các dự án quan tâm theo đúng thứ tự id; dự án không dịch được (bị xóa cứng) bị bỏ khỏi mảng mã. */
const projectCodesOf = (ids: Types.ObjectId[], refMaps: RefMaps): string[] =>
  ids.flatMap((id) => {
    const code = refMaps.codes.projects.get(String(id));
    return code ? [code] : [];
  });

const profileOf = (doc: CustomerLean): ProfileSnapshot => ({
  fullName: doc.fullName,
  phone: doc.phone,
  email: doc.email ?? null,
  sourceId: doc.sourceId ?? null,
  areaId: doc.areaId ?? null,
  interestedProjectIds: doc.interestedProjectIds ?? [],
  tagIds: doc.tagIds ?? [],
});

/**
 * Tạo / sửa hồ sơ / xem chi tiết khách (tài liệu 05 mục 2.3). Mọi thao tác ghi nằm trong MỘT transaction cùng
 * bản ghi `crm_audit_logs`. SĐT là tùy chọn và KHÔNG duy nhất (FR-01/FR-02): không kiểm trùng, không bắt E11000
 * theo SĐT. Danh tính khách là `customerCode` (`KH-xxxxxx`) cấp trong chính transaction tạo (FR-07).
 */
@Injectable()
export class CustomersService {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    private readonly repo: CustomersRepository,
    private readonly access: CustomerAccessService,
    private readonly refs: CustomerRefsService,
    private readonly audit: CrmAuditLogService,
    private readonly pii: PiiCryptoService,
    private readonly tags: CustomerTagsService,
    private readonly notifications: NotificationDispatcher,
    private readonly counter: CounterService,
  ) {}

  async getById(jwt: JwtPayload, id: string): Promise<CustomerDetailDto> {
    const ctx = await this.access.resolve(jwt);
    const doc = await this.repo.findOne(ctx.scope, id);
    if (!doc) throw customerNotFound();
    return this.toDetailDto(doc, ctx);
  }

  async create(
    jwt: JwtPayload,
    dto: CreateCustomerDto,
    clientType?: string,
  ): Promise<CustomerDetailDto> {
    const ctx = await this.access.resolve(jwt);
    const { createdVia, auditSource } = resolveClientSource(clientType);
    const phone = normalizeOptionalPhoneOrThrow(dto.phone);
    if (dto.nationalId) assertValidNationalId(dto.nationalId);

    const created = await withTransaction(this.connection, (session) =>
      this.insertCustomer(ctx, dto, phone, createdVia, auditSource, session),
    );
    return this.toDetailDto(created, ctx);
  }

  async update(
    jwt: JwtPayload,
    id: string,
    dto: UpdateCustomerDto,
    clientType?: string,
  ): Promise<CustomerDetailDto> {
    const ctx = await this.access.resolve(jwt);
    const { auditSource } = resolveClientSource(clientType);
    // `undefined` = giữ nguyên; `null`/rỗng = xóa SĐT; có giá trị = chuẩn hóa (FR-01).
    const newPhone =
      dto.phone === undefined
        ? undefined
        : normalizeOptionalPhoneOrThrow(dto.phone);

    const updated = await withTransaction(this.connection, (session) =>
      this.applyUpdate(ctx, id, dto, newPhone, auditSource, session),
    );
    return this.toDetailDto(updated, ctx);
  }

  // --------------------------------------------------------------------------------------------
  // Tạo
  // --------------------------------------------------------------------------------------------

  private async insertCustomer(
    ctx: AccessContext,
    dto: CreateCustomerDto,
    phone: string | null,
    createdVia: CreatedVia,
    auditSource: CrmAuditSource,
    session: ClientSession,
  ): Promise<CustomerLean> {
    const now = new Date();
    const actorId = ctx.actor.userId;
    const _id = new Types.ObjectId();

    // FR-40: nhận `…Code` (ưu tiên) hoặc `…Id` (cũ), dịch MỘT chỗ qua `CustomerRefsService`; lệch id/code thì 400.
    const [statusInput, sourceInput, areaInput, projectInput] =
      await Promise.all([
        this.refs.resolveSingleInput(
          'status',
          { id: dto.statusId, code: dto.statusCode },
          'statusCode',
          session,
        ),
        this.refs.resolveSingleInput(
          'source',
          { id: dto.sourceId, code: dto.sourceCode },
          'sourceCode',
          session,
        ),
        this.refs.resolveSingleInput(
          'area',
          { id: dto.areaId, code: dto.areaCode },
          'areaCode',
          session,
        ),
        this.refs.resolveListInput(
          'project',
          { ids: dto.interestedProjectIds, codes: dto.projectCodes },
          'projectCodes',
          session,
        ),
      ]);
    const statusRef =
      statusInput.ref ?? (await this.refs.findDefaultStatusRef(session));
    const statusId = statusRef.id;
    const sourceId = sourceInput.ref?.id ?? null;
    const areaId = areaInput.ref?.id ?? null;
    const projectIds = projectInput.refs.map((ref) => ref.id);
    await this.refs.lockAndAssert(
      { statusId, sourceId, areaId, projectIds },
      session,
    );
    const tagIds = uniqueIds((dto.tagIds ?? []).map(oid));
    await this.tags.applyDelta({ added: tagIds, removed: [] }, session);

    const plan = await this.planCareTeam(ctx, now, session);
    const { next: criteria } = mergeCriteria(
      undefined,
      dto.criteria ?? {},
      actorId,
      now,
    );

    const email = dto.email ? dto.email.toLowerCase() : null;
    // FR-07: cấp mã SAU CÙNG (sau mọi đọc/kiểm tra) để khóa doc counter giữ ngắn nhất; rollback transaction kéo
    // theo cả `$inc` nên không thủng số, không trùng mã.
    const customerCode = formatCustomerCode(
      (await this.counter.next(COUNTER_KEY, 1, session)).first,
    );
    const doc = {
      _id,
      customerCode,
      fullName: dto.fullName,
      phone,
      email,
      statusId,
      statusCode: statusRef.code,
      statusChangedAt: now,
      sourceId,
      sourceCode: sourceInput.ref?.code ?? null,
      interestedProjectIds: projectIds,
      interestedProjectCodes: projectInput.refs.map((ref) => ref.code),
      areaId,
      areaCode: areaInput.ref?.code ?? null,
      tagIds,
      nationalId: dto.nationalId
        ? this.pii.encrypt(dto.nationalId, nationalIdAad(String(_id)))
        : null,
      nationalIdLast4: dto.nationalId ? lastFourDigits(dto.nationalId) : null,
      hasNationalId: !!dto.nationalId,
      criteria,
      progress: computeProgress(criteria),
      ...plan,
      persona: [],
      personaFilterKeys: [],
      occasions: [],
      personaCompleteness: 0,
      personaConfigVersion: 0,
      dataConsent: {
        status: dto.dataConsent?.status ?? ConsentStatus.UNKNOWN,
        method: dto.dataConsent?.method ?? null,
        recordedBy: dto.dataConsent ? actorId : null,
        recordedAt: dto.dataConsent ? now : null,
        note: dto.dataConsent?.note ?? null,
      },
      lastUpdatedAt: now,
      lastUpdatedBy: actorId,
      lastCareLogAt: null,
      nextAppointmentAt: null,
      searchText: buildSearchText({ fullName: dto.fullName, email, phone }),
      createdVia,
      createdBy: actorId,
      deletedAt: null,
      deletedBy: null,
      anonymizedAt: null,
      purgingAt: null,
    };
    await this.repo.insert(doc, session);

    const refMaps = await this.refs.resolve({
      statusIds: [statusId],
      sourceIds: [sourceId],
      areaIds: [areaId],
      projectIds,
      tagIds,
      userIds: plan.careTeam.map((member) => member.userId),
    });
    const changes: CrmAuditChange[] = [
      ...buildProfileChanges(
        EMPTY_PROFILE,
        profileOf(doc as unknown as CustomerLean),
        refMaps,
        true,
      ),
      { field: 'customerCode', from: null, to: customerCode },
      {
        field: 'status',
        from: null,
        to: refMaps.statuses.get(String(statusId))?.label ?? null,
        fromCode: null,
        toCode: statusRef.code,
      },
      {
        field: 'careTeam',
        from: [],
        to: plan.careTeam.map(
          (member) =>
            `${refMaps.users.get(String(member.userId)) ?? String(member.userId)} (${member.role})`,
        ),
      },
    ];
    await this.audit.record(
      {
        entityType: CrmAuditEntityType.CUSTOMER,
        entityId: _id,
        customerId: _id,
        action: CrmAuditAction.CUSTOMER_CREATED,
        actor: { sub: String(actorId) },
        changes,
        source: auditSource,
      },
      session,
    );
    // Người được phân ngay lúc tạo (trừ chính người tạo) nhận thông báo, cùng transaction (không push).
    await this.notifications.dispatch(
      buildCustomerCreatedNotifications({
        customerId: _id,
        customerName: dto.fullName,
        careTeam: plan.careTeam,
        actorId,
        actorName: ctx.actor.displayName,
      }),
      session,
    );
    return { ...doc, __v: 0, createdAt: now, updatedAt: now };
  }

  /**
   * Lập nhóm chăm sóc ban đầu (FR-10): người tạo LUÔN là phụ trách chính (PRIMARY) ở mọi vai trò (Admin, Manager,
   * Staff); không còn nhập `careTeam` lúc tạo. `teamIds` = nhóm của người tạo, có thể `[]` (Admin thuần).
   *
   * "Chạm" document người tạo (cập nhật `updatedAt`) rồi ĐỌC LẠI nhóm của họ trong cùng session để việc đổi nhóm
   * chạy đồng thời xung đột ghi và buộc một bên retry — tránh `teamIds` của khách lệch nhóm hiện tại của người
   * chăm sóc (write-skew).
   */
  private async planCareTeam(
    ctx: AccessContext,
    now: Date,
    session: ClientSession,
  ): Promise<CareTeamPlan> {
    const { actor } = ctx;
    if (!canBePrimary(actor.roles)) {
      throw new BusinessException(
        ErrorCode.CARE_TEAM_ACTION_FORBIDDEN,
        'Vai trò hiện tại không được tạo khách',
        HttpStatus.FORBIDDEN,
      );
    }
    await this.touchUsers([actor.userId], session);
    const creator = await this.userModel
      .findOne({ _id: actor.userId, deletedAt: null })
      .select('teamId teamIds')
      .session(session)
      .lean()
      .exec();
    return {
      careTeam: [
        {
          userId: actor.userId,
          role: CareRole.PRIMARY,
          addedBy: actor.userId,
          addedAt: now,
        },
      ],
      primaryAssigneeId: actor.userId,
      teamIds: uniqueIds(creator ? teamObjectIdsOf(creator) : actor.teamIds),
    };
  }

  private async touchUsers(
    userIds: Types.ObjectId[],
    session: ClientSession,
  ): Promise<void> {
    await this.userModel
      .updateMany(
        { _id: { $in: userIds } },
        { $currentDate: { updatedAt: true } },
        { session, timestamps: false },
      )
      .exec();
  }

  // --------------------------------------------------------------------------------------------
  // Sửa
  // --------------------------------------------------------------------------------------------

  private async applyUpdate(
    ctx: AccessContext,
    id: string,
    dto: UpdateCustomerDto,
    newPhone: string | null | undefined,
    auditSource: CrmAuditSource,
    session: ClientSession,
  ): Promise<CustomerLean> {
    const before = await this.repo.findOne(ctx.scope, id, {
      session,
      projection: {
        fullName: 1,
        phone: 1,
        email: 1,
        sourceId: 1,
        sourceCode: 1,
        areaId: 1,
        areaCode: 1,
        interestedProjectIds: 1,
        interestedProjectCodes: 1,
        tagIds: 1,
        __v: 1,
      },
    });
    if (!before) throw customerNotFound();
    if (before.__v !== dto.version) throw versionConflict(before.__v);

    // FR-40: `…Code` (ưu tiên) hoặc `…Id` (cũ). Không lọc "còn hoạt động" ở đây: khách giữ liên kết với danh mục đã
    // ngừng; chỉ giá trị MỚI gán mới bị `lockAndAssert` kiểm bên dưới.
    const [sourceInput, areaInput, projectInput] = await Promise.all([
      this.refs.resolveSingleInput(
        'source',
        { id: dto.sourceId, code: dto.sourceCode },
        'sourceCode',
        session,
        false,
      ),
      this.refs.resolveSingleInput(
        'area',
        { id: dto.areaId, code: dto.areaCode },
        'areaCode',
        session,
        false,
      ),
      this.refs.resolveListInput(
        'project',
        { ids: dto.interestedProjectIds, codes: dto.projectCodes },
        'projectCodes',
        session,
        false,
      ),
    ]);

    const next: ProfileSnapshot = {
      fullName: dto.fullName ?? before.fullName,
      phone: newPhone === undefined ? (before.phone ?? null) : newPhone,
      email:
        dto.email === undefined
          ? (before.email ?? null)
          : dto.email
            ? dto.email.toLowerCase()
            : null,
      sourceId: sourceInput.provided
        ? (sourceInput.ref?.id ?? null)
        : (before.sourceId ?? null),
      areaId: areaInput.provided
        ? (areaInput.ref?.id ?? null)
        : (before.areaId ?? null),
      interestedProjectIds: projectInput.provided
        ? projectInput.refs.map((ref) => ref.id)
        : (before.interestedProjectIds ?? []),
      tagIds:
        dto.tagIds === undefined
          ? (before.tagIds ?? [])
          : uniqueIds(dto.tagIds.map(oid)),
    };

    // Ref tham chiếu cần dịch nhãn cho audit: cũ + mới.
    const beforeSnapshot = profileOf(before);
    const refMaps = await this.refs.resolve({
      sourceIds: [beforeSnapshot.sourceId, next.sourceId],
      areaIds: [beforeSnapshot.areaId, next.areaId],
      projectIds: [
        ...beforeSnapshot.interestedProjectIds,
        ...next.interestedProjectIds,
      ],
      tagIds: [...beforeSnapshot.tagIds, ...next.tagIds],
    });
    const changes = buildProfileChanges(beforeSnapshot, next, refMaps);
    if (changes.length === 0) {
      // Không có gì đổi: không ghi, không tăng version, không audit.
      return (await this.repo.findOne(ctx.scope, id, { session }))!;
    }

    // Chỉ KHÓA/kiểm các danh mục mới gán (khách cũ giữ liên kết với danh mục đã ngừng hoạt động).
    const hadProject = new Set(beforeSnapshot.interestedProjectIds.map(String));
    await this.refs.lockAndAssert(
      {
        sourceId:
          String(next.sourceId ?? '') !== String(beforeSnapshot.sourceId ?? '')
            ? next.sourceId
            : null,
        areaId:
          String(next.areaId ?? '') !== String(beforeSnapshot.areaId ?? '')
            ? next.areaId
            : null,
        projectIds: next.interestedProjectIds.filter(
          (projectId) => !hadProject.has(String(projectId)),
        ),
      },
      session,
    );
    // Thẻ: kiểm thẻ mới gắn còn hoạt động + giữ `usageCount` trong cùng transaction.
    await this.tags.applyDelta(
      diffTagIds(beforeSnapshot.tagIds, next.tagIds),
      session,
    );

    const now = new Date();
    const set: Record<string, unknown> = {
      fullName: next.fullName,
      phone: next.phone,
      email: next.email,
      sourceId: next.sourceId,
      // FR-40: ghi kép id + code; mã lấy từ cùng bản ghi danh mục nên đổi nhãn không đổi mã. Khách chưa có mã
      // (dữ liệu cũ) được điền luôn ở lần ghi này; danh mục bị xóa cứng thì giữ mã đã lưu.
      sourceCode: codeFor(
        next.sourceId,
        refMaps.codes.sources,
        before.sourceCode,
      ),
      areaId: next.areaId,
      areaCode: codeFor(next.areaId, refMaps.codes.areas, before.areaCode),
      interestedProjectIds: next.interestedProjectIds,
      interestedProjectCodes: projectCodesOf(
        next.interestedProjectIds,
        refMaps,
      ),
      tagIds: next.tagIds,
      lastUpdatedAt: now,
      lastUpdatedBy: ctx.actor.userId,
      searchText: buildSearchText({
        fullName: next.fullName!,
        email: next.email,
        phone: next.phone,
      }),
    };
    const matched = await this.repo.updateOne(
      ctx.scope,
      id,
      { __v: dto.version },
      { $set: set, $inc: { __v: 1 } },
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

    await this.audit.record(
      {
        entityType: CrmAuditEntityType.CUSTOMER,
        entityId: id,
        customerId: id,
        action: CrmAuditAction.CUSTOMER_UPDATED,
        actor: { sub: String(ctx.actor.userId) },
        changes,
        source: auditSource,
      },
      session,
    );
    return (await this.repo.findOne(ctx.scope, id, { session }))!;
  }

  /** Dựng response chi tiết (nhãn danh mục + tên người theo lô, không N+1). */
  async toDetailDto(
    doc: CustomerLean,
    ctx: AccessContext,
  ): Promise<CustomerDetailDto> {
    const refMaps: RefMaps = await this.refs.resolve(collectRefIds([doc]));
    return toDetail(doc, refMaps, ctx.actor);
  }
}
