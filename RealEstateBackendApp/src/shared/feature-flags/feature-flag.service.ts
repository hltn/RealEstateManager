import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { parseBooleanFlag } from '../../common/utils/env-flag.util';

/**
 * Danh sách cờ tính năng CRM. GIÁ TRỊ enum chính là TÊN biến môi trường đọc cờ đó (`CRM_*`, FR-18, không còn
 * tiền tố `FEATURE_`); tên thành viên giữ nguyên để không đổi chỗ gọi.
 * Cờ mới thêm vào đây (tương thích ngược: không cờ nào được bật khi chưa cấu hình).
 */
export enum FeatureFlag {
  /** Bật toàn bộ module CRM. */
  CRM_ENABLED = 'CRM_ENABLED',
  /** Đẩy thông báo Web Push VAPID (M7) — mặc định tắt hoặc thiếu `VAPID_*` thì NoopPushProvider thay thế. */
  CRM_PUSH = 'CRM_PUSH_ENABLED',
  /** Import khách từ file (M8). */
  CRM_IMPORT = 'CRM_IMPORT_ENABLED',
  /** Ảnh đính kèm nhật ký chăm sóc (M3). */
  CRM_ATTACHMENTS = 'CRM_ATTACHMENTS_ENABLED',
}

/**
 * Đọc cờ tính năng từ cấu hình (`CRM_ENABLED`, `CRM_PUSH_ENABLED`, `CRM_IMPORT_ENABLED`, `CRM_ATTACHMENTS_ENABLED`).
 *
 * - Mặc định TẮT: biến thiếu/rỗng/giá trị lạ ⇒ false (an toàn khi merge code chưa công bố).
 * - Chấp nhận `true|1|yes|on` (không phân biệt hoa thường, bỏ khoảng trắng).
 * - Đọc tại thời điểm gọi (không cache) để đổi cấu hình/test không cần khởi tạo lại.
 */
@Injectable()
export class FeatureFlagService {
  constructor(private readonly config: ConfigService) {}

  isEnabled(flag: FeatureFlag): boolean {
    return parseBooleanFlag(
      this.config.get<string | boolean | undefined>(flag),
    );
  }

  /** Ảnh chụp trạng thái mọi cờ — dùng để log khi khởi động. */
  snapshot(): Record<FeatureFlag, boolean> {
    return Object.values(FeatureFlag).reduce(
      (acc, flag) => ({ ...acc, [flag]: this.isEnabled(flag) }),
      {} as Record<FeatureFlag, boolean>,
    );
  }
}
