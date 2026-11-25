/**
 * Mã khách `KH-000123` (v1.0.5, FR-04): hiển thị cho mọi vai trò, font-mono. Trình đọc màn hình đọc "Mã khách KH-000123" nhờ tiền tố `sr-only`
 * nằm trong nội dung chữ (không dùng `aria-label` trên `span` không có role vì bị bỏ qua).
 * Khách cũ chưa có mã (`null`) -> không vẽ gì (không để lại khoảng trống/dấu phân cách).
 * Mặc định chỉ là chữ (không tương tác) ở mọi nơi; `isCopyable` (opt-in, thẻ khách mobile, hàng bảng desktop, header chi tiết; KHÔNG bật ở màn Khách đã xóa và ô chọn khách) đổi thành nút chip bấm để sao chép; `className` khi đó thay kiểu chip mặc định.
 */
import { displayCustomerCode } from '@crm/lib/customerCode';
import { CustomerCodeCopyButton } from './CustomerCodeCopyButton';

interface CustomerCodeBadgeProps {
  code: string | null | undefined;
  className?: string;
  /** Bật chế độ bấm để sao chép (nút chip). Mặc định tắt: giữ nguyên hiển thị chữ thuần. */
  isCopyable?: boolean;
  /** Chỉ có nghĩa khi `isCopyable`: chip gọn cho bảng desktop. */
  isCompact?: boolean;
}

export const CustomerCodeBadge = ({ code, className = '', isCopyable = false, isCompact = false }: CustomerCodeBadgeProps) => {
  const text = displayCustomerCode(code);
  if (!text) return null;
  if (isCopyable) return <CustomerCodeCopyButton code={text} className={className} isCompact={isCompact} />;
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-md bg-gray-100 px-1.5 py-0.5 font-mono text-theme-xs font-medium text-gray-600 dark:bg-white/[0.06] dark:text-gray-300 ${className}`}
    >
      <span className="sr-only">Mã khách </span>
      {text}
    </span>
  );
};
