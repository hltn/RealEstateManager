// Mảnh giao diện lặp lại giữa các thẻ của biến thể Mobile (tiêu đề thẻ, nhãn nhóm, ô thông tin) — phong cách Admin.
import type { ReactNode } from 'react';
import { Pencil, type LucideIcon } from 'lucide-react';
import { BUTTON_LINK_CLASS, CARD_TITLE_CLASS, DIVIDER_CLASS, INSET_CLASS } from '@crm/lib/uiClasses';

/** Thẻ khối của mobile (mẫu "thẻ" Admin, p-4 như vùng nội dung mobile). */
export const MOBILE_CARD_CLASS =
  'space-y-4 rounded-2xl border border-gray-200 bg-white p-4 dark:border-white/[0.05] dark:bg-white/[0.03]';

/** Hộp nhóm trong thẻ. */
export const MOBILE_GROUP_BOX_CLASS = `${INSET_CLASS} space-y-2 p-3`;

interface MobileSectionHeaderProps {
  icon: LucideIcon;
  title: string;
  /** Nút bên phải tiêu đề (vd "Sửa") hoặc nhãn phụ. */
  trailing?: ReactNode;
}

export const MobileSectionHeader = ({ icon: Icon, title, trailing }: MobileSectionHeaderProps) => (
  <div className={`flex items-center justify-between gap-2 border-b pb-3 ${DIVIDER_CLASS}`}>
    <div className="flex min-w-0 items-center gap-2">
      <Icon size={18} aria-hidden="true" className="shrink-0 text-brand-500 dark:text-brand-400" />
      <h3 className={`truncate ${CARD_TITLE_CLASS}`}>{title}</h3>
    </div>
    {trailing}
  </div>
);

interface MobileEditButtonProps {
  label: string;
  onClick: () => void;
}

export const MobileEditButton = ({ label, onClick }: MobileEditButtonProps) => (
  <button type="button" onClick={onClick} aria-label={label} className={BUTTON_LINK_CLASS}>
    <Pencil size={14} aria-hidden="true" />
    Sửa
  </button>
);

interface MobileGroupLabelProps {
  icon: LucideIcon;
  children: ReactNode;
}

export const MobileGroupLabel = ({ icon: Icon, children }: MobileGroupLabelProps) => (
  <div className="flex items-center gap-1.5 text-theme-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
    <Icon size={14} aria-hidden="true" className="shrink-0" />
    <span>{children}</span>
  </div>
);
