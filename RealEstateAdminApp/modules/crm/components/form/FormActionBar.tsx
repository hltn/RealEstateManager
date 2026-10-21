import type { ReactNode } from 'react';
import { Info, Save, type LucideIcon } from 'lucide-react';
import { BUTTON_OUTLINE_LG_CLASS, BUTTON_PRIMARY_LG_CLASS } from '@crm/lib/uiClasses';

interface FormActionBarProps {
  variant: 'desktop' | 'mobile';
  submitLabel: string;
  onCancel: () => void;
  /** Ghi chú bên trái (chỉ desktop/tablet). */
  info?: ReactNode;
  /** Ghi chú nhỏ phía trên 2 nút (chỉ mobile), vd "Còn 2 trường bắt buộc". */
  mobileNote?: ReactNode;
  cancelLabel?: string;
  /** Icon nút lưu (mặc định `Save`). */
  submitIcon?: LucideIcon;
}

/**
 * Thanh hành động dính đáy form (Admin chưa có — vẽ theo bố cục Stitch bằng token Admin, tài liệu 03 mục 10).
 * - Desktop/tablet: thẻ `rounded-2xl` dính `bottom-4`, ghi chú trái + Hủy/Lưu phải.
 * - Mobile: thanh tràn viền dính `bottom-0` (màn form ẩn CrmBottomNav), nút Lưu chiếm phần lớn bề ngang.
 * Dùng `sticky` (không `fixed`) để không che nội dung khi cuộn tới cuối form. Nút Lưu là `type="submit"`.
 */
export const FormActionBar = ({
  variant,
  submitLabel,
  onCancel,
  info,
  mobileNote,
  cancelLabel = 'Hủy bỏ',
  submitIcon: SubmitIcon = Save,
}: FormActionBarProps) => {
  if (variant === 'mobile') {
    return (
      <div className="sticky bottom-0 z-20 -mx-4 mt-2 border-t border-gray-200 bg-white/95 px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3 backdrop-blur dark:border-gray-800 dark:bg-gray-900/95">
        {mobileNote && (
          <p className="mb-2 text-center text-theme-xs text-gray-500 dark:text-gray-400" aria-live="polite">
            {mobileNote}
          </p>
        )}
        <div className="flex items-center gap-3">
          <button type="button" onClick={onCancel} className={`${BUTTON_OUTLINE_LG_CLASS} h-11 w-1/3`}>
            {cancelLabel}
          </button>
          <button type="submit" className={`${BUTTON_PRIMARY_LG_CLASS} h-11 flex-1`}>
            <SubmitIcon size={18} aria-hidden="true" />
            <span className="truncate">{submitLabel}</span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="sticky bottom-4 z-20 flex flex-col gap-3 rounded-2xl border border-gray-200 bg-white/95 px-4 py-3 shadow-theme-lg backdrop-blur sm:flex-row sm:items-center sm:justify-between md:px-6 dark:border-gray-800 dark:bg-gray-900/95">
      <p className="flex min-w-0 items-center gap-2 text-theme-sm text-gray-500 dark:text-gray-400" aria-live="polite">
        <Info size={16} aria-hidden="true" className="shrink-0 text-brand-500 dark:text-brand-400" />
        <span className="min-w-0">
          {info ?? (
            <>
              Trường có dấu <span className="font-semibold text-error-500">*</span> là bắt buộc
            </>
          )}
        </span>
      </p>
      <div className="flex shrink-0 items-center justify-end gap-3">
        <button type="button" onClick={onCancel} className={BUTTON_OUTLINE_LG_CLASS}>
          {cancelLabel}
        </button>
        <button type="submit" className={BUTTON_PRIMARY_LG_CLASS}>
          <SubmitIcon size={18} aria-hidden="true" />
          {submitLabel}
        </button>
      </div>
    </div>
  );
};
