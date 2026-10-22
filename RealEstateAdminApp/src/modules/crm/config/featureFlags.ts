/**
 * Cờ bật/tắt tính năng giai đoạn sau của module CRM (Feature Toggle - skill mục 3 "DevOps & Môi trường").
 * NGUỒN DUY NHẤT: mọi chỗ cần kiểm tra cờ đều import từ đây, không tự đọc biến môi trường.
 *
 * Mặc định TẮT toàn bộ. Có thể bật thử ở máy dev bằng biến Vite (vd `VITE_CRM_FEATURE_ZALO_ZNS=true`).
 * `VITE_CRM_PROTOTYPE` (cờ BẬT/TẮT cả module): mặc định BẬT ở dev, TẮT ở bản build production nếu không đặt
 * (prototype dùng vai trò giả + dữ liệu mẫu, KHÔNG được lộ ra production). Staging muốn xem thì đặt `VITE_CRM_PROTOTYPE=true`.
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
}

const readFlag = (value: unknown): boolean => value === true || value === 'true';

/** Giá trị rõ ràng ('true'/'false') thắng; không đặt thì chỉ bật ở môi trường dev. */
export const resolvePrototypeFlag = (value: unknown, isDev: boolean): boolean => {
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  return isDev;
};

const env = (import.meta as ImportMeta & { env?: Record<string, unknown> }).env ?? {};

export const CRM_FEATURE_FLAGS: Readonly<CrmFeatureFlags> = Object.freeze({
  isPrototypeEnabled: resolvePrototypeFlag(env.VITE_CRM_PROTOTYPE, env.DEV === true),
  isZaloZnsEnabled: readFlag(env.VITE_CRM_FEATURE_ZALO_ZNS),
  isInAppCallEnabled: readFlag(env.VITE_CRM_FEATURE_IN_APP_CALL),
  isAppointmentNotifySyncEnabled: readFlag(env.VITE_CRM_FEATURE_APPOINTMENT_SYNC),
});
