import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
} from '@nestjs/common';
import type { Job } from 'bullmq';
import type Redis from 'ioredis';
import {
  formatVnDateTime,
  vnDateKey,
} from '../../../common/utils/timezone.util';
import {
  FeatureFlag,
  FeatureFlagService,
} from '../../../shared/feature-flags/feature-flag.service';
import { QueueNames } from '../../../shared/queue/queue.constants';
import { QueueRuntimeService } from '../../../shared/queue/queue-runtime.service';
import { REDIS_CLIENT } from '../../../shared/redis/redis.constants';
import { AttachmentCleanupService } from '../care-logs/attachment-cleanup.service';
import { CrmSettingsService } from '../crm-settings/crm-settings.service';
import { ReminderDispatchService } from './reminder-dispatch.service';
import { ReminderScannerService } from './reminder-scanner.service';

/** Tên job lặp trong queue `crm-scheduler`. */
export const CrmJobNames = {
  /** Mỗi phút: gửi nhắc đến hạn, rồi chạy các lượt quét theo ngày đến giờ. */
  REMINDERS_TICK: 'reminders.tick',
  /** Mỗi giờ: dọn ảnh đính kèm mồ côi và file đã gỡ (M3). */
  ATTACHMENTS_CLEANUP: 'attachments.cleanup',
} as const;

const TICK_EVERY_MS = 60 * 1000;
const CLEANUP_EVERY_MS = 60 * 60 * 1000;
const SCAN_DONE_TTL_SECONDS = 3 * 24 * 60 * 60;
const SCAN_LOCK_TTL_SECONDS = 15 * 60;

/** `HH:mm` (giờ VN) của một mốc UTC, để so với giờ cấu hình `HH:mm`. */
const vnTimeOfDay = (date: Date): string => formatVnDateTime(date).slice(0, 5);

/**
 * Lịch chạy nền của CRM trên BullMQ (tài liệu 04 mục 1.3, 6.4), thay `@nestjs/schedule` để chạy đúng MỘT lần dù
 * nhiều instance:
 * - Hai job lặp đăng ký bằng `upsertJobScheduler` (id cố định => idempotent khi nhiều instance/khởi động lại cùng đăng
 *   ký): `reminders.tick` mỗi phút và `attachments.cleanup` mỗi giờ. Một job lặp chỉ sinh MỘT job mỗi nhịp nên chỉ một
 *   worker xử lý; thêm nữa việc gửi còn có khóa nhận nguyên tử (xem `ReminderDispatchService`).
 * - Quét theo ngày (dịp đặc biệt, khách lâu chưa chăm sóc) KHÔNG dùng cron cố định mà kiểm mỗi nhịp "đã đến giờ cấu hình
 *   (giờ VN) và hôm nay chưa quét?" (dấu trong Redis): đọc lại cấu hình ở mỗi nhịp (đổi giờ có hiệu lực ngay), và khởi
 *   động lại/downtime qua giờ quét vẫn quét bù trong ngày. Quét lại không tạo nhắc trùng (khóa chống trùng).
 * Chỉ chạy khi `QUEUE_WORKERS_ENABLED` (tắt trong test) và cờ `FEATURE_CRM_ENABLED` bật.
 */
@Injectable()
export class CrmSchedulerService implements OnApplicationBootstrap {
  private readonly logger = new Logger(CrmSchedulerService.name);

  constructor(
    private readonly runtime: QueueRuntimeService,
    private readonly featureFlags: FeatureFlagService,
    private readonly dispatch: ReminderDispatchService,
    private readonly scanner: ReminderScannerService,
    private readonly settings: CrmSettingsService,
    private readonly attachmentCleanup: AttachmentCleanupService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.runtime.isEnabled()) return;
    this.runtime.registerWorker(QueueNames.CRM_SCHEDULER, (job) =>
      this.handle(job),
    );
    // Không chặn khởi động: Redis chưa sẵn sàng thì thử lại nền, hết lượt mới ghi lỗi.
    void this.runtime
      .upsertSchedulers(QueueNames.CRM_SCHEDULER, [
        {
          id: 'crm-reminders-tick',
          repeat: { every: TICK_EVERY_MS },
          jobName: CrmJobNames.REMINDERS_TICK,
          opts: { attempts: 1 },
        },
        {
          id: 'crm-attachments-cleanup',
          repeat: { every: CLEANUP_EVERY_MS },
          jobName: CrmJobNames.ATTACHMENTS_CLEANUP,
          opts: { attempts: 1 },
        },
      ])
      .catch((error: Error) =>
        this.logger.error(
          `Không đăng ký được job lặp của CRM: ${error.message}`,
        ),
      );
  }

  /** Điểm vào của worker: chọn việc theo tên job. Cờ CRM tắt thì bỏ qua (merge code an toàn khi chưa công bố). */
  async handle(job: Pick<Job, 'name'>): Promise<void> {
    if (!this.featureFlags.isEnabled(FeatureFlag.CRM_ENABLED)) return;
    switch (job.name) {
      case CrmJobNames.REMINDERS_TICK:
        await this.runTick(new Date());
        return;
      case CrmJobNames.ATTACHMENTS_CLEANUP:
        await this.attachmentCleanup.runScheduled();
        return;
      default:
        this.logger.warn(`Bỏ qua job lạ: ${job.name}`);
    }
  }

  /** Một nhịp: gửi nhắc đến hạn trước, rồi quét theo ngày nếu đến giờ. Lỗi một việc không chặn việc kia. */
  async runTick(now: Date): Promise<void> {
    try {
      const result = await this.dispatch.dispatchDue(now);
      if (result.claimed > 0) {
        this.logger.log(
          `Nhắc việc: nhận ${result.claimed}, gửi ${result.sent}, hủy ${result.canceled}, lỗi ${result.failed}`,
        );
      }
    } catch (error) {
      this.logger.error(`Gửi nhắc việc lỗi: ${(error as Error).message}`);
    }
    await this.runDailyScans(now);
  }

  /** Quét dịp đặc biệt và khách lâu chưa chăm sóc nếu đã đến giờ cấu hình (giờ VN) và hôm nay chưa quét. */
  async runDailyScans(now: Date): Promise<void> {
    const settings = await this.settings.get();
    await this.runDailyOnce('occasions', settings.occasionNotifyTime, now, () =>
      this.scanner.scanOccasions(now),
    );
    await this.runDailyOnce('stale', settings.staleCheckTime, now, () =>
      this.scanner.scanStale(now),
    );
  }

  /**
   * Chạy `work` tối đa một lần mỗi ngày VN sau `timeOfDay`. Khóa ngắn chặn hai instance cùng quét; dấu "đã xong" chỉ
   * đặt SAU khi quét thành công (lỗi thì nhịp sau thử lại). Redis lỗi => bỏ qua nhịp này, không quét mù.
   */
  private async runDailyOnce(
    name: string,
    timeOfDay: string,
    now: Date,
    work: () => Promise<number>,
  ): Promise<void> {
    if (vnTimeOfDay(now) < timeOfDay) return;
    const doneKey = `crm:daily-scan:${name}:${vnDateKey(now)}`;
    try {
      if (await this.redis.get(doneKey)) return;
      const lock = await this.redis.set(
        `${doneKey}:lock`,
        '1',
        'EX',
        SCAN_LOCK_TTL_SECONDS,
        'NX',
      );
      if (lock !== 'OK') return;
      try {
        const created = await work();
        await this.redis.set(doneKey, '1', 'EX', SCAN_DONE_TTL_SECONDS);
        this.logger.log(`Quét ${name}: tạo ${created} nhắc việc`);
      } finally {
        await this.redis.del(`${doneKey}:lock`).catch(() => undefined);
      }
    } catch (error) {
      this.logger.error(`Quét ${name} lỗi: ${(error as Error).message}`);
    }
  }
}
