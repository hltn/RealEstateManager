/**
 * Dòng "Mục đích mua" dưới số điện thoại trong ô Khách hàng (bảng + thẻ điện thoại): chữ nhỏ/xám giống dòng SĐT, một dòng,
 * cắt "…" khi dài (rê chuột xem đủ qua `title`). Không có mục đích -> không render gì (không chừa khoảng trống lệch hàng).
 * Mã lựa chọn dịch sang nhãn theo cấu hình trường chân dung do màn truyền xuống (tải 1 lần ở màn, không gọi lại mỗi hàng).
 */
import { Target } from 'lucide-react';
import type { PersonaFieldDefinition } from '@crm/types/crm';
import { formatPurchasePurposes } from '@crm/lib/customerAdapters';

interface PurchasePurposesLineProps {
  purposes: readonly string[];
  /** Định nghĩa trường `purchase_purposes` (nhãn theo cấu hình hiện hành); thiếu thì dùng nhãn mặc định. */
  field?: Pick<PersonaFieldDefinition, 'optionItems'>;
  className?: string;
}

export const PurchasePurposesLine = ({ purposes, field, className = '' }: PurchasePurposesLineProps) => {
  const text = formatPurchasePurposes(purposes, field);
  if (!text) return null;

  return (
    <p className={`flex min-w-0 items-center gap-1 text-theme-xs text-gray-500 dark:text-gray-400 ${className}`} title={`Mục đích mua: ${text}`}>
      <Target size={11} className="shrink-0" aria-hidden="true" />
      <span className="sr-only">Mục đích mua: </span>
      <span className="truncate">{text}</span>
    </p>
  );
};
