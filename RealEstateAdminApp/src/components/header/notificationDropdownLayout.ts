/**
 * Hình học của dropdown thông báo desktop (T-57, FR-38): hàm thuần tính độ dịch ngang để khung KHÔNG tràn viewport.
 * Khung neo dưới chuông bằng CSS (`right-0 top-full`), hàm này chỉ là lưới an toàn khi bố cục header hẹp/zoom lớn.
 */

/** Khoảng cách tối thiểu giữa khung và mép viewport. */
export const DROPDOWN_VIEWPORT_MARGIN_PX = 8;

interface HorizontalBounds {
  /** Mép trái/phải của khung (px, theo viewport) khi CHƯA dịch. */
  left: number;
  right: number;
  viewportWidth: number;
  margin?: number;
}

/**
 * Độ dịch ngang (px, dương = sang phải) để khung nằm trọn trong `[margin, viewportWidth - margin]`.
 * - Lệch trái quá mép: dịch phải; lệch phải quá mép: dịch trái.
 * - Khung rộng hơn vùng cho phép (viewport rất hẹp): ưu tiên căn mép trái (đầu chữ luôn đọc được).
 */
export const computeHorizontalShift = ({ left, right, viewportWidth, margin = DROPDOWN_VIEWPORT_MARGIN_PX }: HorizontalBounds): number => {
  const maxRight = viewportWidth - margin;
  if (right - left > maxRight - margin || left < margin) return margin - left;
  if (right > maxRight) return maxRight - right;
  return 0;
};

/** Chiều cao tối đa của khung (36rem) khi viewport đủ cao. */
export const DROPDOWN_MAX_HEIGHT_PX = 576;

/**
 * Chiều cao tối đa (px) để đáy khung KHÔNG vượt đáy viewport: phần còn lại dưới mép trên của khung trừ lề, tối đa 36rem.
 * Danh sách bên trong cuộn khi nội dung dài hơn (không có sàn tối thiểu: viewport quá thấp thì ưu tiên không tràn).
 */
export const computeMaxHeight = ({ top, viewportHeight, margin = DROPDOWN_VIEWPORT_MARGIN_PX }: { top: number; viewportHeight: number; margin?: number }): number =>
  Math.max(0, Math.min(DROPDOWN_MAX_HEIGHT_PX, viewportHeight - top - margin));
