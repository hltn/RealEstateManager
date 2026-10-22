import { toLocalDigits } from './phone';

/** "0912 345 678" -> "tel:0912345678". */
export const toTelHref = (phone: string): string => `tel:${phone.replace(/[^\d+]/g, '')}`;

/** Mở trình gọi điện của thiết bị. */
export const openTelLink = (phone: string): void => {
  if (typeof window === 'undefined') return;
  window.location.href = toTelHref(phone);
};

/**
 * Link mở nhanh cuộc trò chuyện Zalo theo SĐT (Z1): "+84 912 345 678" / "0912 345 678" -> "https://zalo.me/0912345678".
 * Zalo nhận số nội địa bắt đầu bằng 0; số nước ngoài giữ nguyên chữ số.
 */
export const toZaloHref = (phone: string): string => `https://zalo.me/${toLocalDigits(phone)}`;

/** Mở Zalo ở tab mới (không gửi dữ liệu khách ra ngoài ngoài SĐT trên URL của chính Zalo). */
export const openZaloChat = (phone: string): void => {
  if (typeof window === 'undefined') return;
  window.open(toZaloHref(phone), '_blank', 'noopener,noreferrer');
};

const VISIBLE_ID_DIGITS = 4;
const MASK_CHAR = '•';

/**
 * Che CCCD khi hiển thị, chỉ giữ 4 số cuối: "0790 9200 1234" -> "•••• •••• 1234".
 * Nhóm 4 ký tự tính từ phải để cụm số cuối luôn trọn vẹn. Chuỗi quá ngắn vẫn che ít nhất 1 ký tự.
 */
export const maskIdNumber = (idNumber: string): string => {
  const compact = idNumber.replace(/\s/g, '');
  if (!compact) return '';
  const visibleCount = Math.min(VISIBLE_ID_DIGITS, Math.max(compact.length - 1, 0));
  const masked = MASK_CHAR.repeat(compact.length - visibleCount) + compact.slice(compact.length - visibleCount);
  const groups: string[] = [];
  for (let end = masked.length; end > 0; end -= 4) groups.unshift(masked.slice(Math.max(0, end - 4), end));
  return groups.join(' ');
};
