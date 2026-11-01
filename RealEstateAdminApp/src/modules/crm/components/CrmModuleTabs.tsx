/**
 * Thanh tab module CRM nằm ngang (Việc hôm nay / Khách hàng / Lịch hẹn / Báo cáo).
 * Tách từ mẫu tab gạch chân của Admin: `RealEstateAdminApp/src/screens/KnowledgeConfigScreen.tsx:672-689`
 * (nav.flex.gap-1 trong border-b; nút border-b-2, chọn brand-500/600, thường gray-500).
 * Khác bản gốc: mỗi tab là một route (`<Link>`), có chip số đếm lấy từ lớp dữ liệu CRM, cuộn ngang khi hẹp.
 * Tab hiển thị theo vai trò (Báo cáo chỉ Quản lý/Quản trị).
 *
 * Quy ước responsive: chỉ hiện từ `md` (768px). Dưới `md` các màn tab chính đã có `CrmBottomNav` làm đúng việc này,
 * nên thanh tab ẩn hẳn để không lặp 2 lớp điều hướng.
 */
import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import {
  TAB_ACTIVE_CLASS,
  TAB_BADGE_ACTIVE_CLASS,
  TAB_BADGE_INACTIVE_CLASS,
  TAB_BASE_CLASS,
  TAB_INACTIVE_CLASS,
} from '@crm/lib/uiClasses';
import { useAppointments, useDailyTaskSummary, useListCounts } from '@crm/api';
import { useModuleTabItems } from '@crm/navigation';
import { buildCrmPath } from '@crm/routes';
import { useCurrentView } from '@crm/store';
import type { MainTab } from '@crm/types/app';

export const CrmModuleTabs = () => {
  const currentView = useCurrentView();
  const tabItems = useModuleTabItems();
  const { data: counts } = useListCounts({});
  const { data: taskSummary } = useDailyTaskSummary();
  const { data: appointments } = useAppointments({ status: 'SCHEDULED' });
  const pendingTaskCount = taskSummary.overdue + taskSummary.today;
  const navRef = useRef<HTMLElement>(null);
  const activeTabRef = useRef<HTMLAnchorElement>(null);

  // Khi thanh tab hẹp hơn nội dung (cuộn ngang): đưa tab đang chọn vào giữa vùng nhìn thấy.
  // Chỉ chỉnh `scrollLeft` của thanh tab (không dùng scrollIntoView để trang không bị cuộn dọc).
  useEffect(() => {
    const nav = navRef.current;
    const activeTab = activeTabRef.current;
    if (!nav || !activeTab || nav.scrollWidth <= nav.clientWidth) return;
    nav.scrollLeft = activeTab.offsetLeft - (nav.clientWidth - activeTab.offsetWidth) / 2;
  }, [currentView]);

  const countByTab: Partial<Record<MainTab, number>> = {
    today: pendingTaskCount,
    customers: counts.ALL,
    appointments: appointments.length,
  };

  return (
    <div className="hidden border-b border-gray-200 md:block dark:border-white/[0.05]">
      <nav ref={navRef} className="no-scrollbar relative flex gap-1 overflow-x-auto" aria-label="Phân hệ quản lý khách hàng">
        {tabItems.map(({ view, label, icon: Icon }) => {
          const isActive = currentView === view;
          const count = countByTab[view];
          return (
            <Link
              key={view}
              ref={isActive ? activeTabRef : undefined}
              to={buildCrmPath(view)}
              aria-current={isActive ? 'page' : undefined}
              className={`${TAB_BASE_CLASS} px-4 ${isActive ? TAB_ACTIVE_CLASS : TAB_INACTIVE_CLASS}`}
            >
              <Icon size={16} aria-hidden="true" />
              {label}
              {count !== undefined && (
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${isActive ? TAB_BADGE_ACTIVE_CLASS : TAB_BADGE_INACTIVE_CLASS}`}>
                  {count}
                </span>
              )}
            </Link>
          );
        })}
      </nav>
    </div>
  );
};
