/** "0912 345 678" -> "tel:0912345678". */
export const toTelHref = (phone: string): string => `tel:${phone.replace(/[^\d+]/g, '')}`;

/** Mở trình gọi điện của thiết bị (hành vi bản Mobile). */
export const openTelLink = (phone: string): void => {
  if (typeof window === 'undefined') return;
  window.location.href = toTelHref(phone);
};

/** "0912 345 678" / "0912345678" -> "0912 *** 678" (che SĐT trên thẻ/hồ sơ mobile). Số không đủ 10 chữ số giữ nguyên. */
export const maskPhone = (phone: string): string => {
  const digits = phone.replace(/\D/g, '');
  if (digits.length !== 10) return phone;
  return `${digits.slice(0, 4)} *** ${digits.slice(-3)}`;
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
