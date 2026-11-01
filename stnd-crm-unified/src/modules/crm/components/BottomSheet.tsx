/**
 * Bottom sheet cho mobile (< 768px). Admin App KHÔNG có (tài liệu 03 mục 10: "Bottom sheet … Làm mới")
 * → bố cục theo Stitch mobile (thanh kéo, đầu sheet, nội dung cuộn, chân cố định) nhưng dùng token Admin:
 * - lớp phủ + hành vi giống `components/ui/modal`: `z-99999`, Esc để đóng, khoá cuộn body, bấm nền để đóng;
 * - nền như hộp thoại Admin `bg-white dark:bg-gray-900`, viền `gray-200 / gray-800`, bo `rounded-t-2xl`.
 * Chân sheet chừa `env(safe-area-inset-bottom)` cho iPhone; sheet phủ lên CrmBottomNav (z-40).
 */
import { useEffect, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { ICON_BUTTON_CLASS } from '@crm/lib/uiClasses';

interface BottomSheetProps {
  title: ReactNode;
  /** Dòng phụ dưới tiêu đề (vd tên khách). */
  subtitle?: ReactNode;
  /** Nút phụ ở góc phải đầu sheet (vd "Thiết lập lại"). */
  headerAction?: ReactNode;
  /** Chân sheet cố định (nút hành động). */
  footer?: ReactNode;
  onClose: () => void;
  /** id gắn cho tiêu đề để `aria-labelledby`. */
  titleId: string;
  children: ReactNode;
}

export const BottomSheet = ({ title, subtitle, headerAction, footer, onClose, titleId, children }: BottomSheetProps) => {
  // Esc để đóng + khoá cuộn trang phía sau (giống Modal của Admin).
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-99999 flex items-end justify-center">
      <div aria-hidden="true" onClick={onClose} className="absolute inset-0 bg-gray-900/60 backdrop-blur-[2px]" />
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative flex max-h-[92dvh] w-full max-w-lg flex-col rounded-t-2xl border-t border-gray-200 bg-white shadow-theme-xl dark:border-gray-800 dark:bg-gray-900"
      >
        {/* Đầu sheet: thanh kéo + tiêu đề + nút đóng */}
        <header className="shrink-0 border-b border-gray-100 px-4 pb-3 pt-2.5 dark:border-white/[0.05]">
          <div aria-hidden="true" className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-gray-200 dark:bg-gray-700" />
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-1">
              <button type="button" onClick={onClose} aria-label="Đóng" className={`${ICON_BUTTON_CLASS} -ml-2`}>
                <X size={20} aria-hidden="true" />
              </button>
              <div className="min-w-0">
                <h2 id={titleId} className="truncate text-base font-semibold text-gray-800 dark:text-white/90">
                  {title}
                </h2>
                {subtitle && <p className="truncate text-theme-xs text-gray-500 dark:text-gray-400">{subtitle}</p>}
              </div>
            </div>
            {headerAction}
          </div>
        </header>

        <div className="flex-1 overflow-y-auto overscroll-contain px-4 py-4">{children}</div>

        {footer && (
          <footer className="shrink-0 border-t border-gray-200 px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] dark:border-gray-800">
            {footer}
          </footer>
        )}
      </section>
    </div>
  );
};
