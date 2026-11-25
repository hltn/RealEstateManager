import { runtimeConfig } from '../../../config/runtimeConfig';

/**
 * Cờ bật/tắt tính năng giai đoạn sau của module CRM (Feature Toggle - skill mục 3 "DevOps & Môi trường").
 * NGUỒN DUY NHẤT: mọi chỗ cần kiểm tra cờ đều import từ đây, không tự đọc cấu hình.
 *
 * Giá trị lấy từ `runtimeConfig` (đọc lúc chạy từ `/env.js`, FR-15), KHÔNG còn mặc định theo `import.meta.env.DEV`:
 * mọi cờ mặc định TẮT; dev muốn bật phải đặt tường minh trong `.env` (vd `CRM_ENABLED=true`, `CRM_MOCK_REPORTS=true`).
 * `CRM_ENABLED` (cờ BẬT/TẮT cả module): production/staging đặt trong env của container FE rồi restart, không cần build lại.
 *
 * Khi tắt:
 * - Zalo: nút Zalo chỉ mở `https://zalo.me/<sđt>` (Z1, tài liệu 01 mục 3.3) — không gửi ZNS/OA.
 * - Gọi: nút Gọi dùng `tel:` của thiết bị — không có cuộc gọi trong ứng dụng/ghi âm (mục 3.4, giai đoạn sau).
 * - Lịch hẹn: ẩn công tắc gửi SMS/ZNS và đồng bộ Google/Outlook.
 */

export interface CrmFeatureFlags {
  /** Module CRM prototype (route /crm/*, menu "Quản lý khách hàng", đăng nhập giả). */
  isPrototypeEnabled: boolean;
  /** Z2: gửi tin Zalo ZNS/OA từ ứng dụng (cần đăng ký OA, có phí). */
  isZaloZnsEnabled: boolean;
  /** R2: gọi khách qua ứng dụng (modal ghi kết quả cuộc gọi). */
  isInAppCallEnabled: boolean;
  /** Tự gửi SMS/ZNS xác nhận lịch hẹn + đồng bộ Google/Outlook Calendar. */
  isAppointmentNotifySyncEnabled: boolean;
  /** Ảnh đính kèm nhật ký (khớp cờ backend `CRM_ATTACHMENTS_ENABLED`; backend tắt thì API upload trả 404). Mặc định TẮT. */
  isAttachmentsEnabled: boolean;
  /** M8: màn Báo cáo chạy trên DỮ LIỆU MẪU (chưa có API dashboard). Mặc định tắt (màn hiện "sắp ra mắt"); dev đặt `CRM_MOCK_REPORTS=true` để xem. */
  isMockReportsEnabled: boolean;
  /** M8: nhập/xuất file chạy trên DỮ LIỆU MẪU (chưa có API import/export). Mặc định tắt (ẩn nút); dev đặt `CRM_MOCK_IMPORT_EXPORT=true` để xem. */
  isMockImportExportEnabled: boolean;
}

export const CRM_FEATURE_FLAGS: Readonly<CrmFeatureFlags> = Object.freeze({
  isPrototypeEnabled: runtimeConfig.CRM_ENABLED,
  isZaloZnsEnabled: runtimeConfig.CRM_FEATURE_ZALO_ZNS,
  isInAppCallEnabled: runtimeConfig.CRM_FEATURE_IN_APP_CALL,
  isAppointmentNotifySyncEnabled: runtimeConfig.CRM_FEATURE_APPOINTMENT_SYNC,
  isAttachmentsEnabled: runtimeConfig.CRM_ATTACHMENTS_ENABLED,
  isMockReportsEnabled: runtimeConfig.CRM_MOCK_REPORTS,
  isMockImportExportEnabled: runtimeConfig.CRM_MOCK_IMPORT_EXPORT,
});
