/**
 * Breadcrumb nhiều cấp dùng chung cho các màn CRM (desktop/tablet).
 * Cùng lớp chữ với `components/common/PageBreadCrumb.tsx` của Admin (`text-sm text-gray-500 dark:text-gray-400`,
 * mục hiện tại `text-gray-800 dark:text-white/90`, mũi tên giữa các mục) — bản Admin chỉ có 1 cấp và chữ "Home"
 * cố định nên module CRM dựng bản nhiều cấp, nhãn tiếng Việt, mỗi cấp là một `<Link>` của react-router.
 */
import { ChevronRight } from 'lucide-react';
import { Link } from 'react-router-dom';

export interface CrmBreadcrumbItem {
  label: string;
  /** URL đích (`buildCrmPath(...)`); bỏ trống = mục hiện tại / không bấm được. */
  to?: string;
}

interface CrmBreadcrumbProps {
  items: readonly CrmBreadcrumbItem[];
  className?: string;
}

const LINK_CLASS =
  'truncate text-gray-500 transition-colors hover:text-brand-500 dark:text-gray-400 dark:hover:text-brand-400';

export const CrmBreadcrumb = ({ items, className = '' }: CrmBreadcrumbProps) => {
  if (items.length === 0) return null;
  return (
    <nav aria-label="Breadcrumb" className={`min-w-0 ${className}`}>
      <ol className="flex flex-wrap items-center gap-1.5 text-sm">
        {items.map((item, index) => {
          const isLast = index === items.length - 1;
          return (
            <li key={`${item.label}-${index}`} className="flex min-w-0 items-center gap-1.5">
              {item.to && !isLast ? (
                <Link to={item.to} className={LINK_CLASS}>
                  {item.label}
                </Link>
              ) : (
                <span aria-current={isLast ? 'page' : undefined} className="truncate text-gray-800 dark:text-white/90">
                  {item.label}
                </span>
              )}
              {!isLast && <ChevronRight size={16} aria-hidden="true" className="shrink-0 text-gray-400 dark:text-gray-500" />}
            </li>
          );
        })}
      </ol>
    </nav>
  );
};
