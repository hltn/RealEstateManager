/**
 * Mã khách `KH-######` (FR-04) hiển thị dùng chung: font mono + số đều chiều rộng để các hàng thẳng cột.
 * Trợ năng: `aria-label` trên <span> không có role bị trình đọc màn hình bỏ qua, nên nhãn "Mã khách" là chữ ẩn thị giác (`sr-only`) nằm trong nội dung.
 * `code` null (khách cũ chưa cấp mã) thì không render gì. Mã dài hơn 6 số (`KH-1000000`) vẫn hiển thị đúng nguyên chuỗi.
 * Mặc định chỉ là chữ (không tương tác) ở mọi nơi; `isCopyable` (opt-in: thẻ khách mobile, hàng bảng desktop, header chi tiết; KHÔNG bật ở màn Khách đã xóa) đổi thành nút chip bấm để sao chép; `className` khi đó thay kiểu chip mặc định.
 */
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
  if (!code) return null;
  if (isCopyable) return <CustomerCodeCopyButton code={code} className={className} isCompact={isCompact} />;
  return (
    <span className={`font-mono tabular-nums ${className}`.trim()}>
      <span className="sr-only">Mã khách </span>
      {code}
    </span>
  );
};
