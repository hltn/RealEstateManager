const TRUTHY_VALUES = new Set(['true', '1', 'yes', 'on']);

/**
 * Hiểu một giá trị cấu hình (biến môi trường) thành cờ bật/tắt, dùng chung cho cờ CRM và `CRM_SWAGGER_ENABLED`.
 *
 * - Mặc định TẮT: thiếu, rỗng, toàn khoảng trắng hoặc giá trị lạ (`tru`, `abc`) đều là `false`, không đoán bật.
 * - Chuỗi `true|1|yes|on` bật, không phân biệt hoa thường; bỏ khoảng trắng và `\r` (file `.env` lưu CRLF).
 * - Nhận cả boolean thật (ConfigService có thể đã ép kiểu).
 */
export const parseBooleanFlag = (raw: unknown): boolean => {
  if (typeof raw === 'boolean') return raw;
  if (typeof raw !== 'string') return false;
  return TRUTHY_VALUES.has(raw.trim().toLowerCase());
};
