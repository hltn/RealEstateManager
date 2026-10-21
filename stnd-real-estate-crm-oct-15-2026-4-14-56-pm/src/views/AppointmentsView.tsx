import React, { useState } from 'react';
import { Appointment, Customer } from '../types';
import { ModuleNavTabs } from '../components/ModuleNavTabs';

interface AppointmentsViewProps {
  appointments: Appointment[];
  customers: Customer[];
  onOpenCreateAppointment: () => void;
  onSelectCustomer: (cust: Customer) => void;
  onCall: (phone: string, name: string) => void;
  onSelectTab: (tab: any) => void;
  onToggleCompleteAppointment: (id: string) => void;
}

export const AppointmentsView: React.FC<AppointmentsViewProps> = ({
  appointments,
  customers,
  onOpenCreateAppointment,
  onSelectCustomer,
  onCall,
  onSelectTab,
  onToggleCompleteAppointment,
}) => {
  const [viewScope, setViewScope] = useState<'week' | 'month' | 'list'>('week');
  const [selectedDay, setSelectedDay] = useState<number>(21);

  const weekDays = [
    { day: 'T2', num: 19, hasEvent: false, count: 0 },
    { day: 'T3', num: 20, hasEvent: true, count: 1 },
    { day: 'T4', num: 21, hasEvent: true, count: 3, isToday: true },
    { day: 'T5', num: 22, hasEvent: true, count: 1 },
    { day: 'T6', num: 23, hasEvent: true, count: 1 },
    { day: 'T7', num: 24, hasEvent: false, count: 0 },
    { day: 'CN', num: 25, hasEvent: true, count: 2 },
  ];

  const morningAppointments = appointments.filter((a) => a.period === 'morning');
  const afternoonAppointments = appointments.filter((a) => a.period === 'afternoon');

  const handleOpenClientProfile = (customerId: string) => {
    const cust = customers.find((c) => c.id === customerId);
    if (cust) {
      onSelectCustomer(cust);
    } else {
      // fallback to first customer
      if (customers.length > 0) onSelectCustomer(customers[0]);
    }
  };

  return (
    <div className="flex-1 pb-24 px-4 pt-3 max-w-md mx-auto w-full animate-in fade-in duration-200">
      {/* Title & Primary CTA */}
      <div className="flex items-center justify-between gap-2 mb-3">
        <div>
          <h1 className="text-headline-sm-mobile font-bold text-gray-900 tracking-tight">
            Lịch hẹn & Nhắc việc
          </h1>
          <p className="text-label-xs text-gray-500 mt-0.5">
            Mục 4.4 • STND Real Estate Manager
          </p>
        </div>
        <button
          type="button"
          onClick={onOpenCreateAppointment}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-brand-500 hover:bg-brand-600 active:scale-95 text-white rounded-lg shadow-theme-xs font-medium transition-all text-xs shrink-0"
        >
          <span className="material-symbols-outlined text-[18px]">add</span>
          <span>Tạo lịch hẹn</span>
        </button>
      </div>

      {/* Internal Module Nav Tabs */}
      <ModuleNavTabs currentTab="appointments" onSelectTab={onSelectTab} todayCount={7} />

      {/* Quick Metrics Counter (3-Tile Bento Style) */}
      <section className="grid grid-cols-3 gap-2.5 mb-4">
        <div className="bg-white p-3 rounded-2xl border border-gray-200 shadow-theme-xs flex flex-col justify-between">
          <span className="text-label-xs text-gray-500 truncate">Tổng cuộc hẹn</span>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="text-title-lg text-gray-900 font-bold">{appointments.length || 12}</span>
            <span className="material-symbols-outlined text-brand-500 text-[18px]">calendar_today</span>
          </div>
        </div>

        <div className="bg-brand-50/60 p-3 rounded-2xl border border-brand-100 shadow-theme-xs flex flex-col justify-between">
          <span className="text-label-xs text-brand-700 font-medium truncate">Hôm nay</span>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="text-title-lg text-brand-700 font-bold">3</span>
            <span className="material-symbols-outlined text-brand-500 text-[18px]">notifications_active</span>
          </div>
        </div>

        <div className="bg-white p-3 rounded-2xl border border-gray-200 shadow-theme-xs flex flex-col justify-between">
          <span className="text-label-xs text-gray-500 truncate">Sắp tới</span>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="text-title-lg text-gray-900 font-bold">9</span>
            <span className="material-symbols-outlined text-success-700 text-[18px]">upcoming</span>
          </div>
        </div>
      </section>

      {/* Calendar Scope Controller */}
      <section className="bg-white rounded-2xl border border-gray-200 p-3.5 shadow-theme-xs space-y-3.5 mb-4">
        {/* View Mode Segmented Control */}
        <div className="grid grid-cols-3 bg-gray-100 p-1 rounded-xl text-center text-xs">
          <button
            type="button"
            onClick={() => setViewScope('week')}
            className={`py-1.5 rounded-lg transition-all ${
              viewScope === 'week'
                ? 'bg-brand-50 text-brand-500 font-medium shadow-theme-xs'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            Tuần
          </button>
          <button
            type="button"
            onClick={() => setViewScope('month')}
            className={`py-1.5 rounded-lg transition-all ${
              viewScope === 'month'
                ? 'bg-brand-50 text-brand-500 font-medium shadow-theme-xs'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            Tháng
          </button>
          <button
            type="button"
            onClick={() => setViewScope('list')}
            className={`py-1.5 rounded-lg transition-all ${
              viewScope === 'list'
                ? 'bg-brand-50 text-brand-500 font-medium shadow-theme-xs'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            Danh sách
          </button>
        </div>

        {/* Month Navigator Header */}
        <div className="flex items-center justify-between px-1">
          <button
            type="button"
            className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-gray-100 text-gray-600 transition-colors"
          >
            <span className="material-symbols-outlined text-[20px]">chevron_left</span>
          </button>
          <div className="flex items-center gap-1.5 text-gray-900 font-semibold text-sm">
            <span className="material-symbols-outlined text-brand-500 text-[20px]">calendar_month</span>
            <span>Tháng 10, 2026</span>
          </div>
          <button
            type="button"
            className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-gray-100 text-gray-600 transition-colors"
          >
            <span className="material-symbols-outlined text-[20px]">chevron_right</span>
          </button>
        </div>

        {/* 7-Day Strip */}
        <div className="grid grid-cols-7 gap-1 pt-1">
          {weekDays.map((item) => {
            const isSelected = selectedDay === item.num;
            return (
              <button
                key={item.num}
                type="button"
                onClick={() => setSelectedDay(item.num)}
                className={`flex flex-col items-center py-2 px-1 rounded-xl transition-all ${
                  isSelected
                    ? 'bg-brand-500 text-white shadow-theme-xs'
                    : 'hover:bg-gray-50'
                }`}
              >
                <span className={`text-label-xs ${isSelected ? 'text-white opacity-90' : 'text-gray-400'}`}>
                  {item.day}
                </span>
                <span
                  className={`mt-1 text-sm font-semibold flex items-center justify-center ${
                    isSelected
                      ? 'bg-white text-brand-500 rounded-full w-6 h-6'
                      : 'text-gray-700'
                  }`}
                >
                  {item.num}
                </span>
                <span className="mt-1">
                  {isSelected ? (
                    <span className="text-[10px] font-semibold text-white">3 hẹn</span>
                  ) : item.hasEvent ? (
                    <span className="block w-1.5 h-1.5 rounded-full bg-brand-400" />
                  ) : (
                    <span className="block w-1.5 h-1.5 rounded-full bg-transparent" />
                  )}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {/* Time Schedule Sections */}
      {/* 1. BUỔI SÁNG */}
      <section className="space-y-3 mb-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-success-500"></span>
            <h2 className="font-semibold text-gray-900 text-sm">Buổi sáng (09:00 - 11:30)</h2>
          </div>
          <span className="text-label-xs text-gray-500">{morningAppointments.length} lịch hẹn</span>
        </div>

        {morningAppointments.map((item) => (
          <article
            key={item.id}
            className="bg-white rounded-2xl border border-gray-200 border-l-[5px] border-l-success-500 shadow-theme-xs p-4 space-y-3 hover:shadow-theme-sm transition-shadow"
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <span className="inline-flex items-center gap-1 text-label-xs text-success-700 bg-success-50 px-2 py-0.5 rounded-full font-medium">
                  <span className="material-symbols-outlined text-[14px]">home</span>
                  {item.typeLabel}
                </span>
                <h3 className="text-title-md text-gray-900 mt-1 font-semibold">{item.title}</h3>
              </div>
              <button
                type="button"
                className="text-gray-400 hover:text-gray-600 p-1 rounded"
              >
                <span className="material-symbols-outlined text-[20px]">more_vert</span>
              </button>
            </div>

            <div className="space-y-1.5 text-xs text-gray-600 border-t border-b border-gray-100 py-2.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-gray-400 text-[18px]">person</span>
                  <span className="text-gray-900 font-medium">Khách: {item.customerName}</span>
                </div>
                <span className="rounded-full h-6 px-2.5 text-label-xs inline-flex items-center bg-purple-100 text-purple-800 font-medium">
                  {item.customerTag || 'Có quan tâm'}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-gray-400 text-[18px]">pin_drop</span>
                <span className="truncate">{item.location}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-gray-400 text-[18px]">badge</span>
                <span className="text-gray-700">
                  Phụ trách: <strong className="text-gray-900 font-semibold">{item.assignedLead}</strong>
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                onClick={() => onCall(item.customerPhone || '0912345678', item.customerName)}
                className="flex-1 inline-flex items-center justify-center gap-1.5 h-9 rounded-lg bg-brand-50 hover:bg-brand-100 text-brand-500 font-medium text-xs transition-colors"
              >
                <span className="material-symbols-outlined text-[16px]">call</span>
                <span>Gọi nhanh</span>
              </button>
              <button
                type="button"
                onClick={() => handleOpenClientProfile(item.customerId)}
                className="flex-1 inline-flex items-center justify-center gap-1.5 h-9 rounded-lg border border-gray-200 bg-gray-100 hover:bg-gray-200 text-gray-700 font-medium text-xs transition-colors"
              >
                <span className="material-symbols-outlined text-[16px]">account_box</span>
                <span>Vào hồ sơ khách</span>
              </button>
            </div>
          </article>
        ))}
      </section>

      {/* 2. BUỔI CHIỀU */}
      <section className="space-y-3 mb-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-orange-400"></span>
            <h2 className="font-semibold text-gray-900 text-sm">Buổi chiều (14:00 - 17:00)</h2>
          </div>
          <span className="text-label-xs text-gray-500">{afternoonAppointments.length} sự kiện</span>
        </div>

        {afternoonAppointments.map((item) => {
          const isDeposit = item.type === 'ky_coc';
          const isReminder = item.type === 'nhac_goi';

          return (
            <article
              key={item.id}
              className={`bg-white rounded-2xl border border-gray-200 shadow-theme-xs p-4 space-y-3 hover:shadow-theme-sm transition-shadow ${
                isDeposit
                  ? 'border-l-[5px] border-l-orange-400'
                  : 'border-l-[5px] border-l-brand-500'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <span
                    className={`inline-flex items-center gap-1 text-label-xs px-2 py-0.5 rounded-full font-medium ${
                      isDeposit
                        ? 'text-warning-700 bg-warning-50'
                        : 'text-brand-500 bg-brand-50'
                    }`}
                  >
                    <span className="material-symbols-outlined text-[14px]">
                      {isDeposit ? 'history_edu' : 'phone_callback'}
                    </span>
                    {item.typeLabel}
                  </span>
                  <h3 className="text-title-md text-gray-900 mt-1 font-semibold">{item.title}</h3>
                </div>
                <button
                  type="button"
                  className="text-gray-400 hover:text-gray-600 p-1 rounded"
                >
                  <span className="material-symbols-outlined text-[20px]">more_vert</span>
                </button>
              </div>

              <div className="space-y-1.5 text-xs text-gray-600 border-t border-b border-gray-100 py-2.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-gray-400 text-[18px]">person</span>
                    <span className="text-gray-900 font-medium">Khách: {item.customerName}</span>
                  </div>
                  <span
                    className={`rounded-full h-6 px-2.5 text-label-xs inline-flex items-center font-medium ${
                      isDeposit
                        ? 'bg-warning-50 text-warning-700'
                        : 'bg-gray-100 text-gray-600'
                    }`}
                  >
                    {item.customerTag || 'Chờ gọi lại'}
                  </span>
                </div>

                {isDeposit ? (
                  <div className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-gray-400 text-[18px]">location_on</span>
                    <span>
                      Địa điểm: <strong className="text-gray-800">{item.location}</strong>
                    </span>
                  </div>
                ) : (
                  <div className="flex items-start gap-2 bg-gray-50 p-2 rounded-lg text-gray-700">
                    <span className="material-symbols-outlined text-brand-500 text-[16px] mt-0.5 shrink-0">
                      edit_note
                    </span>
                    <span className="text-xs italic">{item.note || 'Ghi chú: "Gọi sau 16h khách rảnh"'}</span>
                  </div>
                )}
              </div>

              <div className="flex items-center gap-2 pt-1">
                {isDeposit ? (
                  <>
                    <button
                      type="button"
                      onClick={() => onToggleCompleteAppointment(item.id)}
                      className="flex-1 inline-flex items-center justify-center gap-1.5 h-9 rounded-lg bg-success-50 hover:bg-success-100 text-success-700 font-medium text-xs transition-colors"
                    >
                      <span className="material-symbols-outlined text-[16px]">check_circle</span>
                      <span>Xác nhận hoàn thành</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleOpenClientProfile(item.customerId)}
                      className="flex-1 inline-flex items-center justify-center gap-1.5 h-9 rounded-lg bg-brand-50 hover:bg-brand-100 text-brand-500 font-medium text-xs transition-colors"
                    >
                      <span className="material-symbols-outlined text-[16px]">visibility</span>
                      <span>Xem chi tiết</span>
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => onCall(item.customerPhone || '0987654321', item.customerName)}
                      className="flex-1 inline-flex items-center justify-center gap-1.5 h-9 rounded-lg bg-brand-500 hover:bg-brand-600 text-white font-medium text-xs shadow-theme-xs transition-colors"
                    >
                      <span className="material-symbols-outlined text-[16px]">call</span>
                      <span>Gọi ngay cho khách</span>
                    </button>
                    <button
                      type="button"
                      title="Hoãn lại"
                      className="px-3 h-9 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-gray-600 font-medium text-xs transition-colors"
                    >
                      <span className="material-symbols-outlined text-[18px]">alarm</span>
                    </button>
                  </>
                )}
              </div>
            </article>
          );
        })}
      </section>

      {/* Quick Add Bar */}
      <div className="pt-2 pb-6">
        <button
          type="button"
          onClick={onOpenCreateAppointment}
          className="w-full py-3 border-2 border-dashed border-gray-300 hover:border-brand-500 rounded-2xl flex items-center justify-center gap-2 text-gray-500 hover:text-brand-500 transition-colors font-medium text-xs"
        >
          <span className="material-symbols-outlined text-[18px]">add_circle</span>
          <span>Thêm nhắc việc hoặc ghi chú nhanh cho hôm nay</span>
        </button>
      </div>
    </div>
  );
};
