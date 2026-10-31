import type { ReactNode } from 'react';
import { ArrowLeft } from 'lucide-react';
import { CrmBreadcrumb, type CrmBreadcrumbItem } from '../CrmBreadcrumb';
import { PAGE_DESCRIPTION_CLASS } from '@crm/lib/uiClasses';

interface FormPageHeaderProps {
  variant: 'desktop' | 'mobile';
  title: string;
  description?: string;
  breadcrumbs?: readonly CrmBreadcrumbItem[];
  /** Chip cạnh tiêu đề (tên khách...). */
  badges?: ReactNode;
  /** Nút hành động bên phải (chỉ desktop/tablet). */
  actions?: ReactNode;
  onBack: () => void;
}

/**
 * Đầu trang form CRM theo mẫu "Đầu trang có nút" của Admin (`RawArticlesScreen.tsx:435-491`):
 * `pb-6 border-b`, `h2.text-title-sm.font-semibold`, mô tả `text-theme-sm`.
 * - Desktop/tablet: `CrmBreadcrumb` (nhiều cấp, lớp chữ như `PageBreadCrumb`) + nút bên phải.
 * - Mobile: KHÔNG vẽ top app bar riêng (header/drawer là của Admin) — chỉ hàng "← Quay lại" + tiêu đề trong nội dung.
 */
export const FormPageHeader = ({ variant, title, description, breadcrumbs, badges, actions, onBack }: FormPageHeaderProps) => {
  const isMobile = variant === 'mobile';

  return (
    <header
      className={`flex flex-col border-b border-gray-200 dark:border-white/[0.05] ${
        isMobile ? 'gap-2 pb-4' : 'gap-4 pb-6 lg:flex-row lg:items-end lg:justify-between'
      }`}
    >
      <div className="min-w-0 space-y-2">
        {isMobile ? (
          <button
            type="button"
            onClick={onBack}
            className="-ml-1 inline-flex items-center gap-1.5 rounded-lg px-1 py-1 text-sm font-medium text-gray-600 transition-colors hover:text-brand-500 dark:text-gray-400 dark:hover:text-brand-400"
          >
            <ArrowLeft size={18} aria-hidden="true" />
            Quay lại
          </button>
        ) : (
          breadcrumbs && <CrmBreadcrumb items={breadcrumbs} />
        )}

        <div className="flex flex-wrap items-center gap-2 md:gap-3">
          <h2 className={`font-semibold text-gray-800 dark:text-white/90 ${isMobile ? 'text-xl' : 'text-title-sm'}`}>{title}</h2>
          {badges}
        </div>
        {description && (
          <p className={`max-w-2xl ${PAGE_DESCRIPTION_CLASS}`}>{description}</p>
        )}
      </div>

      {!isMobile && actions && <div className="flex shrink-0 flex-wrap items-center gap-3">{actions}</div>}
    </header>
  );
};
