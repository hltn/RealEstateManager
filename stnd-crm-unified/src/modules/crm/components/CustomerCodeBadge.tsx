/**
 * Mã khách `KH-000123` (v1.0.5, FR-04): hiển thị cho mọi vai trò, font-mono. Trình đọc màn hình đọc "Mã khách KH-000123" nhờ tiền tố `sr-only`
 * nằm trong nội dung chữ (không dùng `aria-label` trên `span` không có role vì bị bỏ qua).
 * Khách cũ chưa có mã (`null`) -> không vẽ gì (không để lại khoảng trống/dấu phân cách).
 */
import { displayCustomerCode } from '@crm/lib/customerCode';

interface CustomerCodeBadgeProps {
  code: string | null | undefined;
  className?: string;
}

export const CustomerCodeBadge = ({ code, className = '' }: CustomerCodeBadgeProps) => {
  const text = displayCustomerCode(code);
  if (!text) return null;
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-md bg-gray-100 px-1.5 py-0.5 font-mono text-theme-xs font-medium text-gray-600 dark:bg-white/[0.06] dark:text-gray-300 ${className}`}
    >
      <span className="sr-only">Mã khách </span>
      {text}
    </span>
  );
};
