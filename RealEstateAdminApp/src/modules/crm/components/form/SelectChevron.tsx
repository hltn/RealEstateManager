import { ChevronDown } from 'lucide-react';

/**
 * Mũi tên tự vẽ cho `<select>` đã `appearance-none` (select có icon trái, xem `SELECT_WITH_ICON_CLASS`).
 * Đặt trong khung `relative` bao quanh select; không bắt chuột để chạm vào vẫn mở danh sách chọn.
 */
export const SelectChevron = () => (
  <ChevronDown size={18} aria-hidden="true" className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500" />
);
