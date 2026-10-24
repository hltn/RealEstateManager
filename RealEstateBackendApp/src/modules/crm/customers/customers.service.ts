import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { ClientSession, Connection, Model, Types } from 'mongoose';
import type { JwtPayload } from '../../../common/decorators/current-user.decorator';
import { CRM_TEAM_ROLES, UserRole } from '../../../common/enums/user-role.enum';
import { UserStatus } from '../../../common/enums/user-status.enum';
import { BusinessException } from '../../../common/exceptions/business.exception';
import { ErrorCode } from '../../../common/exceptions/error-codes';
import { isDuplicateKeyError } from '../../../common/utils/mongo-error.util';
import { withTransaction } from '../../../shared/database/with-transaction.util';
import { User, UserDocument } from '../../users/schemas/user.schema';
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
import {
  assertValidNationalId,
  customerNotFound,
  normalizePhoneOrThrow,
  resolveClientSource,
  versionConflict,
} from './customer.errors';
import { collectRefIds, toDetail } from './customer.mapper';
import { CustomerPhoneService } from './customer-phone.service';
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
 * bản ghi `crm_audit_logs`; SĐT duy nhất do unique index quyết định (E11000 => 409), không dựa vào kiểm tra trước.
 */
@Injectable()
export class CustomersService {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    private readonly repo: CustomersRepository,
    private readonly access: CustomerAccessService,
    private readonly refs: CustomerRefsService,
    private readonly phoneService: CustomerPhoneService,
    private readonly audit: CrmAuditLogService,
    private readonly pii: PiiCryptoService,
    private readonly tags: CustomerTagsService,
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
    const phone = normalizePhoneOrThrow(dto.phone);
    if (dto.nationalId) assertValidNationalId(dto.nationalId);

    try {
      const created = await withTransaction(this.connection, (session) =>
        this.insertCustomer(ctx, dto, phone, createdVia, auditSource, session),
      );
      return await this.toDetailDto(created, ctx);
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        throw await this.phoneService.buildDuplicateError(
          ctx,
          phone,
          auditSource,
        );
      }
      throw error;
    }
  }

  async update(
    jwt: JwtPayload,
    id: string,
    dto: UpdateCustomerDto,
    clientType?: string,
  ): Promise<CustomerDetailDto> {
    const ctx = await this.access.resolve(jwt);
    const { auditSource } = resolveClientSource(clientType);
    const newPhone =
      dto.phone === undefined ? undefined : normalizePhoneOrThrow(dto.phone);

    try {
      const updated = await withTransaction(this.connection, (session) =>
        this.applyUpdate(ctx, id, dto, newPhone, auditSource, session),
      );
      return await this.toDetailDto(updated, ctx);
    } catch (error) {
      if (newPhone && isDuplicateKeyError(error)) {
        throw await this.phoneService.buildDuplicateError(
          ctx,
          newPhone,
          auditSource,
        );
      }
      throw error;
    }
  }

  // --------------------------------------------------------------------------------------------
  // Tạo
  // --------------------------------------------------------------------------------------------

  private async insertCustomer(
    ctx: AccessContext,
    dto: CreateCustomerDto,
    phone: string,
    createdVia: CreatedVia,
    auditSource: CrmAuditSource,
    session: ClientSession,
  ): Promise<CustomerLean> {
    const now = new Date();
    const actorId = ctx.actor.userId;
    const _id = new Types.ObjectId();

    const statusId = dto.statusId
      ? oid(dto.statusId)
      : await this.refs.findDefaultStatusId(session);
    const projectIds = uniqueIds((dto.interestedProjectIds ?? []).map(oid));
    const sourceId = dto.sourceId ? oid(dto.sourceId) : null;
    const areaId = dto.areaId ? oid(dto.areaId) : null;
    await this.refs.lockAndAssert(
      { statusId, sourceId, areaId, projectIds },
      session,
    );
    const tagIds = uniqueIds((dto.tagIds ?? []).map(oid));
    await this.tags.applyDelta({ added: tagIds, removed: [] }, session);

    const plan = await this.planCareTeam(ctx, dto, now, session);
    const { next: criteria } = mergeCriteria(
      undefined,
      dto.criteria ?? {},
      actorId,
      now,
    );

    const email = dto.email ? dto.email.toLowerCase() : null;
    const doc = {
      _id,
      fullName: dto.fullName,
      phone,
      email,
      statusId,
      statusChangedAt: now,
      sourceId,
      interestedProjectIds: projectIds,
      areaId,
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
      {
        field: 'status',
        from: null,
        to: refMaps.statuses.get(String(statusId))?.label ?? null,
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
    return { ...doc, __v: 0, createdAt: now, updatedAt: now };
  }

  /**
   * Lập nhóm chăm sóc ban đầu (tài liệu 05 mục 2.3, ma trận 4.2):
   * - Nhân viên tạo => tự là phụ trách chính (không được chỉ định người khác);
   * - Quản trị/Quản lý chỉ định `careTeam` (bắt buộc `primaryUserId`); Quản lý chỉ phân được cho người trong
   *   nhóm mình quản lý (hoặc chính mình) để khách luôn nằm trong phạm vi của họ;
   * - không chỉ định: `teamIds` = nhóm của người tạo (Quản lý: nhóm mình quản lý + nhóm của mình).
   *
   * "Chạm" document người dùng được phân (cập nhật `updatedAt`) để việc đổi nhóm của họ chạy đồng thời xung đột ghi
   * và buộc một bên retry — tránh `teamIds` của khách lệch nhóm hiện tại của người chăm sóc (write-skew).
   */
  private async planCareTeam(
    ctx: AccessContext,
    dto: CreateCustomerDto,
    now: Date,
    session: ClientSession,
  ): Promise<CareTeamPlan> {
    const { actor } = ctx;
    const entry = (userId: Types.ObjectId, role: CareRole): CareTeamEntry => ({
      userId,
      role,
      addedBy: actor.userId,
      addedAt: now,
    });

    if (actor.role === UserRole.STAFF) {
      if (dto.careTeam) {
        throw new BusinessException(
          ErrorCode.CARE_TEAM_ACTION_FORBIDDEN,
          'Nhân viên không được chỉ định nhóm chăm sóc khi tạo khách',
          HttpStatus.FORBIDDEN,
        );
      }
      await this.touchUsers([actor.userId], session);
      return {
        careTeam: [entry(actor.userId, CareRole.PRIMARY)],
        primaryAssigneeId: actor.userId,
        teamIds: actor.teamId ? [actor.teamId] : [],
      };
    }

    if (!dto.careTeam) {
      const teamIds = uniqueIds(
        actor.role === UserRole.MANAGER
          ? [...actor.managedTeamIds, ...(actor.teamId ? [actor.teamId] : [])]
          : [],
      );
      const managerSeesIt = teamIds.some((id) =>
        actor.managedTeamIds.some((managed) => managed.equals(id)),
      );
      if (actor.role === UserRole.MANAGER && !managerSeesIt) {
        throw new BusinessException(
          ErrorCode.PRIMARY_REQUIRED,
          'Quản lý chưa quản lý nhóm nào, hãy chỉ định nhóm chăm sóc cho khách',
          HttpStatus.BAD_REQUEST,
        );
      }
      return { careTeam: [], primaryAssigneeId: null, teamIds };
    }

    const primaryId = oid(dto.careTeam.primaryUserId);
    const memberIds = uniqueIds([
      ...dto.careTeam.memberIds.map(oid),
      primaryId,
    ]);
    const users = await this.userModel
      .find({ _id: { $in: memberIds }, deletedAt: null })
      .select('role status teamId')
      .session(session)
      .lean()
      .exec();
    const byId = new Map(users.map((user) => [String(user._id), user]));
    const invalid = memberIds.filter((id) => {
      const user = byId.get(String(id));
      if (
        !user ||
        user.status !== UserStatus.ACTIVE ||
        !CRM_TEAM_ROLES.includes(user.role)
      ) {
        return true;
      }
      if (actor.role !== UserRole.MANAGER || id.equals(actor.userId)) {
        return false;
      }
      return !actor.managedTeamIds.some((team) => user.teamId?.equals(team));
    });
    if (invalid.length > 0) {
      throw new BusinessException(
        ErrorCode.USER_NOT_ASSIGNABLE,
        'Có người được phân không hợp lệ (không hoạt động, không phải Quản lý/Nhân viên hoặc ngoài nhóm bạn quản lý)',
        HttpStatus.BAD_REQUEST,
        { userIds: invalid.map(String) },
      );
    }
    await this.touchUsers(memberIds, session);
    return {
      careTeam: memberIds.map((id) =>
        entry(id, id.equals(primaryId) ? CareRole.PRIMARY : CareRole.MEMBER),
      ),
      primaryAssigneeId: primaryId,
      teamIds: uniqueIds(
        memberIds.flatMap((id) => {
          const teamId = byId.get(String(id))?.teamId;
          return teamId ? [teamId] : [];
        }),
      ),
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
    newPhone: string | undefined,
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
        areaId: 1,
        interestedProjectIds: 1,
        tagIds: 1,
        __v: 1,
      },
    });
    if (!before) throw customerNotFound();
    if (before.__v !== dto.version) throw versionConflict(before.__v);

    const next: ProfileSnapshot = {
      fullName: dto.fullName ?? before.fullName,
      phone: newPhone ?? before.phone,
      email:
        dto.email === undefined
          ? (before.email ?? null)
          : dto.email
            ? dto.email.toLowerCase()
            : null,
      sourceId:
        dto.sourceId === undefined
          ? (before.sourceId ?? null)
          : dto.sourceId
            ? oid(dto.sourceId)
            : null,
      areaId:
        dto.areaId === undefined
          ? (before.areaId ?? null)
          : dto.areaId
            ? oid(dto.areaId)
            : null,
      interestedProjectIds:
        dto.interestedProjectIds === undefined
          ? (before.interestedProjectIds ?? [])
          : uniqueIds(dto.interestedProjectIds.map(oid)),
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
      areaId: next.areaId,
      interestedProjectIds: next.interestedProjectIds,
      tagIds: next.tagIds,
      lastUpdatedAt: now,
      lastUpdatedBy: ctx.actor.userId,
      searchText: buildSearchText({
        fullName: next.fullName!,
        email: next.email,
        phone: next.phone!,
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
