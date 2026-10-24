import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { isDuplicateKeyError } from '../../../common/utils/mongo-error.util';
import { vnDateKey } from '../../../common/utils/timezone.util';
import { ListGroup } from '../catalogs/catalog.enums';
import {
  CustomerStatus,
  CustomerStatusDocument,
} from '../catalogs/schemas/customer-status.schema';
import { CrmSettingsService } from '../crm-settings/crm-settings.service';
import { occasionDueAt } from '../appointments/daily-task.rules';
import { CustomersRepository } from '../customers/customers.repository';
import { ReminderStatus, ReminderType } from './reminder.constants';
import {
  buildOccasionTargets,
  occasionDedupeKey,
  occasionFallsOn,
  staleAnchorDate,
  staleDedupeKey,
} from './reminder-planner';
import { Reminder, ReminderDocument } from './schemas/reminder.schema';

const SCAN_BATCH_SIZE = 200;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

type NewReminder = Omit<Reminder, 'createdAt' | 'updatedAt'>;

interface ScannedCustomer {
  _id: Types.ObjectId;
  primaryAssigneeId?: Types.ObjectId | null;
  careTeam?: Array<{ userId: Types.ObjectId }>;
  occasions?: Array<{ fieldKey: string; month: number; day: number }>;
  lastCareLogAt?: Date | null;
  createdAt: Date;
}

/**
 * Quét định kỳ tạo nhắc việc (tài liệu 04 mục 6.4): dịp đặc biệt (`occasions`, sinh nhật/kỷ niệm) và khách lâu chưa
 * chăm sóc. Chỉ TẠO bản ghi `reminders` (đến hạn ngay); việc gửi do `ReminderDispatchService`. Quét lại bao nhiêu lần
 * cũng không sinh nhắc thứ hai nhờ `dedupeKey` duy nhất (upsert `$setOnInsert`; hai instance cùng quét thì bên thua
 * E11000 được bỏ qua). Duyệt khách theo lô `_id` nên không nạp cả tập vào bộ nhớ.
 */
@Injectable()
export class ReminderScannerService {
  private readonly logger = new Logger(ReminderScannerService.name);

  constructor(
    @InjectModel(Reminder.name)
    private readonly reminderModel: Model<ReminderDocument>,
    @InjectModel(CustomerStatus.name)
    private readonly statusModel: Model<CustomerStatusDocument>,
    private readonly customers: CustomersRepository,
    private readonly settings: CrmSettingsService,
  ) {}

  /** Tạo nhắc dịp đặc biệt cho hôm nay và các ngày `occasionLeadDays` tới (giờ VN). Trả số nhắc MỚI tạo. */
  async scanOccasions(now = new Date()): Promise<number> {
    const { occasionLeadDays } = await this.settings.get();
    const targets = buildOccasionTargets(vnDateKey(now), occasionLeadDays);
    const droppedStatusIds = await this.statusIdsOf([ListGroup.DROPPED]);
    let created = 0;

    for (const target of targets) {
      const [, month, day] = target.dateKey.split('-').map(Number);
      // 29/02 của người sinh năm nhuận được nhắc vào 28/02 ở năm không nhuận.
      const days = month === 2 && day === 28 ? [28, 29] : [day];
      const reminders: NewReminder[] = [];
      await this.forEachBatch(
        {
          $or: days.map((matchDay) => ({
            occasions: { $elemMatch: { month, day: matchDay } },
          })),
          'careTeam.0': { $exists: true },
          statusId: { $nin: droppedStatusIds },
          anonymizedAt: null,
        },
        'occasions primaryAssigneeId careTeam.userId createdAt',
        (customer) => {
          for (const occasion of customer.occasions ?? []) {
            if (!occasionFallsOn(occasion, target.dateKey)) continue;
            reminders.push({
              type: ReminderType.OCCASION,
              customerId: customer._id,
              refId: null,
              recipientIds: (customer.careTeam ?? []).map(
                (member) => member.userId,
              ),
              priorityRecipientId: customer.primaryAssigneeId ?? null,
              fireAt: now,
              dueAt: occasionDueAt(target.dateKey),
              status: ReminderStatus.PENDING,
              dedupeKey: occasionDedupeKey(
                customer._id,
                occasion.fieldKey,
                target.dateKey,
                target.leadDays,
              ),
              attempts: 0,
              lockedAt: null,
              sentAt: null,
              finishedAt: null,
              payload: {
                fieldKey: occasion.fieldKey,
                occurrenceDate: target.dateKey,
                leadDays: target.leadDays,
              },
            });
          }
        },
      );
      created += await this.insertReminders(reminders, now);
    }
    return created;
  }

  /**
   * Tạo nhắc cho khách Chưa tiếp cận/Có quan tâm quá `staleCustomerDays` ngày chưa có nhật ký. Một nhắc cho mỗi "đợt"
   * (xem `staleDedupeKey`), gửi cho phụ trách chính. Trả số nhắc MỚI tạo.
   */
  async scanStale(now = new Date()): Promise<number> {
    const { staleCustomerDays } = await this.settings.get();
    const cutoff = new Date(now.getTime() - staleCustomerDays * MS_PER_DAY);
    const staleStatusIds = await this.statusIdsOf([
      ListGroup.NOT_CONTACTED,
      ListGroup.INTERESTED,
    ]);
    const reminders: NewReminder[] = [];
    await this.forEachBatch(
      {
        statusId: { $in: staleStatusIds },
        'careTeam.0': { $exists: true },
        anonymizedAt: null,
        primaryAssigneeId: { $ne: null },
        $or: [
          { lastCareLogAt: { $lt: cutoff } },
          { lastCareLogAt: null, createdAt: { $lt: cutoff } },
        ],
      },
      'primaryAssigneeId lastCareLogAt createdAt',
      (customer) => {
        reminders.push({
          type: ReminderType.STALE_CUSTOMER,
          customerId: customer._id,
          refId: null,
          recipientIds: customer.primaryAssigneeId
            ? [customer.primaryAssigneeId]
            : [],
          priorityRecipientId: customer.primaryAssigneeId ?? null,
          fireAt: now,
          dueAt: now,
          status: ReminderStatus.PENDING,
          dedupeKey: staleDedupeKey(
            customer._id,
            staleAnchorDate(customer.lastCareLogAt, customer.createdAt),
          ),
          attempts: 0,
          lockedAt: null,
          sentAt: null,
          finishedAt: null,
          payload: null,
        });
      },
    );
    return this.insertReminders(reminders, now);
  }

  // --------------------------------------------------------------------------------------------

  private async forEachBatch(
    filter: Record<string, unknown>,
    projection: string,
    visit: (customer: ScannedCustomer) => void,
  ): Promise<void> {
    let afterId: Types.ObjectId | undefined;
    for (;;) {
      const batch = (await this.customers.findForSystemJobBatch(filter, {
        projection,
        afterId,
        limit: SCAN_BATCH_SIZE,
      })) as unknown as ScannedCustomer[];
      batch.forEach(visit);
      if (batch.length < SCAN_BATCH_SIZE) return;
      afterId = batch[batch.length - 1]._id;
    }
  }

  /** Upsert `$setOnInsert` theo `dedupeKey`; bản đã có (kể cả đã gửi) giữ nguyên. Trả số bản MỚI. */
  private async insertReminders(
    reminders: NewReminder[],
    now: Date,
  ): Promise<number> {
    if (reminders.length === 0) return 0;
    try {
      const result = await this.reminderModel.bulkWrite(
        reminders.map((reminder) => ({
          updateOne: {
            filter: { dedupeKey: reminder.dedupeKey },
            update: {
              $setOnInsert: { ...reminder, createdAt: now, updatedAt: now },
            },
            upsert: true,
          },
        })),
        { ordered: false, timestamps: false },
      );
      return result.upsertedCount;
    } catch (error) {
      // Instance khác quét cùng lúc và đã tạo trước: không phải lỗi, nhắc đã có đúng một bản.
      if (isDuplicateKeyError(error)) {
        this.logger.debug('Bỏ qua nhắc việc trùng khi quét đồng thời');
        return 0;
      }
      throw error;
    }
  }

  private async statusIdsOf(groups: ListGroup[]): Promise<Types.ObjectId[]> {
    const statuses = await this.statusModel
      .find({ listGroup: { $in: groups } })
      .select('_id')
      .lean()
      .exec();
    return statuses.map((status) => status._id);
  }
}
