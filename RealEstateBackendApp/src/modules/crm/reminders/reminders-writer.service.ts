import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import { AppointmentStatus } from '../appointments/appointment.constants';
import { planAppointmentReminders } from '../appointments/appointment.rules';
import {
  Appointment,
  AppointmentDocument,
} from '../appointments/schemas/appointment.schema';
import { CareLog, CareLogDocument } from '../care-logs/schemas/care-log.schema';
import { ReminderStatus, ReminderType } from './reminder.constants';
import { appointmentDedupeKey, followUpDedupeKey } from './reminder-planner';
import { Reminder, ReminderDocument } from './schemas/reminder.schema';

/** Phần của lịch hẹn mà việc đồng bộ nhắc việc cần. */
export interface ReminderAppointmentInput {
  _id: Types.ObjectId;
  customerId: Types.ObjectId;
  assigneeId: Types.ObjectId;
  startAt: Date;
  status: AppointmentStatus;
  deletedAt?: Date | null;
  remindBeforeMinutes: number[];
}

const ACTIVE_STATUSES = [ReminderStatus.PENDING, ReminderStatus.PROCESSING];

/**
 * Ghi/hủy nhắc việc (`reminders`) trong CÙNG transaction với thay đổi lịch hẹn/nhật ký/khách (không có việc nào
 * ngoài DB nên an toàn khi transaction retry). Là "hàng đợi bền": job nhắc thật sự (đến hạn thì gửi) do
 * `ReminderDispatchService` nhận bằng cách chiếm bản ghi PENDING đến hạn.
 *
 * Gọi hàm này SAU khi đã ghi (cập nhật) document lịch hẹn/nhật ký trong transaction: lệnh ghi đó làm hai request
 * sửa cùng một lịch hẹn xung đột ghi và xếp hàng nối tiếp, nên không có hai transaction cùng upsert một `dedupeKey`.
 */
@Injectable()
export class RemindersWriterService {
  constructor(
    @InjectModel(Reminder.name)
    private readonly reminderModel: Model<ReminderDocument>,
    @InjectModel(Appointment.name)
    private readonly appointmentModel: Model<AppointmentDocument>,
    @InjectModel(CareLog.name)
    private readonly careLogModel: Model<CareLogDocument>,
  ) {}

  /**
   * Làm cho nhắc của một lịch hẹn khớp trạng thái hiện tại: lịch SCHEDULED chưa xóa => đủ các mốc còn ở tương lai
   * (tạo mới, mở lại bản đã hủy); khác (hoàn thành, hủy, xóa mềm) hoặc mốc không còn trong kế hoạch (dời giờ, đổi
   * mốc nhắc) => hủy các nhắc chưa gửi. Nhắc đã gửi (SENT) giữ nguyên.
   */
  async syncAppointment(
    appointment: ReminderAppointmentInput,
    now: Date,
    session: ClientSession,
  ): Promise<void> {
    const active =
      appointment.status === AppointmentStatus.SCHEDULED &&
      !appointment.deletedAt;
    const planned = active
      ? planAppointmentReminders(
          appointment.startAt,
          appointment.remindBeforeMinutes,
          now,
        )
      : [];
    const keys = planned.map((reminder) =>
      appointmentDedupeKey(
        appointment._id,
        reminder.offsetMinutes,
        appointment.startAt,
      ),
    );

    if (planned.length > 0) {
      await this.reminderModel.bulkWrite(
        planned.map((reminder, index) => ({
          updateOne: {
            filter: { dedupeKey: keys[index] },
            update: {
              $setOnInsert: {
                type: ReminderType.APPOINTMENT,
                customerId: appointment.customerId,
                refId: appointment._id,
                recipientIds: [appointment.assigneeId],
                priorityRecipientId: null,
                fireAt: reminder.fireAt,
                dueAt: appointment.startAt,
                status: ReminderStatus.PENDING,
                dedupeKey: keys[index],
                attempts: 0,
                lockedAt: null,
                sentAt: null,
                finishedAt: null,
                payload: null,
                createdAt: now,
                updatedAt: now,
              },
            },
            upsert: true,
          },
        })),
        { session, ordered: true, timestamps: false },
      );
      // Mốc từng bị hủy (lịch bị hủy/đã dời đi rồi quay lại đúng giờ cũ) được dùng lại thay vì tạo bản mới.
      await this.reminderModel
        .updateMany(
          { dedupeKey: { $in: keys }, status: ReminderStatus.CANCELED },
          {
            $set: {
              status: ReminderStatus.PENDING,
              lockedAt: null,
              finishedAt: null,
              attempts: 0,
            },
          },
          { session, timestamps: false },
        )
        .exec();
    }

    await this.cancelWhere(
      {
        type: ReminderType.APPOINTMENT,
        refId: appointment._id,
        dedupeKey: { $nin: keys },
      },
      now,
      session,
    );
  }

  /**
   * Nhắc "bước tiếp theo" của một nhật ký: chỉ khi `dueAt` còn ở tương lai và chưa có lịch hẹn đi kèm (lịch hẹn đã có
   * nhắc riêng). Nhắc tự kiểm "nhật ký này còn là mới nhất" lúc gửi nên không phải hủy khi có nhật ký mới hơn.
   */
  async syncFollowUp(
    careLog: {
      _id: Types.ObjectId;
      customerId: Types.ObjectId;
      authorId: Types.ObjectId;
      dueAt: Date | null;
      appointmentId: Types.ObjectId | null;
    },
    now: Date,
    session: ClientSession,
  ): Promise<void> {
    if (
      !careLog.dueAt ||
      careLog.appointmentId ||
      careLog.dueAt.getTime() <= now.getTime()
    ) {
      await this.cancelFollowUp(careLog._id, now, session);
      return;
    }
    const key = followUpDedupeKey(careLog._id, careLog.dueAt);
    await this.reminderModel.updateOne(
      { dedupeKey: key },
      {
        $setOnInsert: {
          type: ReminderType.FOLLOW_UP,
          customerId: careLog.customerId,
          refId: careLog._id,
          recipientIds: [careLog.authorId],
          priorityRecipientId: null,
          fireAt: careLog.dueAt,
          dueAt: careLog.dueAt,
          status: ReminderStatus.PENDING,
          dedupeKey: key,
          attempts: 0,
          lockedAt: null,
          sentAt: null,
          finishedAt: null,
          payload: null,
          createdAt: now,
          updatedAt: now,
        },
      },
      { upsert: true, session, timestamps: false },
    );
    await this.cancelWhere(
      {
        type: ReminderType.FOLLOW_UP,
        refId: careLog._id,
        dedupeKey: { $ne: key },
      },
      now,
      session,
    );
  }

  cancelFollowUp(
    careLogId: Types.ObjectId,
    now: Date,
    session: ClientSession,
  ): Promise<number> {
    return this.cancelWhere(
      { type: ReminderType.FOLLOW_UP, refId: careLogId },
      now,
      session,
    );
  }

  /** Hủy MỌI nhắc chưa gửi của một khách (xóa mềm, ẩn danh hóa). Trả số nhắc đã hủy. */
  cancelForCustomer(
    customerId: Types.ObjectId,
    now: Date,
    session: ClientSession,
  ): Promise<number> {
    return this.cancelWhere({ customerId }, now, session);
  }

  /**
   * Dựng lại nhắc cho khách vừa được khôi phục: các lịch hẹn SCHEDULED còn ở tương lai và bước tiếp theo còn hạn
   * (nhắc đã bị hủy lúc xóa mềm).
   */
  async resyncCustomer(
    customerId: Types.ObjectId,
    now: Date,
    session: ClientSession,
  ): Promise<void> {
    const appointments = await this.appointmentModel
      .find({
        customerId,
        status: AppointmentStatus.SCHEDULED,
        deletedAt: null,
        startAt: { $gt: now },
      })
      .session(session)
      .lean()
      .exec();
    for (const appointment of appointments) {
      await this.syncAppointment(appointment, now, session);
    }
    const followUps = await this.careLogModel
      .find({
        customerId,
        deletedAt: null,
        'nextAction.dueAt': { $gt: now },
        'nextAction.appointmentId': null,
      })
      .select('customerId authorId nextAction')
      .session(session)
      .lean()
      .exec();
    for (const log of followUps) {
      await this.syncFollowUp(
        {
          _id: log._id,
          customerId: log.customerId,
          authorId: log.authorId,
          dueAt: log.nextAction?.dueAt ?? null,
          appointmentId: log.nextAction?.appointmentId ?? null,
        },
        now,
        session,
      );
    }
  }

  private async cancelWhere(
    filter: Record<string, unknown>,
    now: Date,
    session: ClientSession,
  ): Promise<number> {
    const result = await this.reminderModel
      .updateMany(
        { ...filter, status: { $in: ACTIVE_STATUSES } },
        { $set: { status: ReminderStatus.CANCELED, finishedAt: now } },
        { session, timestamps: false },
      )
      .exec();
    return result.modifiedCount;
  }
}
