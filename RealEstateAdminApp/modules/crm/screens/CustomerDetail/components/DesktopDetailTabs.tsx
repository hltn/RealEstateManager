// Thanh 3 tab của màn chi tiết (Admin CustomerDetailView, khối 2) — dùng mẫu tab gạch chân của Admin
// (KnowledgeConfigScreen.tsx:672-689, cùng kiểu `@crm/components/CrmModuleTabs`) thay "viên thuốc" của Stitch.
import { CircleUserRound, History, ListChecks, type LucideIcon } from 'lucide-react';
import {
  TAB_ACTIVE_CLASS,
  TAB_BADGE_ACTIVE_CLASS,
  TAB_BADGE_INACTIVE_CLASS,
  TAB_BASE_CLASS,
  TAB_INACTIVE_CLASS,
} from '@crm/lib/uiClasses';

export type DesktopDetailTab = 'info' | 'criteria' | 'logs';

interface DesktopDetailTabsProps {
  activeTab: DesktopDetailTab;
  onChange: (tab: DesktopDetailTab) => void;
  progressPercentage: number;
  careLogCount: number;
}

interface TabItem {
  id: DesktopDetailTab;
  icon: LucideIcon;
  label: string;
}

const TAB_ITEMS: TabItem[] = [
  { id: 'info', icon: CircleUserRound, label: 'Thông tin & Chân dung' },
  { id: 'criteria', icon: ListChecks, label: 'Tiến độ & 4 Tiêu chí' },
  { id: 'logs', icon: History, label: 'Nhật ký chăm sóc' },
];

export const DesktopDetailTabs = ({ activeTab, onChange, progressPercentage, careLogCount }: DesktopDetailTabsProps) => {
  const badgeByTab: Partial<Record<DesktopDetailTab, string>> = {
    criteria: `${progressPercentage}%`,
    logs: String(careLogCount),
  };

  return (
    <div className="border-b border-gray-200 dark:border-white/[0.05]">
      <div role="tablist" aria-label="Thông tin khách hàng" className="no-scrollbar flex gap-1 overflow-x-auto">
        {TAB_ITEMS.map(({ id, icon: Icon, label }) => {
          const isActive = activeTab === id;
          const badge = badgeByTab[id];
          return (
            <button
              key={id}
              type="button"
              role="tab"
              id={`customer-detail-tab-${id}`}
              aria-selected={isActive}
              aria-controls={`customer-detail-panel-${id}`}
              onClick={() => onChange(id)}
              className={`${TAB_BASE_CLASS} px-4 ${isActive ? TAB_ACTIVE_CLASS : TAB_INACTIVE_CLASS}`}
            >
              <Icon size={16} aria-hidden="true" />
              {label}
              {badge && (
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${isActive ? TAB_BADGE_ACTIVE_CLASS : TAB_BADGE_INACTIVE_CLASS}`}
                >
                  {badge}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
};
