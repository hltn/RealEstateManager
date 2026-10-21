import React from 'react';
import { MainTab } from '../types';
import { STND_LOGO_URL, AVATAR_HANH } from '../data/mockData';

interface SideDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  currentTab: MainTab;
  onSelectTab: (tab: MainTab) => void;
  onOpenAddClient: () => void;
  onOpenCreateAppointment: () => void;
  onOpenAdvancedFilter: () => void;
}

export const SideDrawer: React.FC<SideDrawerProps> = ({
  isOpen,
  onClose,
  currentTab,
  onSelectTab,
  onOpenAddClient,
  onOpenCreateAppointment,
  onOpenAdvancedFilter,
}) => {
  if (!isOpen) return null;

  return (
    <>
      <div
        onClick={onClose}
        className="fixed inset-0 z-50 bg-gray-950/60 backdrop-blur-[2px] transition-opacity animate-in fade-in duration-200"
      />
      <div className="fixed inset-y-0 left-0 z-50 w-72 bg-white shadow-2xl flex flex-col justify-between animate-in slide-in-from-left duration-200">
        <div>
          {/* Header */}
          <div className="p-4 border-b border-gray-100 flex items-center justify-between">
            <img src={STND_LOGO_URL} alt="STND Monogram" className="h-8 w-auto object-contain" />
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-lg flex items-center justify-center text-gray-500 hover:bg-gray-100"
            >
              <span className="material-symbols-outlined text-[20px]">close</span>
            </button>
          </div>

          {/* User profile card */}
          <div className="p-4 bg-brand-50/50 border-b border-brand-100 flex items-center gap-3">
            <div className="relative">
              <img
                src={AVATAR_HANH}
                alt="Trần Mỹ Hạnh"
                className="w-11 h-11 rounded-full object-cover border-2 border-brand-500"
              />
              <span className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 bg-brand-500 rounded-full flex items-center justify-center text-[9px] text-white font-bold">
                ★
              </span>
            </div>
            <div>
              <p className="font-semibold text-gray-900 text-xs">Trần Mỹ Hạnh ★</p>
              <p className="text-[11px] text-gray-500">Trưởng nhóm kinh doanh 1</p>
              <span className="inline-block mt-0.5 px-2 py-0.2 rounded-full text-[10px] bg-success-50 text-success-700 font-medium">
                Đang trực tuyến
              </span>
            </div>
          </div>

          {/* Nav Links */}
          <nav className="p-3 space-y-1">
            {[
              { id: 'today' as MainTab, label: 'Việc hôm nay', icon: 'today', badge: 7 },
              { id: 'customers' as MainTab, label: 'Quản lý khách hàng', icon: 'group' },
              { id: 'appointments' as MainTab, label: 'Lịch hẹn & Nhắc việc', icon: 'calendar_month' },
              { id: 'reports' as MainTab, label: 'Báo cáo & Thống kê', icon: 'bar_chart' },
            ].map((item) => {
              const isActive = currentTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => {
                    onSelectTab(item.id);
                    onClose();
                  }}
                  className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-xs font-medium transition-colors ${
                    isActive
                      ? 'bg-brand-500 text-white shadow-theme-xs'
                      : 'text-gray-700 hover:bg-gray-100'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <span className="material-symbols-outlined text-[20px]">{item.icon}</span>
                    <span>{item.label}</span>
                  </div>
                  {item.badge && (
                    <span
                      className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${
                        isActive ? 'bg-white text-brand-600' : 'bg-brand-50 text-brand-600'
                      }`}
                    >
                      {item.badge}
                    </span>
                  )}
                </button>
              );
            })}

            <div className="border-t border-gray-100 my-2 pt-2">
              <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider px-3 block mb-1">
                Tác vụ nhanh
              </span>
              <button
                onClick={() => {
                  onClose();
                  onOpenAddClient();
                }}
                className="w-full flex items-center gap-2.5 px-3.5 py-2 text-xs text-gray-700 hover:bg-brand-50 hover:text-brand-600 rounded-lg"
              >
                <span className="material-symbols-outlined text-[18px] text-brand-500">person_add</span>
                Thêm khách hàng mới
              </button>
              <button
                onClick={() => {
                  onClose();
                  onOpenCreateAppointment();
                }}
                className="w-full flex items-center gap-2.5 px-3.5 py-2 text-xs text-gray-700 hover:bg-brand-50 hover:text-brand-600 rounded-lg"
              >
                <span className="material-symbols-outlined text-[18px] text-brand-500">add_alarm</span>
                Tạo cuộc hẹn mới
              </button>
              <button
                onClick={() => {
                  onClose();
                  onOpenAdvancedFilter();
                }}
                className="w-full flex items-center gap-2.5 px-3.5 py-2 text-xs text-gray-700 hover:bg-brand-50 hover:text-brand-600 rounded-lg"
              >
                <span className="material-symbols-outlined text-[18px] text-brand-500">tune</span>
                Bộ lọc tìm kiếm nâng cao
              </button>
            </div>
          </nav>
        </div>

        {/* Footer info */}
        <div className="p-4 border-t border-gray-100 bg-gray-50/70 text-[11px] text-gray-500 space-y-1">
          <p className="font-semibold text-gray-700">Hệ thống Quản lý BĐS STND</p>
          <p>Dự án: Q'Terra, The Privia, Ecopark Grand...</p>
        </div>
      </div>
    </>
  );
};
