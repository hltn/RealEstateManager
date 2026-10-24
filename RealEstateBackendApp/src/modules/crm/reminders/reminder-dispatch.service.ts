import { Injectable, Logger } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { ClientSession, Connection, Model, Types } from 'mongoose';
import { formatVnDateTime } from '../../../common/utils/timezone.util';
import { withTransaction } from '../../../shared/database/with-transaction.util';
import {
  NotificationPriority,
  NotificationType,
} from '../../notifications/notification.constants';
import {
  NewNotification,
  NotificationsService,
} from '../../notifications/notifications.service';
import {
  APPOINTMENT_TYPE_LABELS,
  AppointmentStatus,
} from '../appointments/appointment.constants';
import {
  Appointment,
  AppointmentDocument,
} from '../appointments/schemas/appointment.schema';
import { CareLog, CareLogDocument } from '../care-logs/schemas/care-log.schema';
import { CustomersRepository } from '../customers/customers.repository';
import {
  PersonaField,
  PersonaFieldDocument,
} from '../persona/schemas/persona-field.schema';
import {
  REMINDER_BATCH_LIMIT,
  REMINDER_LOCK_TTL_MS,
  REMINDER_MAX_ATTEMPTS,
  ReminderStatus,
  ReminderType,
} from './reminder.constants';
import { Reminder, ReminderDocument } from './schemas/reminder.schema';

export interface DispatchResult {
  /** Nhắc việc đã nhận xử lý trong lượt này. */
  claimed: number;
  /** Đã ghi thông báo và đánh dấu SENT. */
  sent: number;
  /** Không còn hiệu lực (lịch đã dời/hủy/hoàn thành, khách bị xóa, không còn ai để nhắc...). */
  canceled: number;
  /** Lỗi tạm (thử lại ở nhịp sau) hoặc bỏ cuộc sau `REMINDER_MAX_ATTEMPTS` lần. */
  failed: number;
}

type ReminderLean = Reminder & { _id: Types.ObjectId };

/** Kết quả đánh giá một nhắc việc trong transaction. */
type Decision =
  | { action: 'SEND'; notifications: NewNotification[] }
  | { action: 'CANCEL' };

/** Nhắc việc không còn thuộc về lần nhận này (đã bị hủy/nhận lại): bỏ qua im lặng, không phải lỗi. */
class ClaimLostError extends Error {}

const CUSTOMER_PROJECTION =
  'fullName careTeam primaryAssigneeId lastCareLogAt createdAt';

type DispatchCustomer = {
  _id: Types.ObjectId;
  fullName: string;
  careTeam?: Array<{ userId: Types.ObjectId }>;
  primaryAssigneeId?: Types.ObjectId | null;
  lastCareLogAt?: Date | null;
};

/**
 * Gửi nhắc việc đến hạn thành thông báo trong ứng dụng (tài liệu 04 mục 6.4). Đúng hạn và không trùng:
 * - NHẬN: `findOneAndUpdate` nguyên tử PENDING (đã đến `fireAt`) -> PROCESSING, nên nhiều instance/nhiều nhịp chồng nhau
 *   chỉ một bên nhận được một nhắc; nhắc kẹt ở PROCESSING quá `REMINDER_LOCK_TTL_MS` (instance chết) được nhận lại;
 * - GỬI: trong MỘT transaction, đọc lại lịch hẹn/nhật ký/khách (đã dời, hủy, xóa, gỡ khỏi nhóm?), ghi thông báo
 *   (`dedupeKey` duy nhất theo người nhận nên retry không nhân đôi) và chốt trạng thái có điều kiện theo lần nhận;
 *   hủy/dời lịch đồng thời ghi cùng document nhắc nên một bên xung đột và chạy lại thấy trạng thái mới;
 * - NGƯỜI NHẬN tính lại theo nhóm chăm sóc HIỆN TẠI (QT8: người bị gỡ không nhận), phụ trách chính ưu tiên `HIGH`;
 * - LỖI: thử lại ở nhịp sau, tối đa `REMINDER_MAX_ATTEMPTS` lần rồi FAILED.
 * Trước khi M7 có push, "gửi" chỉ là ghi hộp thông báo (`pushStatus = SKIPPED`).
 */
@Injectable()
export class ReminderDispatchService {
  private readonly logger = new Logger(ReminderDispatchService.name);

  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(Reminder.name)
    private readonly reminderModel: Model<ReminderDocument>,
    @InjectModel(Appointment.name)
    private readonly appointmentModel: Model<AppointmentDocument>,
    @InjectModel(CareLog.name)
    private readonly careLogModel: Model<CareLogDocument>,
    @InjectModel(PersonaField.name)
    private readonly personaFieldModel: Model<PersonaFieldDocument>,
    private readonly customers: CustomersRepository,
    private readonly notifications: NotificationsService,
  ) {}

  async dispatchDue(now = new Date()): Promise<DispatchResult> {
    const result: DispatchResult = {
      claimed: 0,
      sent: 0,
      canceled: 0,
      failed: 0,
    };
    while (result.claimed < REMINDER_BATCH_LIMIT) {
      const reminder = await this.claimNext(now);
      if (!reminder) break;
      result.claimed += 1;
      const outcome = await this.process(reminder, now);
      result[outcome] += 1;
    }
    return result;
  }

  /** Nhận nguyên tử nhắc đến hạn sớm nhất (hoặc nhắc kẹt quá hạn khóa); `lockedAt` là dấu của lần nhận này. */
  private claimNext(now: Date): Promise<ReminderLean | null> {
    return this.reminderModel
      .findOneAndUpdate(
        {
          $or: [
            { status: ReminderStatus.PENDING, fireAt: { $lte: now } },
            {
              status: ReminderStatus.PROCESSING,
              lockedAt: { $lt: new Date(now.getTime() - REMINDER_LOCK_TTL_MS) },
            },
          ],
        },
        {
          $set: { status: ReminderStatus.PROCESSING, lockedAt: now },
          $inc: { attempts: 1 },
        },
        { sort: { fireAt: 1 }, returnDocument: 'after', timestamps: false },
      )
      .lean()
      .exec();
  }

  private async process(
    reminder: ReminderLean,
    now: Date,
  ): Promise<'sent' | 'canceled' | 'failed'> {
    try {
      return await withTransaction(this.connection, async (session) => {
        // Đọc lại nhắc trong transaction: còn đúng lần nhận này thì mới xử lý.
        const current = await this.reminderModel
          .findOne({
            _id: reminder._id,
            status: ReminderStatus.PROCESSING,
            lockedAt: reminder.lockedAt,
          })
          .session(session)
          .lean()
          .exec();
        if (!current) throw new ClaimLostError();

        const decision = await this.evaluate(current, now, session);
        const finished =
          decision.action === 'SEND'
            ? { status: ReminderStatus.SENT, sentAt: now, finishedAt: now }
            : { status: ReminderStatus.CANCELED, finishedAt: now };
        const marked = await this.reminderModel
          .updateOne(
            {
              _id: reminder._id,
              status: ReminderStatus.PROCESSING,
              lockedAt: reminder.lockedAt,
            },
            { $set: finished },
            { session, timestamps: false },
          )
          .exec();
        if (marked.matchedCount !== 1) throw new ClaimLostError();

        if (decision.action === 'CANCEL') return 'canceled' as const;
        await this.notifications.createMany(decision.notifications, session);
        return 'sent' as const;
      });
    } catch (error) {
      if (error instanceof ClaimLostError) return 'canceled';
      return this.handleFailure(reminder, error as Error, now);
    }
  }

  /** Lỗi tạm: nhả về PENDING để nhịp sau thử lại; quá số lần cho phép thì FAILED (kết thúc, chờ TTL dọn). */
  private async handleFailure(
    reminder: ReminderLean,
    error: Error,
    now: Date,
  ): Promise<'failed'> {
    const exhausted = reminder.attempts >= REMINDER_MAX_ATTEMPTS;
    this.logger.error(
      `Gửi nhắc việc ${String(reminder._id)} (${reminder.type}) lần ${reminder.attempts} thất bại${exhausted ? ', bỏ cuộc' : ''}: ${error.message}`,
    );
    await this.reminderModel
      .updateOne(
        {
          _id: reminder._id,
          status: ReminderStatus.PROCESSING,
          lockedAt: reminder.lockedAt,
        },
        {
          $set: exhausted
            ? { status: ReminderStatus.FAILED, finishedAt: now }
            : { status: ReminderStatus.PENDING, lockedAt: null },
        },
        { timestamps: false },
      )
      .exec()
      .catch(() => undefined);
    return 'failed';
  }

  /** Quyết định gửi hay hủy, dựng thông báo cho đúng người nhận hiện tại. Chỉ đọc (trong transaction). */
  private async evaluate(
    reminder: ReminderLean,
    now: Date,
    session: ClientSession,
  ): Promise<Decision> {
    const customer = (await this.customers.findForSystemJobById(
      reminder.customerId,
      CUSTOMER_PROJECTION,
      session,
    )) as DispatchCustomer | null;
    if (!customer) return { action: 'CANCEL' };

    switch (reminder.type) {
      case ReminderType.APPOINTMENT:
        return this.evaluateAppointment(reminder, customer, now, session);
      case ReminderType.FOLLOW_UP:
        return this.evaluateFollowUp(reminder, customer, session);
      case ReminderType.OCCASION:
        return this.evaluateOccasion(reminder, customer, session);
      case ReminderType.STALE_CUSTOMER:
        return this.evaluateStale(reminder, customer);
    }
  }

  private async evaluateAppointment(
    reminder: ReminderLean,
    customer: DispatchCustomer,
    now: Date,
    session: ClientSession,
  ): Promise<Decision> {
    const appointment = await this.appointmentModel
      .findOne({
        _id: reminder.refId,
        deletedAt: null,
        status: AppointmentStatus.SCHEDULED,
      })
      .session(session)
      .lean()
      .exec();
    // Lịch đã dời (giờ khác mốc mà nhắc này nói tới), đã bắt đầu, hủy, hoàn thành hay xóa => nhắc này vô nghĩa.
    if (
      !appointment ||
      !reminder.dueAt ||
      appointment.startAt.getTime() !== reminder.dueAt.getTime() ||
      appointment.startAt.getTime() <= now.getTime()
    ) {
      return { action: 'CANCEL' };
    }
    return this.buildDecision(reminder, customer, [appointment.assigneeId], {
      type: NotificationType.APPOINTMENT_DUE,
      title: 'Sắp đến giờ hẹn',
      body: `${APPOINTMENT_TYPE_LABELS[appointment.type]} với khách ${customer.fullName} lúc ${formatVnDateTime(appointment.startAt)}`,
      appointmentId: appointment._id,
    });
  }

  private async evaluateFollowUp(
    reminder: ReminderLean,
    customer: DispatchCustomer,
    session: ClientSession,
  ): Promise<Decision> {
    const log = await this.careLogModel
      .findOne({ _id: reminder.refId, deletedAt: null })
      .session(session)
      .lean()
      .exec();
    // Chỉ nhắc khi đây vẫn là nhật ký MỚI NHẤT của khách (có nhật ký mới hơn = đã chăm sóc xong), hạn chưa đổi,
    // và chưa có lịch hẹn đi kèm.
    if (
      !log?.nextAction?.dueAt ||
      !reminder.dueAt ||
      log.nextAction.dueAt.getTime() !== reminder.dueAt.getTime() ||
      log.nextAction.appointmentId ||
      !customer.lastCareLogAt ||
      log.occurredAt.getTime() !== customer.lastCareLogAt.getTime()
    ) {
      return { action: 'CANCEL' };
    }
    return this.buildDecision(reminder, customer, [log.authorId], {
      type: NotificationType.FOLLOW_UP_DUE,
      title: 'Đến hạn chăm sóc tiếp theo',
      body: `Đến hạn chăm sóc tiếp theo với khách ${customer.fullName}`,
    });
  }

  private async evaluateOccasion(
    reminder: ReminderLean,
    customer: DispatchCustomer,
    session: ClientSession,
  ): Promise<Decision> {
    const payload = reminder.payload;
    const field = payload?.fieldKey
      ? await this.personaFieldModel
          .findOne({ key: payload.fieldKey })
          .select('label occasionLabel')
          .session(session)
          .lean()
          .exec()
      : null;
    const label = (
      field?.occasionLabel ??
      field?.label ??
      'Dịp đặc biệt'
    ).toLowerCase();
    const when =
      payload?.leadDays === 0
        ? 'Hôm nay'
        : payload?.leadDays === 1
          ? 'Ngày mai'
          : `${payload?.leadDays ?? ''} ngày nữa`.trim();
    const memberIds = (customer.careTeam ?? []).map((member) => member.userId);
    return this.buildDecision(reminder, customer, memberIds, {
      type: NotificationType.CUSTOMER_OCCASION,
      title: 'Dịp đặc biệt của khách',
      body: `${when} là ${label} của khách ${customer.fullName}`,
    });
  }

  private evaluateStale(
    reminder: ReminderLean,
    customer: DispatchCustomer,
  ): Decision {
    return this.buildDecision(reminder, customer, [], {
      type: NotificationType.STALE_CUSTOMER,
      title: 'Khách lâu chưa chăm sóc',
      body: `Khách ${customer.fullName} đã lâu chưa được chăm sóc`,
    });
  }

  /**
   * Người nhận = (`candidates` + phụ trách chính hiện tại) giao với nhóm chăm sóc HIỆN TẠI. Không còn ai thì hủy
   * (không có người để nhắc). Phụ trách chính nhận `HIGH`, còn lại `NORMAL`.
   */
  private buildDecision(
    reminder: ReminderLean,
    customer: DispatchCustomer,
    candidates: Types.ObjectId[],
    content: {
      type: NotificationType;
      title: string;
      body: string;
      appointmentId?: Types.ObjectId;
    },
  ): Decision {
    const team = new Map(
      (customer.careTeam ?? []).map((member) => [
        String(member.userId),
        member.userId,
      ]),
    );
    const primaryId = customer.primaryAssigneeId ?? null;
    const wanted = new Map<string, Types.ObjectId>();
    for (const userId of [...candidates, ...(primaryId ? [primaryId] : [])]) {
      if (team.has(String(userId))) wanted.set(String(userId), userId);
    }
    if (wanted.size === 0) return { action: 'CANCEL' };

    const deepLink = content.appointmentId
      ? `/crm/customers/${String(customer._id)}?appointmentId=${String(content.appointmentId)}`
      : `/crm/customers/${String(customer._id)}`;
    return {
      action: 'SEND',
      notifications: [...wanted.values()].map((userId) => ({
        userId,
        type: content.type,
        title: content.title,
        body: content.body,
        priority:
          primaryId && userId.equals(primaryId)
            ? NotificationPriority.HIGH
            : NotificationPriority.NORMAL,
        data: {
          customerId: customer._id,
          ...(content.appointmentId && {
            appointmentId: content.appointmentId,
          }),
          deepLink,
        },
        dedupeKey: reminder.dedupeKey,
      })),
    };
  }
}
