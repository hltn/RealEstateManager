/**
 * Hàm thuần dùng riêng cho màn "Chi tiết khách hàng" (2 biến thể desktop/mobile).
 */
import { APPOINTMENT_PAST_TOLERANCE_MS } from '@crm/lib/appointmentAdapters';
import { CRITERIA_KEYS, CRITERION_LABELS } from '@crm/lib/customerRules';
import { addDaysToDateKey, getVnTodayKey, toVnDateKey, toVnTime, vnDateTimeToIso } from '@crm/lib/dateTime';
import type { CriterionKey } from '@crm/types/crm';

/**
 * Lịch hẹn sắp tới của một khách: chỉ lịch còn chờ thực hiện (SCHEDULED) có giờ hẹn không sớm hơn `now` quá
 * `APPOINTMENT_PAST_TOLERANCE_MS` (cùng dung sai backend khi tạo lịch, để lịch vừa tạo lùi vài phút vẫn hiện), gần nhất trước.
 * Lịch quá hạn xa hơn dung sai thuộc về "việc quá hạn", không nằm ở đây.
 */
export const selectUpcomingAppointments = <T extends { status: string; startAt: string }>(appointments: readonly T[], now: Date = new Date()): T[] => {
  const earliestVisibleMs = now.getTime() - APPOINTMENT_PAST_TOLERANCE_MS;
  return appointments.filter((appointment) => appointment.status === 'SCHEDULED' && new Date(appointment.startAt).getTime() >= earliestVisibleMs).sort((a, b) => a.startAt.localeCompare(b.startAt));
};

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

/** Có chữ thật để hiển thị (không null/undefined/toàn khoảng trắng): dùng để ẩn trường trống ở chế độ xem (PT-018). */
export const hasText = (value: string | null | undefined): boolean => Boolean(value?.trim());

/** Giá trị người dùng đang nhập ở form ghi chú (dùng để biết còn thay đổi chưa lưu hay không). */
export interface CareLogDraft {
  content: string;
  contactChannel: string;
  contactResultId: string;
  nextSuggestion: string;
  nextDueLocal: string;
  /** Có ảnh mới thêm hoặc đã gỡ ảnh cũ so với lúc mở form. */
  hasPhotoChanges: boolean;
}

/**
 * Form ghi chú còn thay đổi CHƯA LƯU? Thêm mới: có nội dung/kết quả/nhắc việc (kênh liên hệ mặc định không tính); sửa: khác với
 * nhật ký gốc (`original`). Có đổi ảnh thì luôn tính. Dùng để hỏi lại trước khi bỏ form (không để mất bản nháp âm thầm).
 */
export const isCareLogDraftDirty = (draft: CareLogDraft, original?: Pick<CareLogDraft, 'content' | 'contactChannel' | 'contactResultId'>): boolean => {
  if (draft.hasPhotoChanges) return true;
  if (original) return draft.content !== original.content || draft.contactChannel !== original.contactChannel || draft.contactResultId !== original.contactResultId;
  return draft.content.trim() !== '' || draft.contactResultId !== '' || draft.nextSuggestion.trim() !== '' || draft.nextDueLocal !== '';
};

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
