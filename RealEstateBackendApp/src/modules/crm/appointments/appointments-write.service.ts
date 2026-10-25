import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import { CRM_TEAM_ROLES } from '../../../common/enums/user-role.enum';
import { UserStatus } from '../../../common/enums/user-status.enum';
import { BusinessException } from '../../../common/exceptions/business.exception';
import { ErrorCode } from '../../../common/exceptions/error-codes';
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
  customerNotFound,
  insufficientRole,
  versionConflict,
} from '../customers/customer.errors';
import { CustomerRefsService } from '../customers/customer-refs.service';
import { CustomersRepository } from '../customers/customers.repository';
import { RemindersWriterService } from '../reminders/reminders-writer.service';
import { AppointmentStatus, AppointmentType } from './appointment.constants';
import { AppointmentCustomerLean, AppointmentLean } from './appointment.mapper';
import {
  assertEndAfterStart,
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
  assigneeId?: Types.ObjectId;
  remindBeforeMinutes?: number[];
  /** Dự án của buổi hẹn (tùy chọn); phải còn hoạt động. */
  projectId?: Types.ObjectId | null;
  sourceCareLogId?: Types.ObjectId | null;
}

/** Field của khách mà việc ghi lịch hẹn cần. */
const CUSTOMER_PROJECTION = {
  fullName: 1,
  statusId: 1,
  careTeam: 1,
  primaryAssigneeId: 1,
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

const assigneeNotAssignable = (userId?: Types.ObjectId): BusinessException =>
  new BusinessException(
    ErrorCode.USER_NOT_ASSIGNABLE,
    'Người thực hiện phải là thành viên đang hoạt động trong nhóm chăm sóc của khách',
    HttpStatus.BAD_REQUEST,
    { userIds: userId ? [String(userId)] : [] },
  );

const iso = (date: Date | null | undefined): string | null =>
  date ? date.toISOString() : null;

/** Khách (đã lọc theo phạm vi) cùng nhóm chăm sóc, dùng để chọn/kiểm người thực hiện. */
interface ScopedCustomer extends AppointmentCustomerLean {
  careTeam?: Array<{ userId: Types.ObjectId }>;
  primaryAssigneeId?: Types.ObjectId | null;
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

    const assigneeId = await this.resolveAssignee(
      ctx,
      customer,
      input.assigneeId,
      session,
    );
    // Dự án gắn MỚI phải còn hoạt động: khóa ghi trong transaction để không đua với việc ngừng/xóa dự án.
    const projectId = input.projectId ?? null;
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
          assigneeId,
          remindBeforeMinutes: offsets,
          status: AppointmentStatus.SCHEDULED,
          projectId,
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

    const maps = await this.refs.resolve({
      userIds: [assigneeId],
      projectIds: [projectId],
    });
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
        to: maps.users.get(String(assigneeId)) ?? String(assigneeId),
      },
    ];
    if (projectId) {
      changes.push({
        field: 'appointment.project',
        from: null,
        to: maps.projects.get(String(projectId)) ?? String(projectId),
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
    const startChanged = startAt.getTime() !== appointment.startAt.getTime();
    if (startChanged) assertStartNotInPast(startAt, now);
    if (startChanged || dto.endAt !== undefined) {
      assertEndAfterStart(startAt, endAt);
    }
    if (startChanged) {
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
    let assigneeId = appointment.assigneeId;
    if (dto.assigneeId && !oid(dto.assigneeId).equals(assigneeId)) {
      assigneeId = await this.resolveAssignee(
        ctx,
        customer,
        oid(dto.assigneeId),
        session,
      );
      const maps = await this.refs.resolve({
        userIds: [appointment.assigneeId, assigneeId],
      });
      set.assigneeId = assigneeId;
      track(
        'assignee',
        maps.users.get(String(appointment.assigneeId)) ?? null,
        maps.users.get(String(assigneeId)) ?? String(assigneeId),
      );
    }
    // `projectId`: bỏ trống = giữ nguyên; null = gỡ; đổi sang dự án KHÁC thì dự án mới phải còn hoạt động
    // (gửi lại đúng dự án cũ đã ngừng hoạt động không bị chặn).
    if (dto.projectId !== undefined) {
      const nextProjectId = dto.projectId ? oid(dto.projectId) : null;
      const currentProjectId = appointment.projectId ?? null;
      const isSame =
        nextProjectId === null
          ? currentProjectId === null
          : !!currentProjectId && currentProjectId.equals(nextProjectId);
      if (!isSame) {
        await this.refs.lockAndAssert(
          { appointmentProjectId: nextProjectId },
          session,
        );
        const maps = await this.refs.resolve({
          projectIds: [currentProjectId, nextProjectId],
        });
        set.projectId = nextProjectId;
        track(
          'project',
          currentProjectId
            ? (maps.projects.get(String(currentProjectId)) ?? null)
            : null,
          nextProjectId
            ? (maps.projects.get(String(nextProjectId)) ??
                String(nextProjectId))
            : null,
        );
      }
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
    isAllowed: (appointment: AppointmentLean) => boolean,
  ): Promise<void> {
    const now = new Date();
    const { appointment } = await this.loadInScope(ctx, id, session);
    if (!isAllowed(appointment)) {
      throw insufficientRole();
    }
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
   * Chọn và kiểm người thực hiện: phải thuộc nhóm chăm sóc HIỆN TẠI của khách (đọc trong transaction nên đua với
   * việc gỡ khỏi nhóm bị phát hiện qua xung đột ghi trên document khách), còn ACTIVE và là Quản lý/Nhân viên.
   * Không chỉ định: chính người gọi nếu thuộc nhóm; Quản trị/Quản lý ngoài nhóm thì phụ trách chính.
   */
  private async resolveAssignee(
    ctx: AccessContext,
    customer: ScopedCustomer,
    requested: Types.ObjectId | undefined,
    session: ClientSession,
  ): Promise<Types.ObjectId> {
    const team = (customer.careTeam ?? []).map((member) => member.userId);
    const inTeam = (userId: Types.ObjectId) =>
      team.some((member) => member.equals(userId));

    let assigneeId = requested;
    if (!assigneeId) {
      assigneeId = inTeam(ctx.actor.userId)
        ? ctx.actor.userId
        : (customer.primaryAssigneeId ?? undefined);
    }
    if (!assigneeId || !inTeam(assigneeId)) {
      throw assigneeNotAssignable(requested);
    }
    const active = await this.userModel
      .exists({
        _id: assigneeId,
        status: UserStatus.ACTIVE,
        role: { $in: CRM_TEAM_ROLES },
        deletedAt: null,
      })
      .session(session)
      .exec();
    if (!active) throw assigneeNotAssignable(assigneeId);
    return assigneeId;
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
