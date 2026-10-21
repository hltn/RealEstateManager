/**
 * Thanh điều hướng đáy cho module CRM trên mobile (< md / 768px).
 * Admin App KHÔNG có bottom nav → làm theo template Stitch mobile
 * (`stnd-real-estate-crm-oct-15-2026-4-14-56-pm/src/components/BottomNavBar.tsx`) nhưng dùng
 * token + cặp `dark:` của Admin (nền như header/sidebar: `bg-white dark:bg-gray-900`, viền gray-200/800)
 * và icon lucide-react thay Material Symbols.
 * Chỉ CrmLayout render component này (route `/crm/*`), và ẩn trên màn chi tiết/form (mobile chrome = fullscreen).
 */
import { Link } from 'react-router-dom';
import { MODULE_TAB_ITEMS } from '@crm/navigation';
import { buildCrmPath } from '@crm/routes';
import { useCurrentView, usePendingTaskCount } from '@crm/store';

/** Chiều cao thanh (h-16 = 64px) — CrmLayout chừa padding đáy tương ứng để nội dung không bị che. */
export const CRM_BOTTOM_NAV_HEIGHT_CLASS = 'h-16';

export const CrmBottomNav = () => {
  const currentView = useCurrentView();
  const pendingTaskCount = usePendingTaskCount();

  return (
    <nav
      aria-label="Điều hướng module khách hàng"
      className={`fixed inset-x-0 bottom-0 z-40 flex ${CRM_BOTTOM_NAV_HEIGHT_CLASS} items-center justify-around border-t border-gray-200 bg-white px-1 pb-[env(safe-area-inset-bottom)] shadow-theme-lg md:hidden dark:border-gray-800 dark:bg-gray-900`}
    >
      {MODULE_TAB_ITEMS.map(({ view, label, icon: Icon }) => {
        const isActive = currentView === view;
        const hasBadge = view === 'today' && pendingTaskCount > 0;
        return (
          <Link
            key={view}
            to={buildCrmPath(view)}
            aria-current={isActive ? 'page' : undefined}
            className={`relative flex flex-1 flex-col items-center justify-center gap-0.5 py-1 transition-all duration-150 active:scale-95 ${
              isActive
                ? 'font-medium text-brand-500 dark:text-brand-400'
                : 'text-gray-500 hover:text-brand-600 dark:text-gray-400 dark:hover:text-brand-400'
            }`}
          >
            <Icon size={22} strokeWidth={isActive ? 2.25 : 1.75} aria-hidden="true" />
            <span className="text-[11px] leading-tight">{label}</span>
            {hasBadge && (
              <span className="absolute right-[calc(50%-22px)] top-0.5 min-w-[18px] rounded-full bg-error-500 px-1 text-center text-[10px] font-semibold leading-[18px] text-white">
                {pendingTaskCount}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
};
