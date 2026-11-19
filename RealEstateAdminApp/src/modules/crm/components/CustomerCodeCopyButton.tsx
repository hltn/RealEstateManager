/**
 * Mã khách dạng nút "chip" bấm để sao chép (chỉ bật qua `CustomerCodeBadge isCopyable`: thẻ khách mobile, hàng bảng desktop, header chi tiết).
 * Gợi ý bấm được bằng KIỂU HIỂN THỊ, không thêm chữ hướng dẫn: viền + nền nhẹ dạng viên thuốc, icon Copy nhỏ cạnh mã,
 * đổi màu viền/nền khi hover/active, vòng focus-visible; chip nhìn cao 32px (`min-h-8`) nhưng VÙNG BẤM ~40px (pseudo-element trong suốt `before:-inset-y-1.25`) cho ngón tay (bảng desktop dùng `isCompact`, header chi tiết truyền chip của riêng nó qua `className`).
 * Sao chép xong: icon thành Check xanh ~1.5s rồi trở lại + toast (react-hot-toast phát `role=status`, trình đọc màn hình đọc được).
 * Trợ năng: `aria-label` đặt tên nút ("Sao chép mã khách KH-000053") nên KHÔNG để chữ sr-only "Mã khách" trong nút (sẽ bị bỏ qua/đọc trùng).
 * Chặn nổi bọt click: thẻ/hàng bọc ngoài bấm cả vùng để mở chi tiết; nút này là con của <article>/<td>, không lồng nút trong nút/liên kết.
 */
import type { MouseEvent } from 'react';
import { Check, Copy } from 'lucide-react';
import toast from 'react-hot-toast';
import { useCopyToClipboard } from '@crm/hooks/useCopyToClipboard';

const COPY_TOAST_ID = 'crm-customer-code-copy';

/** Phần chung mọi kiểu: con trỏ tay, số đều chiều rộng, vòng focus-visible. */
const BASE_CLASS =
  'shrink-0 cursor-pointer font-mono tabular-nums transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40';
/**
 * Kiểu chip mặc định (thẻ khách mobile): viền + nền nhẹ, nhìn cao 32px. Vùng bấm nới lên ~40px bằng pseudo-element trong suốt (`before:-inset-y-1.25` = +5px mỗi phía tính từ mép trong viền 1px,
 * là con của nút nên chạm vào đó vẫn là bấm nút): giữ chip gọn trong thẻ 375px (dưới tên, trên dòng Mục đích mua) mà vẫn đủ rộng cho ngón tay, không phình chiều cao thẻ.
 */
const DEFAULT_LOOK_CLASS =
  'relative inline-flex min-h-8 items-center gap-1.5 rounded-full before:absolute before:-inset-y-1.25 before:inset-x-0 border border-gray-200 bg-gray-50 px-2.5 text-theme-xs font-medium text-gray-700 ' +
  'hover:border-brand-300 hover:bg-brand-50 hover:text-brand-600 active:border-brand-300 active:bg-brand-50 ' +
  'dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-gray-300 dark:hover:border-brand-500/40 dark:hover:bg-brand-500/10 dark:hover:text-brand-400 dark:active:border-brand-500/40 dark:active:bg-brand-500/10';
/** Chip gọn cho bảng desktop (con trỏ chuột, vừa chiều cao dòng chữ nhỏ của ô). */
const COMPACT_LOOK_CLASS =
  'inline-flex min-h-6 items-center gap-1 rounded-full border border-gray-200 bg-gray-50 px-2 text-theme-xs font-medium text-gray-700 ' +
  'hover:border-brand-300 hover:bg-brand-50 hover:text-brand-600 active:border-brand-300 active:bg-brand-50 ' +
  'dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-gray-300 dark:hover:border-brand-500/40 dark:hover:bg-brand-500/10 dark:hover:text-brand-400 dark:active:border-brand-500/40 dark:active:bg-brand-500/10';
/** Phản hồi hover/active thêm cho kiểu chip do nơi dùng tự cấp (không biết nền/viền của chip đó nên dùng vòng ring). */
const CUSTOM_LOOK_FEEDBACK_CLASS = 'hover:ring-1 hover:ring-brand-300 active:ring-brand-400 dark:hover:ring-brand-500/40 dark:active:ring-brand-500/60';

interface CustomerCodeCopyButtonProps {
  code: string;
  /** Kiểu chip do nơi dùng cấp (VD chip xám của header chi tiết): THAY kiểu mặc định, vẫn giữ icon + hover/focus/đã-copy. */
  className?: string;
  /** Chip gọn (min-h 24px) cho bảng desktop; bị bỏ qua khi có `className`. */
  isCompact?: boolean;
}

export const CustomerCodeCopyButton = ({ code, className = '', isCompact = false }: CustomerCodeCopyButtonProps) => {
  const { isCopied, copy } = useCopyToClipboard();

  const handleClick = async (event: MouseEvent<HTMLButtonElement>) => {
    // Không để click nổi bọt lên thẻ khách (sẽ mở chi tiết) và không kích hoạt hành vi mặc định nào.
    event.stopPropagation();
    event.preventDefault();
    const isSuccess = await copy(code);
    if (isSuccess) toast.success(`Đã sao chép ${code}`, { id: COPY_TOAST_ID, duration: 1500 });
    else toast.error('Không sao chép được mã khách, vui lòng thử lại.', { id: COPY_TOAST_ID });
  };

  const look = className ? `${className} ${CUSTOM_LOOK_FEEDBACK_CLASS}` : isCompact ? COMPACT_LOOK_CLASS : DEFAULT_LOOK_CLASS;

  return (
    <button type="button" onClick={handleClick} aria-label={`Sao chép mã khách ${code}`} className={`${BASE_CLASS} ${look}`}>
      <span>{code}</span>
      {isCopied ? (
        <Check size={12} className="shrink-0 text-success-600 dark:text-success-400" aria-hidden="true" />
      ) : (
        <Copy size={12} className="shrink-0 text-gray-400 dark:text-gray-500" aria-hidden="true" />
      )}
    </button>
  );
};
