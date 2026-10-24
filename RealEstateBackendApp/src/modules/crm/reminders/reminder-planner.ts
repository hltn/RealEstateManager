import { Types } from 'mongoose';
import {
  addDaysToDateKey,
  vnDateKey,
} from '../../../common/utils/timezone.util';

type IdLike = string | Types.ObjectId;

/**
 * Khóa chống trùng (tài liệu 04 mục 3.5). Có THỜI ĐIỂM trong khóa nên dời giờ hẹn sinh nhắc mới (khóa mới) thay vì
 * ghi đè bản đã gửi: sau khi dời, người nhận được nhắc theo giờ mới; dời về đúng giờ cũ thì dùng lại khóa cũ
 * (đã gửi rồi thì không gửi lại).
 */
export const appointmentDedupeKey = (
  appointmentId: IdLike,
  offsetMinutes: number,
  startAt: Date,
): string =>
  `APPOINTMENT:${String(appointmentId)}:${offsetMinutes}:${startAt.getTime()}`;

export const followUpDedupeKey = (careLogId: IdLike, dueAt: Date): string =>
  `FOLLOW_UP:${String(careLogId)}:${dueAt.getTime()}`;

/** Một dịp có thể nhắc nhiều lần trong năm (trước 1 ngày, đúng ngày) nên khóa có cả `leadDays` và ngày xảy ra. */
export const occasionDedupeKey = (
  customerId: IdLike,
  fieldKey: string,
  occurrenceDate: string,
  leadDays: number,
): string =>
  `OCCASION:${String(customerId)}:${fieldKey}:${occurrenceDate}:${leadDays}`;

/**
 * Khách lâu chưa chăm sóc: MỘT nhắc cho mỗi "đợt" (mốc neo = ngày VN của nhật ký mới nhất, hoặc ngày tạo khách nếu
 * chưa có nhật ký), không nhắc lại mỗi ngày — có nhật ký mới thì mốc neo đổi và đợt mới bắt đầu. Danh sách "Việc hôm nay"
 * vẫn hiện khách đó cho tới khi được chăm sóc.
 */
export const staleDedupeKey = (
  customerId: IdLike,
  anchorDate: string,
): string => `STALE:${String(customerId)}:${anchorDate}`;

/** Mốc neo của một đợt "lâu chưa chăm sóc" (xem `staleDedupeKey`). */
export const staleAnchorDate = (
  lastCareLogAt: Date | null | undefined,
  createdAt: Date,
): string => vnDateKey(lastCareLogAt ?? createdAt);

const isLeapYear = (year: number): boolean =>
  (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;

/** Dịp hằng năm (month/day) có rơi vào ngày `dateKey` không; 29/02 năm không nhuận được tính vào 28/02. */
export const occasionFallsOn = (
  occasion: { month: number; day: number },
  dateKey: string,
): boolean => {
  const [year, month, day] = dateKey.split('-').map(Number);
  if (occasion.month === month && occasion.day === day) return true;
  return (
    occasion.month === 2 &&
    occasion.day === 29 &&
    month === 2 &&
    day === 28 &&
    !isLeapYear(year)
  );
};

export interface OccasionTarget {
  leadDays: number;
  /** Ngày dịp xảy ra (`YYYY-MM-DD`, giờ VN). */
  dateKey: string;
}

/** Các ngày cần quét: hôm nay + từng `leadDays` (0 = đúng ngày, 1 = ngày mai...). Bỏ trùng và giá trị âm. */
export const buildOccasionTargets = (
  todayKey: string,
  leadDays: readonly number[],
): OccasionTarget[] =>
  [...new Set(leadDays)]
    .filter((lead) => lead >= 0)
    .sort((first, second) => first - second)
    .map((lead) => ({
      leadDays: lead,
      dateKey: addDaysToDateKey(todayKey, lead),
    }));
