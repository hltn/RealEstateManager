import React from 'react';
import { MainTab } from '../types';

interface BottomNavBarProps {
  currentTab: MainTab;
  onSelectTab: (tab: MainTab) => void;
  todayCount?: number;
}

export const BottomNavBar: React.FC<BottomNavBarProps> = ({
  currentTab,
  onSelectTab,
  todayCount = 7,
}) => {
  const navItems: Array<{
    id: MainTab;
    label: string;
    icon: string;
    badge?: number;
  }> = [
    { id: 'today', label: 'Việc hôm nay', icon: 'today', badge: todayCount },
    { id: 'customers', label: 'Khách hàng', icon: 'group' },
    { id: 'appointments', label: 'Lịch hẹn', icon: 'calendar_month' },
    { id: 'reports', label: 'Báo cáo', icon: 'bar_chart' },
  ];

  return (
    <nav
      aria-label="Bottom Navigation"
      className="fixed bottom-0 left-0 right-0 max-w-md mx-auto z-40 flex justify-around items-center h-16 px-1 bg-white border-t border-gray-200 shadow-theme-lg"
    >
      {navItems.map((item) => {
        const isActive = currentTab === item.id;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onSelectTab(item.id)}
            className={`flex flex-col items-center justify-center flex-1 py-1 transition-all active:scale-95 duration-150 relative ${
              isActive ? 'text-brand-500 font-medium' : 'text-gray-500 hover:text-brand-600'
            }`}
          >
            <span
              className="material-symbols-outlined text-[22px] mb-0.5"
              style={{
                fontVariationSettings: isActive ? "'FILL' 1" : "'FILL' 0",
              }}
            >
              {item.icon}
            </span>
            <span className="text-[11px] leading-tight">{item.label}</span>

            {/* Notification Badge if applicable */}
            {item.id === 'appointments' && (
              <span className="absolute top-1.5 right-6 w-2 h-2 rounded-full bg-brand-500"></span>
            )}
          </button>
        );
      })}
    </nav>
  );
};
