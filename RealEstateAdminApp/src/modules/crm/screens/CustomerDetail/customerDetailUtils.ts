/**
 * Hàm thuần dùng riêng cho màn "Chi tiết khách hàng" (2 biến thể desktop/mobile).
 * Đề xuất đưa lên `src/lib/` nếu màn khác cần (xem báo cáo port).
 */
import { C4_CRITERION_PERCENT, getC4AchievedPercent } from '@crm/lib/customerAdapters';
import type { C4Criteria, C4CriterionKey } from '@crm/types/crm';

/** Admin: "0912 345 678" -> "0912 345 •••". */
export const maskPhoneAdmin = (phone: string): string => (phone ? `${phone.substring(0, 8)} •••` : '');

/** Số tiêu chí C4 đã đạt (0..4). */
export const countAchievedC4 = (c4: C4Criteria): number =>
  Object.values(c4).filter((criterion) => criterion.achieved).length;

/**
 * Đảo trạng thái Đạt/Chưa đạt của 1 tiêu chí C4 và tính lại % tiến độ.
 * Trả về phần thay đổi cho `updateCustomer` (không sửa object gốc - bản Admin cũ mutate trực tiếp).
 */
export const toggleC4Criterion = (
  c4: C4Criteria,
  key: C4CriterionKey,
): { c4Criteria: C4Criteria; progressPercentage: number } => {
  const c4Criteria: C4Criteria = { ...c4, [key]: { ...c4[key], achieved: !c4[key].achieved } };
  return { c4Criteria, progressPercentage: getC4AchievedPercent(c4Criteria) };
};

/** "Sa bàn thực tế dự án" -> "Sa bàn" (nhãn ảnh thu nhỏ trên timeline Admin). */
export const getShortCaption = (caption: string, wordCount = 2): string =>
  caption.trim().split(/\s+/).slice(0, wordCount).join(' ');

/** Số ảnh còn ẩn sau ô "+N Xem tất cả". */
export const getHiddenImageCount = (totalImages: number, visibleImages: number): number =>
  Math.max(0, totalImages - visibleImages);

/** Tác giả là người phụ trách chính (nhãn có "★"). */
export const isLeadAuthor = (author: string): boolean => author.includes('★');

/** Tiêu chí C4 theo thứ tự hiển thị của cả 2 bản. */
export const C4_CRITERIA_ITEMS: ReadonlyArray<{ key: C4CriterionKey; label: string }> = [
  { key: 'demand', label: '1. Nhu cầu' },
  { key: 'motivation', label: '2. Động cơ' },
  { key: 'finance', label: '3. Tài chính' },
  { key: 'timing', label: '4. Thời gian chốt' },
];

/** Nhãn "25% • Đạt" của mỗi tiêu chí. */
export const C4_ACHIEVED_LABEL_PERCENT = C4_CRITERION_PERCENT;

/** Kết quả liên hệ trong form nhật ký (Admin). */
export const ADMIN_CALL_RESULT_OPTIONS = [
  'Khách quan tâm giá / Cần gửi bảng tính',
  'Hẹn xem sa bàn & nhà mẫu',
  'Bận gọi lại sau',
  'Cần tư vấn thêm gói vay 40%',
] as const;

/** Kết quả liên hệ trong form nhật ký (Mobile). */
export const MOBILE_CALL_RESULT_OPTIONS = [
  'Khách quan tâm giá / Cần gửi bảng tính',
  'Đang so sánh dự án khác',
  'Hẹn tham quan nhà mẫu',
  'Khách từ chối / Không đúng nhu cầu',
] as const;

/** Lịch nhắc lại trong form nhật ký (Mobile). */
export const MOBILE_REMINDER_OPTIONS = [
  'Hẹn gọi lại sau 2 ngày (07/10)',
  'Hẹn chiều mai (15:00)',
  'Nhắc gửi brochure vào sáng thứ Hai',
  'Tùy chỉnh lịch nhắc...',
] as const;

export const DEFAULT_REMINDER_TEXT = 'Hẹn gọi lại sau 2 ngày (07/10)';

/** Gợi ý AI mặc định khi khách chưa có `aiSuggestion` (văn bản của 2 prototype). */
export const DEFAULT_AI_SUGGESTION = 'Gửi cập nhật tiến độ pháp lý đợt 2, thử gọi lại sau 19h (khung giờ rảnh).';

export const EMPTY_VALUE_TEXT = 'Chưa cập nhật';

/** Giá trị trống -> "Chưa cập nhật". */
export const orEmptyText = (value: string | undefined): string => (value?.trim() ? value : EMPTY_VALUE_TEXT);
