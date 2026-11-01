import { createHash } from 'crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import type Redis from 'ioredis';
import { Connection, Types } from 'mongoose';
import { withTransaction } from '../../../../shared/database/with-transaction.util';
import { REDIS_CLIENT } from '../../../../shared/redis/redis.constants';
import {
  CrmAuditAction,
  CrmAuditEntityType,
} from '../../audit-logs/crm-audit.constants';
import { CrmAuditLogService } from '../../audit-logs/crm-audit-log.service';
import {
  NotificationPriority,
  NotificationType,
} from '../../../notifications/notification.constants';
import { NotificationsService } from '../../../notifications/notifications.service';

const WINDOW_SECONDS = 3600;
/** Nhiều truy vấn SĐT KHÁC NHAU trong 1 giờ (dò số qua ô tìm kiếm). */
export const PHONE_SEARCH_ANOMALY_THRESHOLD = 20;
/** Từ khóa số phải có từ ngần này chữ số mới tính vào dò số. */
export const PHONE_SEARCH_TRACK_MIN_DIGITS = 6;
export const NATIONAL_ID_VIEW_ALERT_PER_HOUR = 50;
export const DEFAULT_PHONE_VIEW_ALERT_PER_HOUR = 200;

/**
 * Phát hiện hành vi bất thường (tài liệu 04 mục 3.2.3 điểm 3, mục 7.3 "Sự cố"). Khi vượt ngưỡng trong một giờ,
 * ghi MỘT bản ghi audit cho mỗi người mỗi giờ để Quản trị xem ở `/crm/audit-logs` (đẩy thông báo thuộc M5).
 *
 * Chỉ là cảnh báo nên "best-effort": lỗi Redis/DB ở đây chỉ ghi log, không làm hỏng thao tác của người dùng.
 */
@Injectable()
export class CrmAbuseMonitorService {
  private readonly logger = new Logger(CrmAbuseMonitorService.name);

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @InjectConnection() private readonly connection: Connection,
    private readonly audit: CrmAuditLogService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Ghi nhận một truy vấn tìm kiếm theo SĐT (chỉ lưu băm của từ khóa, không lưu số). Chỉ đếm từ khóa có >= 6 chữ số
   * (ngắn hơn chỉ khớp đuôi số). Đếm số "lá" của tập từ khóa trong 1 giờ: từ khóa là tiền tố của một từ khóa khác
   * đã tìm KHÔNG còn là lá. Gõ dần một số (6, 7, ..., 10 chữ số) chỉ là 1 lá nên không báo giả; còn dò kiểu
   * `gốc+0, gốc+1, ...` (hoặc xen kẽ với `gốc`) sinh nhiều lá khác nhau nên vẫn bị đếm đủ.
   */
  async trackPhoneSearch(userId: string, digits: string): Promise<void> {
    if (digits.length < PHONE_SEARCH_TRACK_MIN_DIGITS) return;
    await this.safely('phone-search', async () => {
      const hash = (value: string) =>
        createHash('sha256').update(value).digest('hex');
      const keywordsKey = `crm:abuse:phone-search:${userId}`;
      const prefixesKey = `crm:abuse:phone-search-prefixes:${userId}`;
      const prefixes: string[] = [];
      for (
        let length = PHONE_SEARCH_TRACK_MIN_DIGITS;
        length < digits.length;
        length += 1
      ) {
        prefixes.push(hash(digits.slice(0, length)));
      }
      const pipeline = this.redis
        .multi()
        .sadd(keywordsKey, hash(digits))
        .expire(keywordsKey, WINDOW_SECONDS, 'NX');
      if (prefixes.length > 0) pipeline.sadd(prefixesKey, ...prefixes);
      pipeline.expire(prefixesKey, WINDOW_SECONDS, 'NX');
      await pipeline.exec();
      const leaves = await this.redis.sdiff(keywordsKey, prefixesKey);
      if (leaves.length >= PHONE_SEARCH_ANOMALY_THRESHOLD) {
        await this.alertOnce(
          userId,
          CrmAuditAction.PHONE_SEARCH_ANOMALY,
          `Từ ${leaves.length} truy vấn số điện thoại khác nhau trong 1 giờ`,
        );
      }
    });
  }

  /** Ghi nhận một lần xem số đầy đủ; vượt `threshold` (cấu hình `phoneViewAlertPerHour`) thì cảnh báo. */
  async trackPhoneView(userId: string, threshold: number): Promise<void> {
    await this.trackCounter(
      'phone-view',
      userId,
      threshold,
      CrmAuditAction.PHONE_VIEW_ALERT,
    );
  }

  async trackNationalIdView(userId: string): Promise<void> {
    await this.trackCounter(
      'national-id-view',
      userId,
      NATIONAL_ID_VIEW_ALERT_PER_HOUR,
      CrmAuditAction.NATIONAL_ID_VIEW_ALERT,
    );
  }

  private async trackCounter(
    name: string,
    userId: string,
    threshold: number,
    action: CrmAuditAction,
  ): Promise<void> {
    await this.safely(name, async () => {
      const key = `crm:abuse:${name}:${userId}`;
      const results = await this.redis
        .multi()
        .incr(key)
        .expire(key, WINDOW_SECONDS, 'NX')
        .exec();
      const count = Number(results?.[0]?.[1] ?? 0);
      if (count > threshold) {
        await this.alertOnce(
          userId,
          action,
          `Vượt ${threshold} lượt trong 1 giờ (hiện ${count})`,
        );
      }
    });
  }

  /** Chỉ ghi audit lần đầu vượt ngưỡng trong mỗi giờ (khóa `SET NX EX`). */
  private async alertOnce(
    userId: string,
    action: CrmAuditAction,
    reason: string,
  ): Promise<void> {
    const markerKey = `crm:abuse:alerted:${action}:${userId}`;
    const marker = await this.redis.set(
      markerKey,
      '1',
      'EX',
      WINDOW_SECONDS,
      'NX',
    );
    if (marker !== 'OK') return;
    try {
      await withTransaction(this.connection, (session) =>
        this.audit.record(
          {
            entityType: CrmAuditEntityType.USER,
            entityId: new Types.ObjectId(userId),
            action,
            actor: { sub: userId },
            reason,
          },
          session,
        ),
      );
    } catch (error) {
      // Ghi audit lỗi thì nhả khóa để lần vượt ngưỡng kế tiếp còn được ghi (không mất cảnh báo cả giờ).
      await this.redis.del(markerKey).catch(() => undefined);
      throw error;
    }
    await this.notifyAdmins(userId, action, reason);
  }

  /**
   * Đẩy cảnh báo vào hộp thông báo của mọi Quản trị đang hoạt động (M5). Chạy SAU khi audit đã commit và không bao giờ
   * làm hỏng thao tác gốc; `dedupeKey` theo (hành động, người, giờ) nên không báo trùng dù được gọi lại.
   */
  private async notifyAdmins(
    userId: string,
    action: CrmAuditAction,
    reason: string,
  ): Promise<void> {
    const user = await this.connection
      .collection('users')
      .findOne(
        { _id: new Types.ObjectId(userId) },
        { projection: { displayName: 1 } },
      )
      .catch(() => null);
    const name = (user?.displayName as string | undefined) ?? 'Một người dùng';
    await this.notifications.notifyAdmins({
      type: NotificationType.SECURITY_ALERT,
      title: 'Cảnh báo truy cập bất thường',
      body: `${name}: ${reason}`,
      priority: NotificationPriority.HIGH,
      data: {
        deepLink: `/crm/audit-logs?actorId=${userId}&actions=${action}`,
      },
      dedupeKey: `ALERT:${action}:${userId}:${Math.floor(Date.now() / (WINDOW_SECONDS * 1000))}`,
    });
  }

  private async safely(
    label: string,
    work: () => Promise<void>,
  ): Promise<void> {
    try {
      await work();
    } catch (error) {
      this.logger.warn(
        `Theo dõi bất thường (${label}) thất bại: ${(error as Error).message}`,
      );
    }
  }
}
