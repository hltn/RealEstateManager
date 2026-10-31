/**
 * Cờ bật/tắt tính năng của module CRM (Feature Toggle - skill mục 3 "DevOps & Môi trường").
 * NGUỒN DUY NHẤT: mọi chỗ cần kiểm tra cờ đều import từ đây, không tự đọc biến môi trường.
 *
 * [Prototype] Khác app chính (đọc biến Vite `VITE_CRM_*`, mặc định TẮT ở production): prototype là bản THIẾT KẾ nên cờ là hằng số.
 * - `isPrototypeEnabled`, `isMockReportsEnabled`, `isMockImportExportEnabled`: BẬT (module CRM + Báo cáo + nhập/xuất file chạy trên dữ liệu mẫu).
 * - `isZaloZnsEnabled`, `isInAppCallEnabled`, `isAppointmentNotifySyncEnabled`, `isAttachmentsEnabled`: TẮT như mặc định của app chính
 *   (nút Zalo chỉ mở `https://zalo.me/<sđt>`, nút Gọi dùng `tel:`, ẩn công tắc SMS/ZNS + đồng bộ lịch, ẩn ảnh đính kèm nhật ký).
 *   Muốn xem các giao diện tính năng sau: đổi sang `true` tại đây (UI đã có sẵn nhánh bật).
 */

export interface CrmFeatureFlags {
  /** Module CRM (route /crm/*, menu "Quản lý khách hàng"). */
  isPrototypeEnabled: boolean;
  /** Z2: gửi tin Zalo ZNS/OA từ ứng dụng (cần đăng ký OA, có phí). */
  isZaloZnsEnabled: boolean;
  /** R2: gọi khách qua ứng dụng (modal ghi kết quả cuộc gọi). */
  isInAppCallEnabled: boolean;
  /** Tự gửi SMS/ZNS xác nhận lịch hẹn + đồng bộ Google/Outlook Calendar. */
  isAppointmentNotifySyncEnabled: boolean;
  /** Ảnh đính kèm nhật ký (khớp cờ backend `FEATURE_CRM_ATTACHMENTS`). */
  isAttachmentsEnabled: boolean;
  /** M8: màn Báo cáo chạy trên DỮ LIỆU MẪU. */
  isMockReportsEnabled: boolean;
  /** M8: nhập/xuất file chạy trên DỮ LIỆU MẪU. */
  isMockImportExportEnabled: boolean;
}

export const CRM_FEATURE_FLAGS: Readonly<CrmFeatureFlags> = Object.freeze({
  isPrototypeEnabled: true,
  isZaloZnsEnabled: false,
  isInAppCallEnabled: false,
  isAppointmentNotifySyncEnabled: false,
  isAttachmentsEnabled: false,
  isMockReportsEnabled: true,
  isMockImportExportEnabled: true,
});
