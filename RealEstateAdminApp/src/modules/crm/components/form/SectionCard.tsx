import { useId, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { CARD_CLASS, DIVIDER_CLASS } from '@crm/lib/uiClasses';

interface SectionCardProps {
  title: string;
  /** Dấu đầu khối: icon lucide (form khách, cấu hình AI) hoặc số thứ tự bước (form lịch hẹn). */
  icon?: LucideIcon;
  step?: number;
  description?: string;
  /** Nội dung bên phải tiêu đề (chip "Bắt buộc", số đã chọn...). */
  aside?: ReactNode;
  className?: string;
  children: ReactNode;
}

/**
 * Khối form: mẫu "Thẻ" + "Thẻ tiêu đề khối" của Admin (`CronjobScreen.tsx:58`, `ExternalLogsScreen.tsx:296-301`):
 * dấu đầu khối brand trong ô vuông (icon 20px hoặc số bước), `h3.text-lg.font-semibold`, mô tả `text-theme-sm`.
 */
export const SectionCard = ({ icon: Icon, step, title, description, aside, className, children }: SectionCardProps) => {
  const titleId = useId();
  return (
    <section aria-labelledby={titleId} className={`${CARD_CLASS} p-4 sm:p-5 xl:p-6 ${className ?? ''}`}>
      <div className={`mb-5 flex items-start justify-between gap-3 border-b pb-4 ${DIVIDER_CLASS}`}>
        <div className="flex min-w-0 items-center gap-3">
          {Icon && (
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-500 dark:bg-brand-500/15 dark:text-brand-400">
              <Icon size={20} aria-hidden="true" />
            </span>
          )}
          {!Icon && step !== undefined && (
            <span
              aria-hidden="true"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-sm font-semibold text-brand-500 dark:bg-brand-500/15 dark:text-brand-400"
            >
              {step}
            </span>
          )}
          <div className="min-w-0">
            <h3 id={titleId} className="text-base font-semibold text-gray-800 sm:text-lg dark:text-white/90">
              {title}
            </h3>
            {description && <p className="text-theme-sm text-gray-500 dark:text-gray-400">{description}</p>}
          </div>
        </div>
        {aside && <div className="shrink-0">{aside}</div>}
      </div>
      <div className="space-y-5">{children}</div>
    </section>
  );
};
