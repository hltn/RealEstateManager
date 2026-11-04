import {
  addDaysToDateKey,
  endOfDayUtc,
  startOfDayUtc,
  vnDateKey,
} from '../../../common/utils/timezone.util';

/** Nguồn việc của "Việc hôm nay" (tài liệu 05 mục 1.6 `DailyTask`). */
export enum DailyTaskKind {
  APPOINTMENT = 'APPOINTMENT',
  FOLLOW_UP = 'FOLLOW_UP',
  OCCASION = 'OCCASION',
  STALE_CUSTOMER = 'STALE_CUSTOMER',
}

export enum DailyTaskGroup {
  OVERDUE = 'OVERDUE',
  TODAY = 'TODAY',
  UPCOMING = 'UPCOMING',
}

export const DEFAULT_UPCOMING_DAYS = 7;
export const MAX_UPCOMING_DAYS = 30;
/** Giờ hiển thị (giờ VN) cho việc theo ngày không có giờ cụ thể (dịp đặc biệt). */
export const OCCASION_TASK_HOUR = 8;

/** Khoảng thời gian đóng hai đầu (`null` = không giới hạn phía đó). */
export interface TimeWindow {
  from: Date | null;
  to: Date | null;
}

const MS_PER_HOUR = 60 * 60 * 1000;

/**
 * Phân nhóm theo NGÀY giờ Việt Nam của `dueAt` so với hôm nay: trước hôm nay = Quá hạn; trong hôm nay = Hôm nay (kể
 * cả giờ đã qua trong ngày); sau hôm nay tới hết `upcomingDays` ngày = Sắp tới; xa hơn = không hiện (`null`).
 */
export const classifyDueAt = (
  dueAt: Date,
  now: Date,
  upcomingDays: number,
): DailyTaskGroup | null => {
  const todayKey = vnDateKey(now);
  const dueKey = vnDateKey(dueAt);
  if (dueKey < todayKey) return DailyTaskGroup.OVERDUE;
  if (dueKey === todayKey) return DailyTaskGroup.TODAY;
  return dueKey <= addDaysToDateKey(todayKey, upcomingDays)
    ? DailyTaskGroup.UPCOMING
    : null;
};

/**
 * Khoảng `dueAt` của một nhóm (hoặc cả ba nhóm khi `group` bỏ trống, dùng cho Kanban): cùng quy tắc với
 * `classifyDueAt` nhưng dạng khoảng để truy vấn Mongo.
 */
export const buildTaskWindow = (
  group: DailyTaskGroup | undefined,
  now: Date,
  upcomingDays: number,
): TimeWindow => {
  const todayKey = vnDateKey(now);
  const todayStart = startOfDayUtc(todayKey);
  const todayEnd = endOfDayUtc(todayKey);
  const upcomingEnd = endOfDayUtc(addDaysToDateKey(todayKey, upcomingDays));
  switch (group) {
    case DailyTaskGroup.OVERDUE:
      return { from: null, to: new Date(todayStart.getTime() - 1) };
    case DailyTaskGroup.TODAY:
      return { from: todayStart, to: todayEnd };
    case DailyTaskGroup.UPCOMING:
      return { from: new Date(todayEnd.getTime() + 1), to: upcomingEnd };
    default:
      return { from: null, to: upcomingEnd };
  }
};

/** Điều kiện Mongo cho `dueAt` thuộc khoảng (không giới hạn phía nào thì bỏ phía đó). */
export const windowToQuery = (window: TimeWindow): Record<string, Date> => ({
  ...(window.from && { $gte: window.from }),
  ...(window.to && { $lte: window.to }),
});

/** Mốc hiển thị của việc "dịp đặc biệt": 08:00 giờ VN của ngày xảy ra dịp. */
export const occasionDueAt = (dateKey: string): Date =>
  new Date(startOfDayUtc(dateKey).getTime() + OCCASION_TASK_HOUR * MS_PER_HOUR);

/** Sắp xếp việc: `dueAt` tăng dần (quá hạn lâu nhất lên đầu), cùng mốc thì theo id cho ổn định giữa các trang. */
export const compareTasks = (
  first: { dueAt: Date; id: string },
  second: { dueAt: Date; id: string },
): number =>
  first.dueAt.getTime() - second.dueAt.getTime() ||
  first.id.localeCompare(second.id);

/** Cắt trích đoạn nhật ký cho `lastCareLog.excerpt`. */
export const toExcerpt = (content: string, max = 90): string =>
  content.length > max ? `${content.slice(0, max)}…` : content;
