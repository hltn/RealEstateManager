/**
 * Hàm thuần cho khối "Giờ yên lặng" (T-42, FR-10). Quy tắc khớp BE `notification-preference.rules.ts`:
 * `HH:mm` (00:00 đến 23:59), `start` khác `end`, `start > end` là khung qua nửa đêm.
 */
import type { QuietHours } from '@crm/api/http/notificationPreferencesApi';

/** Khung mặc định gợi ý khi người dùng bật lần đầu (qua nửa đêm). */
export const DEFAULT_QUIET_HOURS: Readonly<QuietHours> = { start: '22:00', end: '06:00' };

export const TIME_OF_DAY_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Trả thông báo lỗi tiếng Việt, hoặc `null` nếu hợp lệ. */
export const validateQuietHours = ({ start, end }: QuietHours): string | null => {
  if (!TIME_OF_DAY_PATTERN.test(start) || !TIME_OF_DAY_PATTERN.test(end)) return 'Vui lòng chọn đủ giờ bắt đầu và giờ kết thúc.';
  if (start === end) return 'Giờ bắt đầu và giờ kết thúc phải khác nhau.';
  return null;
};

/** Khung có qua nửa đêm không (chỉ có nghĩa khi hợp lệ). */
export const isOvernight = ({ start, end }: QuietHours): boolean => start > end;

export const isSameQuietHours = (left: QuietHours | null, right: QuietHours | null): boolean =>
  left === null || right === null ? left === right : left.start === right.start && left.end === right.end;
