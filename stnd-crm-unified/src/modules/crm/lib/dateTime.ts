/**
 * Ngày giờ của module CRM — múi giờ Việt Nam cố định (GMT+7, `Asia/Ho_Chi_Minh`), tài liệu 01 §5 + 04 §7.2.
 * Quy ước:
 * - Thời điểm (nhật ký, lịch hẹn, cập nhật cuối...) lưu ISO 8601 UTC (`2026-10-21T08:30:00.000Z`).
 * - Ngày không có giờ (sinh nhật, kỷ niệm, khoá ngày của lịch) lưu chuỗi `YYYY-MM-DD` ("date key").
 * - Mọi hiển thị đi qua `Intl.DateTimeFormat` với timeZone cố định -> đúng giờ VN dù máy người dùng ở múi giờ khác.
 */
import type { DayPeriod } from '@crm/types/crm';

export const VN_TIME_ZONE = 'Asia/Ho_Chi_Minh';
/** Việt Nam không có giờ mùa hè -> lệch UTC cố định +07:00. */
const VN_UTC_OFFSET = '+07:00';

export const TODAY_LABEL = 'Hôm nay';

const DATE_KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

const pad2 = (value: number): string => value.toString().padStart(2, '0');

const PARTS_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: VN_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

interface VnParts {
  year: string;
  month: string;
  day: string;
  hour: string;
  minute: string;
}

const toDate = (value: string | Date): Date => (value instanceof Date ? value : new Date(value));

const isValidDate = (date: Date): boolean => !Number.isNaN(date.getTime());

/** Tách năm/tháng/ngày/giờ/phút theo giờ VN. */
const getVnParts = (value: string | Date): VnParts | null => {
  const date = toDate(value);
  if (!isValidDate(date)) return null;
  const parts = Object.fromEntries(PARTS_FORMATTER.formatToParts(date).map((part) => [part.type, part.value]));
  return { year: parts.year, month: parts.month, day: parts.day, hour: parts.hour, minute: parts.minute };
};

// ---------------------------------------------------------------------------
// Chuyển đổi
// ---------------------------------------------------------------------------

/** Thời điểm -> khoá ngày theo giờ VN: "2026-10-21T18:30:00Z" -> "2026-10-22". */
export const toVnDateKey = (value: string | Date): string => {
  const parts = getVnParts(value);
  return parts ? `${parts.year}-${parts.month}-${parts.day}` : '';
};

/** Thời điểm -> "HH:mm" theo giờ VN. */
export const toVnTime = (value: string | Date): string => {
  const parts = getVnParts(value);
  return parts ? `${parts.hour}:${parts.minute}` : '';
};

/** Ngày hôm nay (giờ VN). */
export const getVnTodayKey = (now: Date = new Date()): string => toVnDateKey(now);

/** Khoá ngày + giờ VN -> ISO UTC: ("2026-10-21", "09:30") -> "2026-10-21T02:30:00.000Z". Sai định dạng -> ''. */
export const vnDateTimeToIso = (dateKey: string, time = '00:00'): string => {
  if (!DATE_KEY_PATTERN.test(dateKey) || !parseTime24(time)) return '';
  const date = new Date(`${dateKey}T${time.padStart(5, '0')}:00${VN_UTC_OFFSET}`);
  return isValidDate(date) ? date.toISOString() : '';
};

/** Cộng ngày cho khoá ngày (thuần lịch, không phụ thuộc múi giờ máy). */
export const addDaysToDateKey = (dateKey: string, days: number): string => {
  const match = DATE_KEY_PATTERN.exec(dateKey);
  if (!match) return dateKey;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days));
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
};

/** Số ngày từ `fromKey` tới `toKey` (âm nếu `toKey` ở trước). */
export const diffDateKeys = (fromKey: string, toKey: string): number => {
  const from = DATE_KEY_PATTERN.exec(fromKey);
  const to = DATE_KEY_PATTERN.exec(toKey);
  if (!from || !to) return Number.NaN;
  const fromUtc = Date.UTC(Number(from[1]), Number(from[2]) - 1, Number(from[3]));
  const toUtc = Date.UTC(Number(to[1]), Number(to[2]) - 1, Number(to[3]));
  return Math.round((toUtc - fromUtc) / MS_PER_DAY);
};

/** Tách "HH:mm" -> { hours, minutes }. Trả null nếu sai định dạng. */
export const parseTime24 = (time: string): { hours: number; minutes: number } | null => {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return { hours, minutes };
};

// ---------------------------------------------------------------------------
// Hiển thị (dd/MM/yyyy, giờ 24h — tài liệu 02 §9)
// ---------------------------------------------------------------------------

/** Thời điểm -> "21/10/2026". */
export const formatVnDate = (value: string | Date | null | undefined): string => {
  if (!value) return '';
  const parts = getVnParts(value);
  return parts ? `${parts.day}/${parts.month}/${parts.year}` : '';
};

/** Thời điểm -> "21/10/2026 15:30". */
export const formatVnDateTime = (value: string | Date | null | undefined): string => {
  if (!value) return '';
  const parts = getVnParts(value);
  return parts ? `${parts.day}/${parts.month}/${parts.year} ${parts.hour}:${parts.minute}` : '';
};

/**
 * Nhãn tương đối theo ngày VN: "Hôm nay 15:30", "Hôm qua 09:10", "Ngày mai 08:00", còn lại "21/10/2026 15:30".
 * `shouldIncludeTime = false` -> chỉ phần ngày.
 */
export const formatVnRelative = (value: string | null | undefined, now: Date = new Date(), shouldIncludeTime = true): string => {
  if (!value) return '';
  const dateKey = toVnDateKey(value);
  if (!dateKey) return '';
  const dayDiff = diffDateKeys(getVnTodayKey(now), dateKey);
  const dayLabel = dayDiff === 0 ? TODAY_LABEL : dayDiff === -1 ? 'Hôm qua' : dayDiff === 1 ? 'Ngày mai' : formatVnDate(value);
  return shouldIncludeTime ? `${dayLabel} ${toVnTime(value)}` : dayLabel;
};

/** Khoá ngày "2026-10-21" -> "21/10/2026" (giữ nguyên nếu sai định dạng). */
export const formatIsoDateVi = (dateKey: string): string => {
  const match = DATE_KEY_PATTERN.exec(dateKey);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : dateKey;
};

/** "21/10/2026" -> "2026-10-21" (nhập tay / import). Sai định dạng -> ''. */
export const parseDmyToDateKey = (value: string): string => {
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value.trim());
  if (!match) return '';
  const key = `${match[3]}-${pad2(Number(match[2]))}-${pad2(Number(match[1]))}`;
  return addDaysToDateKey(key, 0) === key ? key : '';
};

/** Buổi trong ngày theo giờ VN: trước 12:00 là sáng, còn lại là chiều. Nhận "HH:mm" hoặc ISO. */
export const getDayPeriod = (timeOrIso: string): DayPeriod => {
  const time = parseTime24(timeOrIso) ? timeOrIso : toVnTime(timeOrIso);
  const parsed = parseTime24(time);
  return parsed && parsed.hours < 12 ? 'morning' : 'afternoon';
};

const WEEKDAY_SHORT_LABELS = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'] as const;

/** "2026-10-21" -> { dayOfWeek: "T4", dayNumber: 21 } (dải lịch tuần). */
export const getIsoDateParts = (dateKey: string): { dayOfWeek: string; dayNumber: number } | null => {
  const match = DATE_KEY_PATTERN.exec(dateKey);
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return { dayOfWeek: WEEKDAY_SHORT_LABELS[date.getUTCDay()], dayNumber: date.getUTCDate() };
};

/**
 * Date (lịch thuần, theo trường ngày của đối tượng Date) -> khoá "YYYY-MM-DD".
 * Dùng cho lưới lịch tháng/tuần dựng bằng `new Date(y, m, d)`; "hôm nay" phải lấy qua `getVnTodayKey`.
 */
export const toIsoDate = (date: Date): string =>
  `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;

/** Ngày tháng của khoá ngày (bỏ năm) để so dịp hằng năm: "1984-11-15" -> { month: 11, day: 15 }. */
export const getMonthDay = (dateKey: string): { month: number; day: number } | null => {
  const match = DATE_KEY_PATTERN.exec(dateKey);
  return match ? { month: Number(match[2]), day: Number(match[3]) } : null;
};
