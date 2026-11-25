import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import { UserRole } from '../../../common/enums/user-role.enum';
import { UserStatus } from '../../../common/enums/user-status.enum';
import { BusinessException } from '../../../common/exceptions/business.exception';
import { ErrorCode } from '../../../common/exceptions/error-codes';
import { uniqueObjectIds } from '../../../common/utils/object-id.util';
import { hasCrmRole } from '../../../common/utils/user-roles.util';
import { User, UserDocument } from '../../users/schemas/user.schema';
import {
  CrmAuditAction,
  CrmAuditChange,
  CrmAuditEntityType,
  CrmAuditSource,
} from '../audit-logs/crm-audit.constants';
import { CrmAuditLogService } from '../audit-logs/crm-audit-log.service';
import { CrmSettingsService } from '../crm-settings/crm-settings.service';
import { AccessContext } from '../customers/access/customer-access.service';
import {
  isCreator,
  isOwnerManager,
} from '../customers/access/customer-owner-team';
import {
  customerNotFound,
  versionConflict,
} from '../customers/customer.errors';
import {
  CatalogRef,
  CustomerRefsService,
} from '../customers/customer-refs.service';
import {
  CustomerOwnerTeamService,
  OwnerTeamCandidates,
} from '../customers/customer-owner-team.service';
import { CustomersRepository } from '../customers/customers.repository';
import { RemindersWriterService } from '../reminders/reminders-writer.service';
import {
  getAssigneeIds,
  requestedAssigneeIds,
  toAssigneeWrite,
} from './appointment-assignee';
import {
  AppointmentStatus,
  AppointmentType,
  AssigneeRejectReason,
} from './appointment.constants';
import { AppointmentCustomerLean, AppointmentLean } from './appointment.mapper';
import {
  assertCanModifyAppointment,
  assertEndAfterStart,
  assertProjectInputConsistent,
  assertStartNotInPast,
  canTransitionStatus,
  normalizeRemindOffsets,
} from './appointment.rules';
import {
  ChangeAppointmentStatusDto,
  UpdateAppointmentDto,
} from './dtos/appointment.dto';
import { Appointment, AppointmentDocument } from './schemas/appointment.schema';

const oid = (id: string): Types.ObjectId => new Types.ObjectId(id);

/** Tham số tạo lịch hẹn (đã qua DTO hoặc dựng từ `nextAction.appointment` của nhật ký). */
export interface CreateAppointmentInput {
  customerId: Types.ObjectId;
  type: AppointmentType;
  startAt: Date;
  endAt?: Date | null;
  title?: string;
  location?: string;
  note?: string;
  /** DEPRECATED: một người thực hiện; `assigneeIds` thắng khi có cả hai. */
  assigneeId?: Types.ObjectId;
  /** Người thực hiện (FR-30). Không gửi thì mặc định người đặt lịch nếu thuộc tập hợp lệ, ngược lại PRIMARY. */
  assigneeIds?: Types.ObjectId[];
  remindBeforeMinutes?: number[];
  /** Dự án của buổi hẹn (tùy chọn, `id` cũ); phải còn hoạt động. */
  projectId?: Types.ObjectId | null;
  /** Mã dự án (mới, FR-40, ưu tiên hơn `projectId`); gửi cả hai thì phải cùng một dự án, ngược lại 400. */
  projectCode?: string | null;
  sourceCareLogId?: Types.ObjectId | null;
}

/** Field của khách mà việc ghi lịch hẹn cần. */
const CUSTOMER_PROJECTION = {
  fullName: 1,
  phone: 1,
  anonymizedAt: 1,
  statusId: 1,
  careTeam: 1,
  primaryAssigneeId: 1,
  // Nhóm chủ và người tạo khách cho tập người thực hiện hợp lệ (FR-30).
  teamIds: 1,
  createdBy: 1,
} as const;

const resourceNotFound = (): BusinessException =>
  new BusinessException(
    ErrorCode.RESOURCE_NOT_FOUND,
    'Không tìm thấy lịch hẹn',
    HttpStatus.NOT_FOUND,
  );

const statusInvalid = (message: string): BusinessException =>
  new BusinessException(
    ErrorCode.APPOINTMENT_STATUS_INVALID,
    message,
    HttpStatus.CONFLICT,
  );

/** Thông điệp theo lý do (Architecture 5.13.3); không chứa tên/SĐT khách. */
const ASSIGNEE_REJECT_MESSAGES: Record<AssigneeRejectReason, string> = {
  [AssigneeRejectReason.NOT_IN_CARE_TEAM]:
    'Người thực hiện phải là thành viên nhóm chăm sóc, người tạo khách hoặc Quản lý của nhóm chủ khách; nhờ thành viên có quyền mời đưa người đó vào nhóm trước',
  [AssigneeRejectReason.NOT_ACTIVE]:
    'Người thực hiện không còn hoạt động (tài khoản bị khóa hoặc đã xóa)',
  [AssigneeRejectReason.NOT_CRM_ROLE]:
    'Người thực hiện không có vai trò CRM (cần là Quản trị, Quản lý hoặc Nhân viên)',
};

const assigneeNotAssignable = (
  userIds: readonly Types.ObjectId[],
  reason: AssigneeRejectReason,
): BusinessException =>
  new BusinessException(
    ErrorCode.USER_NOT_ASSIGNABLE,
    ASSIGNEE_REJECT_MESSAGES[reason],
    HttpStatus.BAD_REQUEST,
    { userIds: userIds.map(String), reason },
  );

/** Phần tài khoản đọc MỘT lần để kiểm cả mảng người thực hiện. */
interface AssigneeUser {
  _id: Types.ObjectId;
  roles?: string[];
  status?: UserStatus;
  deletedAt?: Date | null;
}

/** Tên các người thực hiện (đúng thứ tự) cho audit; thiếu tên thì dùng id. */
const assigneeNames = (
  ids: readonly Types.ObjectId[],
  users: ReadonlyMap<string, string>,
): string => ids.map((id) => users.get(String(id)) ?? String(id)).join(', ');

const sameIds = (
  left: readonly Types.ObjectId[],
  right: readonly Types.ObjectId[],
): boolean =>
  left.length === right.length &&
  left.every((id, index) => id.equals(right[index]));

const iso = (date: Date | null | undefined): string | null =>
  date ? date.toISOString() : null;

/** Khách (đã lọc theo phạm vi) cùng nhóm chăm sóc, dùng để chọn/kiểm người thực hiện. */
interface ScopedCustomer extends AppointmentCustomerLean {
  careTeam?: Array<{ userId: Types.ObjectId }>;
  primaryAssigneeId?: Types.ObjectId | null;
  teamIds?: Types.ObjectId[];
  createdBy?: Types.ObjectId | null;
}

/**
 * Ghi lịch hẹn TRONG transaction do bên gọi mở (tài liệu 05 mục 2.9): lịch hẹn + `customers.nextAppointmentAt` +
 * nhắc việc (`reminders`) + audit cùng một transaction. Tách khỏi `AppointmentsService` để `CareLogsService` tạo
 * lịch từ `nextAction.appointment` mà không phụ thuộc vòng.
 *
 * Quy tắc đã chốt (tài liệu 04 mục 3.5/4.2): người thực hiện thuộc nhóm chăm sóc; không hẹn quá khứ (dung sai 5 phút)
 * khi tạo/dời giờ; `endAt` sau `startAt` và ≤ 24 giờ; KHÔNG chặn giao lịch (một nhân viên có thể dẫn nhiều khách cùng
 * khung giờ); chỉ lịch SCHEDULED được sửa.
 */
@Injectable()
export class AppointmentsWriteService {
  constructor(
    @InjectModel(Appointment.name)
    private readonly appointmentModel: Model<AppointmentDocument>,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    private readonly repo: CustomersRepository,
    private readonly refs: CustomerRefsService,
    private readonly settings: CrmSettingsService,
    private readonly reminders: RemindersWriterService,
    private readonly audit: CrmAuditLogService,
    private readonly ownerTeam: CustomerOwnerTeamService,
  ) {}

  async createInSession(
    ctx: AccessContext,
    input: CreateAppointmentInput,
    source: CrmAuditSource,
    session: ClientSession,
  ): Promise<{ appointment: AppointmentLean; customer: ScopedCustomer }> {
    const now = new Date();
    const customer = await this.findCustomer(ctx, input.customerId, session);
    assertStartNotInPast(input.startAt, now);
    assertEndAfterStart(input.startAt, input.endAt);

    const assigneeIds = await this.resolveAssignees(
      ctx,
      customer,
      requestedAssigneeIds(input),
      session,
    );
    // Dự án gắn MỚI (nhận `projectCode` hoặc `projectId`) phải còn hoạt động: dịch về `{ id, code, label }` rồi khóa
    // ghi trong transaction để không đua với việc ngừng/xóa dự án. Ghi KÉP `projectId` + `projectCode` (FR-40).
    const project = await this.resolveProjectForAssign(
      input.projectId,
      input.projectCode,
      session,
    );
    const projectId = project?.id ?? null;
    await this.refs.lockAndAssert({ appointmentProjectId: projectId }, session);
    const defaults = (await this.settings.get())
      .defaultAppointmentReminderMinutes;
    const offsets = normalizeRemindOffsets(input.remindBeforeMinutes, defaults);

    const [created] = await this.appointmentModel.create(
      [
        {
          customerId: input.customerId,
          type: input.type,
          title: input.title ?? '',
          startAt: input.startAt,
          endAt: input.endAt ?? null,
          location: input.location ?? '',
          note: input.note ?? '',
          // MỘT hàm ghi kép: `assigneeIds` + `assigneeId = assigneeIds[0]` (deprecated).
          ...toAssigneeWrite(assigneeIds),
          remindBeforeMinutes: offsets,
          status: AppointmentStatus.SCHEDULED,
          projectId,
          projectCode: project?.code ?? null,
          sourceCareLogId: input.sourceCareLogId ?? null,
          createdBy: ctx.actor.userId,
          deletedAt: null,
        },
      ],
      { session },
    );
    const appointment = created.toObject() as AppointmentLean;

    await this.refreshCustomer(ctx, input.customerId, now, session);
    await this.reminders.syncAppointment(appointment, now, session);

    const maps = await this.refs.resolve({ userIds: assigneeIds });
    const changes: CrmAuditChange[] = [
      { field: 'appointment.type', from: null, to: appointment.type },
      {
        field: 'appointment.startAt',
        from: null,
        to: iso(appointment.startAt),
      },
      {
        field: 'appointment.assignee',
        from: null,
        to: assigneeNames(assigneeIds, maps.users),
      },
    ];
    if (project) {
      changes.push({
        field: 'appointment.project',
        from: null,
        to: project.label || String(project.id),
      });
    }
    if (appointment.title) {
      changes.push({
        field: 'appointment.title',
        from: null,
        to: appointment.title,
      });
    }
    await this.recordAudit(
      ctx,
      appointment,
      CrmAuditAction.APPOINTMENT_CREATED,
      changes,
      null,
      source,
      session,
    );
    return { appointment, customer };
  }

  async updateInSession(
    ctx: AccessContext,
    id: string,
    dto: UpdateAppointmentDto,
    source: CrmAuditSource,
    session: ClientSession,
  ): Promise<{ appointment: AppointmentLean; customer: ScopedCustomer }> {
    const now = new Date();
    const { appointment, customer } = await this.loadInScope(ctx, id, session);
    // Bản ghi chỉ của mình (FR-32): kiểm quyền trước khi xét phiên bản và trạng thái để người ngoài luôn nhận 403.
    assertCanModifyAppointment(ctx.actor, appointment);
    if (dto.version !== undefined && dto.version !== appointment.__v) {
      throw versionConflict(appointment.__v);
    }
    if (appointment.status !== AppointmentStatus.SCHEDULED) {
      throw statusInvalid(
        'Chỉ sửa được lịch hẹn đang chờ thực hiện; hãy mở lại lịch trước khi sửa',
      );
    }

    const set: Record<string, unknown> = {};
    const changes: CrmAuditChange[] = [];
    const track = (field: string, from: unknown, to: unknown) => {
      changes.push({ field: `appointment.${field}`, from, to });
    };

    const startAt = dto.startAt ? new Date(dto.startAt) : appointment.startAt;
    const endAt =
      dto.endAt === undefined
        ? appointment.endAt
        : dto.endAt === null
          ? null
          : new Date(dto.endAt);
    const isStartChanged = startAt.getTime() !== appointment.startAt.getTime();
    if (isStartChanged) assertStartNotInPast(startAt, now);
    if (isStartChanged || dto.endAt !== undefined) {
      assertEndAfterStart(startAt, endAt);
    }
    if (isStartChanged) {
      set.startAt = startAt;
      track('startAt', iso(appointment.startAt), iso(startAt));
    }
    if (iso(endAt) !== iso(appointment.endAt)) {
      set.endAt = endAt;
      track('endAt', iso(appointment.endAt), iso(endAt));
    }
    for (const field of ['type', 'title', 'location', 'note'] as const) {
      if (dto[field] !== undefined && dto[field] !== appointment[field]) {
        set[field] = dto[field];
        track(field, appointment[field], dto[field]);
      }
    }
    // Đổi người thực hiện: cùng hàm luật với lúc tạo, CHỈ kiểm id MỚI thêm (người đã có sẵn không bị kiểm lại, kể
    // cả khi sau đó bị gỡ khỏi nhóm/khóa); sửa giờ, nội dung mà không đổi danh sách thì không kiểm gì.
    const currentIds = getAssigneeIds(appointment);
    const requested = requestedAssigneeIds({
      assigneeIds: dto.assigneeIds?.map(oid),
      assigneeId: dto.assigneeId ? oid(dto.assigneeId) : undefined,
    });
    // `assigneeId` cũ (deprecated) trùng người đầu hiện tại = không đổi (giữ ngữ nghĩa "gửi lại cùng người").
    const isLegacyNoChange =
      !dto.assigneeIds?.length && requested?.[0]?.equals(currentIds[0]);
    if (requested && !isLegacyNoChange && !sameIds(requested, currentIds)) {
      const added = requested.filter(
        (id) => !currentIds.some((current) => current.equals(id)),
      );
      if (added.length > 0) {
        await this.resolveAssignees(ctx, customer, added, session);
      }
      const maps = await this.refs.resolve({
        userIds: [...currentIds, ...requested],
      });
      Object.assign(set, toAssigneeWrite(requested));
      track(
        'assignee',
        currentIds.length > 0 ? assigneeNames(currentIds, maps.users) : null,
        assigneeNames(requested, maps.users),
      );
    }
    // Dự án (`projectCode` hoặc `projectId`): bỏ trống = giữ nguyên; null = gỡ; đổi sang dự án KHÁC thì dự án mới
    // phải còn hoạt động (gửi lại đúng dự án cũ đã ngừng hoạt động không bị chặn). Ghi KÉP id + code (FR-40).
    const projectChange = await this.resolveProjectChange(
      appointment,
      dto,
      session,
    );
    if (projectChange) {
      set.projectId = projectChange.to?.id ?? null;
      set.projectCode = projectChange.to?.code ?? null;
      track(
        'project',
        projectChange.from?.label ?? null,
        projectChange.to
          ? projectChange.to.label || String(projectChange.to.id)
          : null,
      );
    }
    let offsets = appointment.remindBeforeMinutes;
    if (dto.remindBeforeMinutes) {
      offsets = normalizeRemindOffsets(dto.remindBeforeMinutes, []);
      if (offsets.join() !== appointment.remindBeforeMinutes.join()) {
        set.remindBeforeMinutes = offsets;
        track('remindBeforeMinutes', appointment.remindBeforeMinutes, offsets);
      }
    }

    if (changes.length === 0) return { appointment, customer };

    set.updatedBy = ctx.actor.userId;
    const updated = await this.writeWithVersion(appointment, set, session);
    await this.refreshCustomer(ctx, appointment.customerId, now, session);
    await this.reminders.syncAppointment(updated, now, session);
    await this.recordAudit(
      ctx,
      updated,
      CrmAuditAction.APPOINTMENT_UPDATED,
      changes,
      null,
      source,
      session,
    );
    return { appointment: updated, customer };
  }

  /**
   * Hoàn thành / hủy / mở lại. Cùng trạng thái hiện tại = không làm gì (`changed: false`) để bấm đúp hoặc gửi lại
   * không báo lỗi và không ghi nhật ký lần hai.
   */
  async changeStatusInSession(
    ctx: AccessContext,
    id: string,
    dto: ChangeAppointmentStatusDto,
    source: CrmAuditSource,
    session: ClientSession,
  ): Promise<{
    appointment: AppointmentLean;
    customer: ScopedCustomer;
    changed: boolean;
  }> {
    const now = new Date();
    const { appointment, customer } = await this.loadInScope(ctx, id, session);
    // Bản ghi chỉ của mình (FR-32): kiểm quyền trước khi xét phiên bản và trạng thái để người ngoài luôn nhận 403.
    assertCanModifyAppointment(ctx.actor, appointment);
    if (dto.version !== undefined && dto.version !== appointment.__v) {
      throw versionConflict(appointment.__v);
    }
    if (dto.status === appointment.status) {
      return { appointment, customer, changed: false };
    }
    if (!canTransitionStatus(appointment.status, dto.status)) {
      throw statusInvalid(
        `Không thể chuyển lịch hẹn từ ${appointment.status} sang ${dto.status}; hãy mở lại lịch (SCHEDULED) trước`,
      );
    }

    const set: Record<string, unknown> = {
      status: dto.status,
      updatedBy: ctx.actor.userId,
    };
    if (dto.status === AppointmentStatus.DONE) {
      set.completedAt = now;
      set.completedBy = ctx.actor.userId;
    } else {
      set.completedAt = null;
      set.completedBy = null;
    }
    if (dto.outcome !== undefined) set.outcome = dto.outcome;

    const changes: CrmAuditChange[] = [
      {
        field: 'appointment.status',
        from: appointment.status,
        to: dto.status,
      },
    ];
    if (dto.outcome !== undefined && dto.outcome !== appointment.outcome) {
      changes.push({
        field: 'appointment.outcome',
        from: appointment.outcome ?? null,
        to: dto.outcome,
      });
    }
    const updated = await this.writeWithVersion(appointment, set, session);
    await this.refreshCustomer(ctx, appointment.customerId, now, session);
    await this.reminders.syncAppointment(updated, now, session);
    await this.recordAudit(
      ctx,
      updated,
      CrmAuditAction.APPOINTMENT_STATUS_CHANGED,
      changes,
      null,
      source,
      session,
    );
    return { appointment: updated, customer, changed: true };
  }

  async deleteInSession(
    ctx: AccessContext,
    id: string,
    reason: string | null,
    source: CrmAuditSource,
    session: ClientSession,
  ): Promise<void> {
    const now = new Date();
    const { appointment } = await this.loadInScope(ctx, id, session);
    assertCanModifyAppointment(ctx.actor, appointment);
    const deleted = await this.writeWithVersion(
      appointment,
      {
        deletedAt: now,
        deletedBy: ctx.actor.userId,
        updatedBy: ctx.actor.userId,
      },
      session,
    );
    await this.refreshCustomer(ctx, appointment.customerId, now, session);
    await this.reminders.syncAppointment(deleted, now, session);
    await this.recordAudit(
      ctx,
      deleted,
      CrmAuditAction.APPOINTMENT_DELETED,
      [],
      reason,
      source,
      session,
    );
  }

  /**
   * Lịch hẹn chưa xóa + khách của nó trong PHẠM VI người gọi. Lịch không tồn tại và lịch của khách ngoài phạm vi (hoặc
   * người gọi vừa bị gỡ khỏi nhóm chăm sóc) cùng trả 404 `RESOURCE_NOT_FOUND` để không lộ sự tồn tại.
   */
  async loadInScope(
    ctx: AccessContext,
    id: string,
    session?: ClientSession,
  ): Promise<{ appointment: AppointmentLean; customer: ScopedCustomer }> {
    const appointment = (await this.appointmentModel
      .findOne({ _id: oid(id), deletedAt: null })
      .session(session ?? null)
      .lean()
      .exec()) as AppointmentLean | null;
    if (!appointment) throw resourceNotFound();
    const customer = (await this.repo.findOne(
      ctx.scope,
      appointment.customerId,
      {
        session,
        projection: CUSTOMER_PROJECTION,
      },
    )) as ScopedCustomer | null;
    if (!customer) throw resourceNotFound();
    return { appointment, customer };
  }

  // --------------------------------------------------------------------------------------------

  private async findCustomer(
    ctx: AccessContext,
    customerId: Types.ObjectId,
    session: ClientSession,
  ): Promise<ScopedCustomer> {
    const customer = (await this.repo.findOne(ctx.scope, customerId, {
      session,
      projection: CUSTOMER_PROJECTION,
    })) as ScopedCustomer | null;
    if (!customer) throw customerNotFound();
    return customer;
  }

  /**
   * Chọn và kiểm CẢ MẢNG người thực hiện (FR-30). Tập hợp lệ của khách = thành viên `careTeam` HIỆN TẠI (đọc trong
   * transaction nên đua với việc gỡ khỏi nhóm bị phát hiện qua xung đột ghi trên document khách) HỢP người tạo khách
   * HỢP Quản lý của nhóm chủ (nhóm của người tạo), bất kể vai trò. Chỉ MỘT lần đọc `users` cho cả mảng; thứ tự lỗi:
   * `NOT_IN_CARE_TEAM` (ngoài tập, gồm id không tồn tại) -> `NOT_ACTIVE` -> `NOT_CRM_ROLE`; `details.userIds` là các
   * id vi phạm của lý do đó. Quản lý nhóm chủ chỉ được tính khi tài khoản thật sự còn vai trò MANAGER.
   *
   * Không chỉ định: người đặt lịch nếu thuộc tập hợp lệ; ngược lại phụ trách chính; không có ai thì 400
   * `NOT_IN_CARE_TEAM` (`userIds = []`). Id mặc định đi qua đúng các bước kiểm như id do client gửi.
   */
  private async resolveAssignees(
    ctx: AccessContext,
    customer: ScopedCustomer,
    requested: Types.ObjectId[] | undefined,
    session: ClientSession,
  ): Promise<Types.ObjectId[]> {
    const careTeam = (customer.careTeam ?? []).map((member) => member.userId);
    const inCareTeam = (userId: Types.ObjectId) =>
      careTeam.some((member) => member.equals(userId));
    const isStaticMember = (userId: Types.ObjectId) =>
      inCareTeam(userId) || isCreator(customer, userId);

    // Ứng viên Manager nhóm chủ chỉ đọc khi thật sự cần (có id ngoài careTeam và không phải người tạo).
    let candidates: Promise<OwnerTeamCandidates> | undefined;
    const loadCandidates = () =>
      (candidates ??= this.ownerTeam.loadCandidates(customer, session));

    let ids = requested;
    if (!ids) {
      const booker = ctx.actor.userId;
      let isBookerEligible = isStaticMember(booker);
      if (!isBookerEligible && ctx.actor.roles.includes(UserRole.MANAGER)) {
        isBookerEligible = isOwnerManager(
          (await loadCandidates()).managerIds,
          booker,
        );
      }
      const fallback = isBookerEligible
        ? booker
        : (customer.primaryAssigneeId ?? undefined);
      if (!fallback) {
        throw assigneeNotAssignable([], AssigneeRejectReason.NOT_IN_CARE_TEAM);
      }
      ids = [fallback];
    }
    ids = uniqueObjectIds(ids);

    const isManagerCheckNeeded = ids.some((id) => !isStaticMember(id));
    const ownerManagerIds = isManagerCheckNeeded
      ? (await loadCandidates()).managerIds
      : [];

    const users = (await this.userModel
      .find({ _id: { $in: ids } })
      .select('roles status deletedAt')
      .session(session)
      .lean()
      .exec()) as AssigneeUser[];
    const byId = new Map(users.map((user) => [String(user._id), user]));

    const outside = ids.filter((id) => {
      if (isStaticMember(id)) return false;
      const user = byId.get(String(id));
      return !(
        user?.roles?.includes(UserRole.MANAGER) &&
        isOwnerManager(ownerManagerIds, id)
      );
    });
    if (outside.length > 0) {
      throw assigneeNotAssignable(
        outside,
        AssigneeRejectReason.NOT_IN_CARE_TEAM,
      );
    }
    const inactive = ids.filter((id) => {
      const user = byId.get(String(id));
      return !user || user.status !== UserStatus.ACTIVE || !!user.deletedAt;
    });
    if (inactive.length > 0) {
      throw assigneeNotAssignable(inactive, AssigneeRejectReason.NOT_ACTIVE);
    }
    const noCrmRole = ids.filter(
      (id) => !hasCrmRole(byId.get(String(id))?.roles ?? []),
    );
    if (noCrmRole.length > 0) {
      throw assigneeNotAssignable(noCrmRole, AssigneeRejectReason.NOT_CRM_ROLE);
    }
    return ids;
  }

  /**
   * Dịch dự án GÁN MỚI từ `projectId` (cũ) và/hoặc `projectCode` (mới) về `{ id, code, label }`. Chỉ nhận dự án còn
   * hoạt động; không có gì thì `null`; không tồn tại/ngừng hoạt động hoặc id và code khác dự án thì 400
   * `VALIDATION_FAILED` (`details.field` là `projectCode` nếu client gửi mã, ngược lại `projectId`).
   */
  private resolveProjectForAssign(
    projectId: Types.ObjectId | null | undefined,
    projectCode: string | null | undefined,
    session: ClientSession,
  ): Promise<CatalogRef | null> {
    return this.refs.resolveOneForAssign(
      'project',
      { id: projectId, code: projectCode },
      projectCode ? 'projectCode' : 'projectId',
      session,
    );
  }

  /**
   * Xác định việc đổi dự án khi sửa lịch. `null` = không đổi gì (bỏ trống, hoặc gửi lại đúng dự án hiện có: bỏ qua
   * kiểm tra "còn hoạt động" để dự án đã ngừng sau khi gắn không chặn việc sửa). Ngược lại trả dự án cũ/mới
   * (`to = null` là gỡ dự án); dự án mới đã được kiểm còn hoạt động và khóa ghi.
   */
  private async resolveProjectChange(
    appointment: AppointmentLean,
    dto: UpdateAppointmentDto,
    session: ClientSession,
  ): Promise<{ from: CatalogRef | null; to: CatalogRef | null } | null> {
    const { projectId, projectCode } = dto;
    if (projectId === undefined && projectCode === undefined) return null;
    assertProjectInputConsistent(projectId, projectCode);

    const currentId = appointment.projectId ?? null;
    const [from = null] = currentId
      ? await this.refs.resolveByIds('project', [currentId], { session })
      : [];
    if (projectId === null || projectCode === null) {
      return currentId ? { from, to: null } : null;
    }

    // Dự án hiện tại có thể không còn trong danh mục (xóa cứng ngoài ứng dụng): lấy mã từ giá trị đã ghi kép trên lịch
    // để gửi lại đúng giá trị đang lưu vẫn là "không đổi" thay vì 400 "không tồn tại".
    const currentCode = from?.code ?? appointment.projectCode ?? null;
    const isSameAsCurrent =
      !!currentId &&
      (!projectId || currentId.equals(oid(projectId))) &&
      (!projectCode || currentCode === projectCode.trim().toUpperCase());
    if (isSameAsCurrent) return null;

    const to = await this.resolveProjectForAssign(
      projectId ? oid(projectId) : null,
      projectCode,
      session,
    );
    await this.refs.lockAndAssert(
      { appointmentProjectId: to?.id ?? null },
      session,
    );
    return { from, to };
  }

  /** Ghi có khóa lạc quan theo `__v` đã đọc (đua ghi => 409) và tăng `__v`. */
  private async writeWithVersion(
    appointment: AppointmentLean,
    set: Record<string, unknown>,
    session: ClientSession,
  ): Promise<AppointmentLean> {
    const updated = (await this.appointmentModel
      .findOneAndUpdate(
        { _id: appointment._id, __v: appointment.__v },
        { $set: set, $inc: { __v: 1 } },
        { returnDocument: 'after', session },
      )
      .lean()
      .exec()) as AppointmentLean | null;
    if (!updated) throw versionConflict(appointment.__v);
    return updated;
  }

  /** `customers.nextAppointmentAt` = lịch SCHEDULED chưa xóa sớm nhất (kể cả đã quá giờ mà chưa xử lý), không đổi `__v`. */
  private async refreshCustomer(
    ctx: AccessContext,
    customerId: Types.ObjectId,
    now: Date,
    session: ClientSession,
  ): Promise<void> {
    const next = await this.appointmentModel
      .findOne({
        customerId,
        status: AppointmentStatus.SCHEDULED,
        deletedAt: null,
      })
      .sort({ startAt: 1 })
      .select('startAt')
      .session(session)
      .lean()
      .exec();
    await this.repo.updateOne(
      ctx.scope,
      customerId,
      {},
      {
        $set: {
          nextAppointmentAt: next?.startAt ?? null,
          lastUpdatedAt: now,
          lastUpdatedBy: ctx.actor.userId,
        },
      },
      { session },
    );
  }

  private recordAudit(
    ctx: AccessContext,
    appointment: AppointmentLean,
    action: CrmAuditAction,
    changes: CrmAuditChange[],
    reason: string | null,
    source: CrmAuditSource,
    session: ClientSession,
  ): Promise<void> {
    return this.audit.record(
      {
        entityType: CrmAuditEntityType.APPOINTMENT,
        entityId: appointment._id,
        customerId: appointment.customerId,
        action,
        actor: { sub: String(ctx.actor.userId) },
        changes,
        reason,
        source,
      },
      session,
    );
  }
}
