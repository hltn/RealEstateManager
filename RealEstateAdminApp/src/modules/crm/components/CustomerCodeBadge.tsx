/**
 * Mã khách `KH-######` (FR-04) hiển thị dùng chung: font mono + số đều chiều rộng để các hàng thẳng cột.
 * Trợ năng: `aria-label` trên <span> không có role bị trình đọc màn hình bỏ qua, nên nhãn "Mã khách" là chữ ẩn thị giác (`sr-only`) nằm trong nội dung.
 * `code` null (khách cũ chưa cấp mã) thì không render gì. Mã dài hơn 6 số (`KH-1000000`) vẫn hiển thị đúng nguyên chuỗi.
 */
interface CustomerCodeBadgeProps {
  code: string | null | undefined;
  className?: string;
}

export const CustomerCodeBadge = ({ code, className = '' }: CustomerCodeBadgeProps) => {
  if (!code) return null;
  return (
    <span className={`font-mono tabular-nums ${className}`.trim()}>
      <span className="sr-only">Mã khách </span>
      {code}
    </span>
  );
};
