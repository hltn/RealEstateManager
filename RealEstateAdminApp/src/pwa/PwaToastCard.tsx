import toast, { type Toast } from 'react-hot-toast';

interface PwaToastCardProps {
  toastState: Toast;
  title: string;
  description: string;
  /** Nhãn nút phụ (chỉ đóng thông báo). */
  dismissLabel: string;
  /** Nhãn nút chính. */
  confirmLabel: string;
  onConfirm: () => void;
}

/** Thẻ toast dùng chung cho thông báo PWA (có phiên bản mới, lỗi tải trang). Nút cao 44px (mục tiêu chạm tối thiểu iOS khuyến nghị). */
const PwaToastCard = ({ toastState, title, description, dismissLabel, confirmLabel, onConfirm }: PwaToastCardProps) => (
  <div
    role="status"
    className={`pointer-events-auto w-full max-w-sm rounded-xl border border-gray-200 bg-white p-4 shadow-theme-lg transition-opacity duration-200 dark:border-gray-800 dark:bg-gray-900 ${
      toastState.visible ? 'opacity-100' : 'opacity-0'
    }`}
  >
    <p className="text-sm font-medium text-gray-800 dark:text-white/90">{title}</p>
    <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{description}</p>
    <div className="mt-3 flex justify-end gap-2">
      <button
        type="button"
        onClick={() => toast.dismiss(toastState.id)}
        className="min-h-11 rounded-lg px-4 text-sm text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-white/5"
      >
        {dismissLabel}
      </button>
      <button type="button" onClick={onConfirm} className="min-h-11 rounded-lg bg-brand-500 px-4 text-sm font-medium text-white hover:bg-brand-600">
        {confirmLabel}
      </button>
    </div>
  </div>
);

export default PwaToastCard;
