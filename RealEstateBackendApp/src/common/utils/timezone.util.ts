/**
 * Helper quy đổi ngày theo giờ Việt Nam (Asia/Ho_Chi_Minh, UTC+7, KHÔNG có DST
 * nên offset cố định là đủ, không cần thư viện timezone) sang mốc UTC thật.
 *
 * Bối cảnh bug: input startDate/endDate (định dạng YYYY-MM-DD) từ các API lọc
 * bài viết theo ngày (news-fire-crawl-manager) LUÔN là ngày theo giờ Việt Nam.
 * Trước đây code dùng `new Date(dateStr)` rồi `setUTCHours(...)` — ép mốc về
 * UTC nên bài đăng 00:00-06:59 sáng giờ VN (= 17:00-23:59 UTC ngày hôm trước)
 * bị hiểu nhầm là thuộc ngày hôm trước và bị lọc rớt sai.
 *
 * Đọc offset qua ConfigService/process.env 1 lần (getTimezoneOffsetHours),
 * KHÔNG hardcode số 7 rải rác nhiều nơi — mọi call site tái dùng qua đây.
 */

/** Offset mặc định (giờ Việt Nam, Asia/Ho_Chi_Minh) khi thiếu/sai cấu hình. */
const DEFAULT_TIMEZONE_OFFSET_HOURS = 7;

const MS_PER_HOUR = 60 * 60 * 1000;

/**
 * Đọc APP_TIMEZONE_OFFSET_HOURS từ process.env, parse int, fallback về
 * DEFAULT_TIMEZONE_OFFSET_HOURS (7) nếu thiếu hoặc parse ra NaN.
 *
 * Lưu ý: hàm đọc trực tiếp process.env (không inject ConfigService) để dùng
 * được ở cả những nơi không có DI context (VD unit util thuần). Các Service
 * NestJS gọi hàm này vẫn nên ưu tiên đọc qua ConfigService trước theo pattern
 * `this.configService.get() || process.env.` rồi mới fallback vào hàm này
 * nếu cần — xem ai-filter.service.ts.
 */
export function getTimezoneOffsetHours(): number {
  const raw = process.env.APP_TIMEZONE_OFFSET_HOURS;
  const parsed = raw !== undefined ? parseInt(raw, 10) : NaN;
  return Number.isNaN(parsed) ? DEFAULT_TIMEZONE_OFFSET_HOURS : parsed;
}

/**
 * Mốc bắt đầu ngày (00:00:00.000 giờ Việt Nam) của `dateStr` (YYYY-MM-DD),
 * quy đổi đúng sang Date UTC tương ứng.
 *
 * VD offset +7: startOfDayUtc("2026-08-05") => 2026-08-04T17:00:00.000Z
 * (00:00 ngày 05/08 giờ VN = 17:00 ngày 04/08 UTC).
 */
export function startOfDayUtc(dateStr: string): Date {
  const offsetHours = getTimezoneOffsetHours();
  const utcMidnight = new Date(`${dateStr}T00:00:00.000Z`);
  return new Date(utcMidnight.getTime() - offsetHours * MS_PER_HOUR);
}

/**
 * Mốc kết thúc ngày (23:59:59.999 giờ Việt Nam) của `dateStr` (YYYY-MM-DD),
 * quy đổi đúng sang Date UTC tương ứng.
 *
 * VD offset +7: endOfDayUtc("2026-08-05") => 2026-08-05T16:59:59.999Z
 * (23:59:59.999 ngày 05/08 giờ VN = 16:59:59.999 ngày 05/08 UTC).
 */
export function endOfDayUtc(dateStr: string): Date {
  const offsetHours = getTimezoneOffsetHours();
  const utcEndOfDay = new Date(`${dateStr}T23:59:59.999Z`);
  return new Date(utcEndOfDay.getTime() - offsetHours * MS_PER_HOUR);
}

/**
 * Mốc bắt đầu ngày (00:00:00.000 giờ Việt Nam) của "hôm nay lùi lại (days - 1)
 * ngày", quy đổi đúng sang Date UTC tương ứng.
 *
 * Dùng cho bộ lọc "N ngày gần nhất" (VD Job 1 crawl RSS): "hôm nay" phải tính
 * theo giờ Việt Nam (không phải UTC/giờ local của server) trước khi lùi ngày,
 * nếu không cutoff sẽ lệch tới 7h quanh nửa đêm giờ VN — cùng gốc bug với
 * startOfDayUtc/endOfDayUtc phía trên.
 *
 * VD offset +7, "bây giờ" = 2026-08-05T00:30:00 UTC (= 07:30 sáng 05/08 giờ VN):
 * startOfDayUtcDaysAgo(1) => 2026-08-04T17:00:00.000Z (00:00 ngày 05/08 giờ VN).
 */
export function startOfDayUtcDaysAgo(days: number): Date {
  const offsetHours = getTimezoneOffsetHours();
  const nowInVn = new Date(Date.now() + offsetHours * MS_PER_HOUR);
  nowInVn.setUTCDate(nowInVn.getUTCDate() - (days - 1));
  const dateStr = nowInVn.toISOString().slice(0, 10); // YYYY-MM-DD theo giờ VN
  return startOfDayUtc(dateStr);
}
