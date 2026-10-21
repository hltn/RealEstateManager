import React from 'react';
import { MainTab } from '../types';

interface ModuleNavTabsProps {
  currentTab: MainTab;
  onSelectTab: (tab: MainTab) => void;
  todayCount?: number;
}

export const ModuleNavTabs: React.FC<ModuleNavTabsProps> = ({
  currentTab,
  onSelectTab,
  todayCount = 7,
}) => {
  const tabs: Array<{ id: MainTab; label: string; countBadge?: number }> = [
    { id: 'today', label: 'Việc hôm nay', countBadge: todayCount },
    { id: 'customers', label: 'Khách hàng' },
    { id: 'appointments', label: 'Lịch hẹn' },
    { id: 'reports', label: 'Báo cáo' },
  ];

  return (
    <div className="flex border-b border-gray-200 overflow-x-auto no-scrollbar gap-5 mb-4 px-1">
      {tabs.map((tab) => {
        const isActive = currentTab === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => onSelectTab(tab.id)}
            className={`whitespace-nowrap pb-2.5 text-body-md transition-colors flex items-center gap-1.5 ${
              isActive
                ? 'font-medium text-brand-500 border-b-2 border-brand-500'
                : 'text-gray-500 hover:text-brand-500'
            }`}
          >
            <span>{tab.label}</span>
            {tab.countBadge !== undefined && (
              <span
                className={`px-1.5 py-0.5 rounded-full text-[10px] font-semibold leading-none ${
                  isActive
                    ? 'bg-brand-50 text-brand-500'
                    : 'bg-gray-100 text-gray-600'
                }`}
              >
                {tab.countBadge}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
};
