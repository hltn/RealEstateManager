import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  FeatureFlag,
  FeatureFlagService,
} from '../../../shared/feature-flags/feature-flag.service';
import { QueueNames } from '../../../shared/queue/queue.constants';
import { QueueRuntimeService } from '../../../shared/queue/queue-runtime.service';
import { NotificationPushStatus } from '../notification.constants';
import {
  Notification,
  NotificationDocument,
} from '../schemas/notification.schema';
import { getPushCatalogEntry } from './push-catalog';
import { PUSH_PROVIDER, type PushProvider } from './push-provider.interface';
import { PushJobNames, pushSendJobId } from './push-queue.constants';

/** Mỗi lượt quét xử lý tối đa bấy nhiêu thông báo (Architecture 5.3). */
export const PUSH_SWEEP_BATCH_SIZE = 200;
/** Chỉ quét thông báo `PENDING` đã quá tuổi này, để không tranh với job vừa xếp sau commit. */
export const PUSH_SWEEP_MIN_AGE_MS = 30 * 1000;
/** Nhịp job lặp quét: 60 giây. */
export const PUSH_SWEEP_EVERY_MS = 60 * 1000;
/** Loại ngoài danh mục: cùng mặc định với worker `push.send`. */
const DEFAULT_TTL_SECONDS = 24 * 60 * 60;

export interface PushSweepResult {
  /** Số thông báo được xếp lại job `push.send` (BullMQ tự bỏ qua nếu job cùng `jobId` đã có). */
  enqueued: number;
  /** Số thông báo chuyển `SKIPPED` (cờ tắt hoặc quá TTL của loại). */
  skipped: number;
}

/**
 * Lưới an toàn của mô hình outbox (job lặp `push.sweep`, FR-03, FR-07; Architecture 5.3): thông báo còn `PENDING` quá
 * 30 giây là do Redis lỗi lúc commit, instance chết giữa chừng hoặc job hết lần retry. IDEMPOTENT: xếp lại bằng cùng
 * `jobId` (`pushSendJobId`, dùng chung với Dispatcher) nên không bao giờ nhân đôi job; chuyển `SKIPPED` luôn kèm điều
 * kiện `PENDING` nên không đè kết quả worker vừa chốt.
 */
@Injectable()
export class PushSweepService {
  private readonly logger = new Logger(PushSweepService.name);

  constructor(
    @InjectModel(Notification.name)
    private readonly notificationModel: Model<NotificationDocument>,
    private readonly featureFlags: FeatureFlagService,
    @Inject(PUSH_PROVIDER) private readonly provider: PushProvider,
    private readonly queue: QueueRuntimeService,
  ) {}

  async run(now: Date = new Date()): Promise<PushSweepResult> {
    // Cờ tắt (cùng điều kiện bước 1 của worker): mọi PENDING thành SKIPPED, không xếp job, không gọi dịch vụ push.
    if (
      !this.featureFlags.isEnabled(FeatureFlag.CRM_PUSH) ||
      !this.provider.isEnabled()
    ) {
      const skipped = await this.skipPending({});
      if (skipped > 0) {
        this.logger.log(`push.sweep: cờ push tắt, chuyển ${skipped} SKIPPED`);
      }
      return { enqueued: 0, skipped };
    }

    const pending = await this.notificationModel
      .find({
        pushStatus: NotificationPushStatus.PENDING,
        createdAt: { $lt: new Date(now.getTime() - PUSH_SWEEP_MIN_AGE_MS) },
      })
      .sort({ createdAt: 1 })
      .limit(PUSH_SWEEP_BATCH_SIZE)
      .select('_id type createdAt')
      .lean()
      .exec();

    const expiredIds: Types.ObjectId[] = [];
    const liveIds: Types.ObjectId[] = [];
    for (const notification of pending) {
      const ttlSeconds =
        getPushCatalogEntry(notification.type)?.ttlSeconds ??
        DEFAULT_TTL_SECONDS;
      const isExpired =
        notification.createdAt.getTime() < now.getTime() - ttlSeconds * 1000;
      (isExpired ? expiredIds : liveIds).push(notification._id);
    }

    const skipped = await this.skipPending({ _id: { $in: expiredIds } });
    const enqueued = await this.enqueueAll(liveIds);
    if (enqueued > 0 || skipped > 0) {
      this.logger.log(
        `push.sweep: xếp lại ${enqueued}, quá TTL chuyển SKIPPED ${skipped}`,
      );
    }
    return { enqueued, skipped };
  }

  /** `SKIPPED` có điều kiện `PENDING`; `filter` rỗng nghĩa là mọi thông báo PENDING. */
  private async skipPending(filter: Record<string, unknown>): Promise<number> {
    if (
      '_id' in filter &&
      (filter._id as { $in: unknown[] }).$in.length === 0
    ) {
      return 0;
    }
    const result = await this.notificationModel
      .updateMany(
        { ...filter, pushStatus: NotificationPushStatus.PENDING },
        { $set: { pushStatus: NotificationPushStatus.SKIPPED } },
      )
      .exec();
    return result.modifiedCount;
  }

  /**
   * Xếp lại từng thông báo. Lỗi Redis đầu tiên dừng lượt quét (các thông báo còn lại vẫn PENDING, lượt sau xếp tiếp)
   * thay vì thử 200 lần cùng một lỗi.
   */
  private async enqueueAll(ids: Types.ObjectId[]): Promise<number> {
    let enqueued = 0;
    for (const id of ids) {
      const notificationId = String(id);
      try {
        await this.queue.add(
          QueueNames.PUSH,
          PushJobNames.SEND,
          { notificationId },
          { jobId: pushSendJobId(notificationId) },
        );
        enqueued += 1;
      } catch (error) {
        this.logger.warn(
          `push.sweep: không xếp được job (Redis lỗi?), dừng lượt này: ${(error as Error).message}`,
        );
        break;
      }
    }
    return enqueued;
  }
}
