import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Danh sách cờ tính năng CRM. Mỗi cờ đọc từ biến môi trường `FEATURE_<tên>`.
 * Cờ mới thêm vào đây (tương thích ngược: không cờ nào được bật khi chưa cấu hình).
 */
export enum FeatureFlag {
  /** Bật toàn bộ module CRM. */
  CRM_ENABLED = 'CRM_ENABLED',
  /** Đẩy thông báo FCM (giai đoạn 2, M7) — mặc định tắt, NoopPushProvider thay thế. */
  CRM_PUSH = 'CRM_PUSH',
  /** Import khách từ file (M8). */
  CRM_IMPORT = 'CRM_IMPORT',
  /** Ảnh đính kèm nhật ký chăm sóc (M3). */
  CRM_ATTACHMENTS = 'CRM_ATTACHMENTS',
}

const TRUTHY_VALUES = new Set(['true', '1', 'yes', 'on']);

/**
 * Đọc cờ tính năng từ cấu hình (`FEATURE_CRM_*`).
 *
 * - Mặc định TẮT: biến thiếu/rỗng/giá trị lạ ⇒ false (an toàn khi merge code chưa công bố).
 * - Chấp nhận `true|1|yes|on` (không phân biệt hoa thường, bỏ khoảng trắng).
 * - Đọc tại thời điểm gọi (không cache) để đổi cấu hình/test không cần khởi tạo lại.
 */
@Injectable()
export class FeatureFlagService {
  constructor(private readonly config: ConfigService) {}

  isEnabled(flag: FeatureFlag): boolean {
    const raw = this.config.get<string | boolean | undefined>(
      `FEATURE_${flag}`,
    );
    if (typeof raw === 'boolean') return raw;
    if (typeof raw !== 'string') return false;
    return TRUTHY_VALUES.has(raw.trim().toLowerCase());
  }

  /** Ảnh chụp trạng thái mọi cờ — dùng để log khi khởi động. */
  snapshot(): Record<FeatureFlag, boolean> {
    return Object.values(FeatureFlag).reduce(
      (acc, flag) => ({ ...acc, [flag]: this.isEnabled(flag) }),
      {} as Record<FeatureFlag, boolean>,
    );
  }
}
