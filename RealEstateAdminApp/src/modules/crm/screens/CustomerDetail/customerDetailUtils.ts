/**
 * Hàm thuần dùng riêng cho màn "Chi tiết khách hàng" (2 biến thể desktop/mobile).
 */
import { CRITERIA_KEYS, CRITERION_LABELS } from '@crm/lib/customerRules';
import { addDaysToDateKey, getVnTodayKey, toVnDateKey, toVnTime, vnDateTimeToIso } from '@crm/lib/dateTime';
import type { CriterionKey } from '@crm/types/crm';

/** "Sa bàn thực tế dự án" -> "Sa bàn" (nhãn ảnh thu nhỏ trên timeline). */
export const getShortCaption = (caption: string, wordCount = 2): string =>
  caption.trim().split(/\s+/).slice(0, wordCount).join(' ');

/** Số ảnh còn ẩn sau ô "+N Xem tất cả". */
export const getHiddenImageCount = (totalImages: number, visibleImages: number): number => Math.max(0, totalImages - visibleImages);

/** 4 tiêu chí tương tác theo thứ tự hiển thị: "1. Nhu cầu"... */
export const CRITERIA_ITEMS: ReadonlyArray<{ key: CriterionKey; label: string }> = CRITERIA_KEYS.map((key, index) => ({
  key,
  label: `${index + 1}. ${CRITERION_LABELS[key]}`,
}));

export const EMPTY_VALUE_TEXT = 'Chưa cập nhật';

/** Giá trị trống -> "Chưa cập nhật". */
export const orEmptyText = (value: string | null | undefined): string => (value?.trim() ? value : EMPTY_VALUE_TEXT);

/** Giờ mặc định cho mốc hẹn nhắc gợi ý từ kết quả liên hệ. */
export const DEFAULT_FOLLOW_UP_TIME = '09:00';

/**
 * Mốc hẹn nhắc gợi ý (02 §4.3: chọn "kết quả liên hệ" thì hệ thống gợi ý mốc hẹn nhắc):
 * hôm nay + N ngày lúc 09:00 giờ VN. N null/âm -> không gợi ý ('').
 */
export const getSuggestedFollowUpIso = (suggestedDays: number | null | undefined, now: Date = new Date()): string => {
  if (suggestedDays === null || suggestedDays === undefined || suggestedDays < 0) return '';
  return vnDateTimeToIso(addDaysToDateKey(getVnTodayKey(now), suggestedDays), DEFAULT_FOLLOW_UP_TIME);
};

/** ISO -> giá trị cho `<input type="datetime-local">` theo giờ VN ("2026-10-24T09:00"). */
export const toDateTimeLocalValue = (iso: string): string => (iso ? `${toVnDateKey(iso)}T${toVnTime(iso)}` : '');

/** Giá trị `datetime-local` (hiểu là giờ VN) -> ISO UTC; sai định dạng -> ''. */
export const fromDateTimeLocalValue = (value: string): string => {
  const [dateKey, time] = value.split('T');
  return dateKey && time ? vnDateTimeToIso(dateKey, time.slice(0, 5)) : '';
};
