import React, { useState } from 'react';
import { Customer } from '../types';
import { ModuleNavTabs } from '../components/ModuleNavTabs';

interface TodayTasksViewProps {
  customers: Customer[];
  onSelectCustomer: (cust: Customer) => void;
  onOpenAddClient: () => void;
  onOpenQuickNote: (cust: Customer) => void;
  onCall: (phone: string, name: string) => void;
  onZalo: (phone: string, name: string) => void;
  onSelectTab: (tab: any) => void;
}

export const TodayTasksView: React.FC<TodayTasksViewProps> = ({
  customers,
  onSelectCustomer,
  onOpenAddClient,
  onOpenQuickNote,
  onCall,
  onZalo,
  onSelectTab,
}) => {
  const [filterType, setFilterType] = useState<'all' | 'overdue' | 'today' | 'upcoming'>('all');

  const overdueList = customers.filter(
    (c) => c.category === 'overdue' || (c.overdueText && c.overdueText.length > 0)
  );
  const todayList = customers.filter((c) => c.category === 'today' || c.nextAppointmentDate === 'Hôm nay');
  const upcomingList = customers.filter((c) => c.category === 'upcoming');

  return (
    <div className="flex-1 pb-24 px-4 pt-3 max-w-md mx-auto w-full animate-in fade-in duration-200">
      {/* 2. Page Title & Action */}
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="flex flex-col">
          <h1 className="text-headline-sm-mobile font-bold text-gray-900 tracking-tight">
            Quản lý khách hàng
          </h1>
          <p className="text-label-xs text-gray-500 mt-0.5 leading-snug">
            Theo dõi, chăm sóc khách hàng, nhắc việc, lịch hẹn
          </p>
        </div>
        <button
          type="button"
          onClick={onOpenAddClient}
          className="shrink-0 bg-brand-500 hover:bg-brand-600 active:scale-95 text-white font-medium text-xs px-3.5 py-2 rounded-lg shadow-theme-xs inline-flex items-center gap-1.5 transition-all"
        >
          <span className="material-symbols-outlined text-[16px]">add</span>
          <span>Thêm khách</span>
        </button>
      </div>

      {/* 3. Horizontal Module Nav Tabs */}
      <ModuleNavTabs currentTab="today" onSelectTab={onSelectTab} todayCount={7} />

      {/* 4. Quick Stats / Metric summary bar */}
      <section aria-label="Thống kê công việc" className="flex items-center gap-2 overflow-x-auto pb-1 mb-4 no-scrollbar">
        <button
          type="button"
          onClick={() => setFilterType(filterType === 'overdue' ? 'all' : 'overdue')}
          className={`px-3 py-1.5 rounded-full text-label-xs whitespace-nowrap flex items-center gap-1.5 transition-all active:scale-95 ${
            filterType === 'overdue'
              ? 'bg-red-500 text-white font-semibold'
              : 'bg-error-50 text-error-600 border border-error-100 font-medium'
          }`}
        >
          <span className={`w-1.5 h-1.5 rounded-full ${filterType === 'overdue' ? 'bg-white' : 'bg-error-600'}`}></span>
          <span>Quá hạn: {overdueList.length}</span>
        </button>

        <button
          type="button"
          onClick={() => setFilterType(filterType === 'today' ? 'all' : 'today')}
          className={`px-3 py-1.5 rounded-full text-label-xs whitespace-nowrap flex items-center gap-1.5 transition-all active:scale-95 ${
            filterType === 'today'
              ? 'bg-brand-500 text-white font-semibold'
              : 'bg-brand-50 text-brand-500 border border-brand-100 font-medium'
          }`}
        >
          <span className={`w-1.5 h-1.5 rounded-full ${filterType === 'today' ? 'bg-white' : 'bg-brand-500'}`}></span>
          <span>Hôm nay: {todayList.length || 5}</span>
        </button>

        <button
          type="button"
          onClick={() => setFilterType(filterType === 'upcoming' ? 'all' : 'upcoming')}
          className={`px-3 py-1.5 rounded-full text-label-xs whitespace-nowrap flex items-center gap-1.5 transition-all active:scale-95 ${
            filterType === 'upcoming'
              ? 'bg-gray-700 text-white font-semibold'
              : 'bg-gray-100 text-gray-700 font-medium'
          }`}
        >
          <span className={`w-1.5 h-1.5 rounded-full ${filterType === 'upcoming' ? 'bg-white' : 'bg-gray-400'}`}></span>
          <span>Sắp tới: {upcomingList.length || 8}</span>
        </button>
      </section>

      {/* 5. Section 1: "QUÁ HẠN" */}
      {(filterType === 'all' || filterType === 'overdue') && overdueList.length > 0 && (
        <section className="flex flex-col gap-3 mb-5">
          <div className="flex items-center justify-between">
            <h2 className="text-label-xs font-bold text-error-600 tracking-wider flex items-center gap-1.5 uppercase">
              <span className="material-symbols-outlined text-[16px]">alarm_off</span>
              QUÁ HẠN ({overdueList.length})
            </h2>
            <span className="text-[11px] text-gray-400">Cần xử lý gấp</span>
          </div>

          {overdueList.map((client) => (
            <article
              key={client.id}
              className="bg-white rounded-2xl border border-gray-200 p-4 shadow-theme-xs flex flex-col gap-3 hover:border-gray-300 transition-colors"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex flex-col">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span
                      onClick={() => onSelectCustomer(client)}
                      className="text-title-md font-semibold text-gray-900 cursor-pointer hover:text-brand-600 transition-colors"
                    >
                      {client.name}
                    </span>
                    <span
                      className={`text-label-xs px-2.5 py-0.5 rounded-full font-medium border ${
                        client.statusLabel === 'Khách net'
                          ? 'bg-warning-50 text-warning-700 border-warning-100'
                          : 'bg-success-50 text-success-700 border-success-100'
                      }`}
                    >
                      {client.statusLabel}
                    </span>
                  </div>
                  <span className="text-label-xs text-gray-500 mt-1">
                    {client.overdueText || client.notesSummary || 'Chưa cập nhật phản hồi gần đây'}
                  </span>
                </div>
                <span className="text-label-xs text-brand-500 bg-brand-50 px-2 py-0.5 rounded font-medium shrink-0">
                  {client.project}
                </span>
              </div>

              {/* AI Suggestion Box */}
              {client.aiSuggestion && (
                <div className="bg-warning-50 border border-warning-100 text-warning-700 text-label-xs p-2.5 rounded-lg flex items-start gap-2">
                  <span
                    className="material-symbols-outlined text-warning-700 text-[18px] shrink-0 mt-0.5"
                    style={{ fontVariationSettings: "'FILL' 1" }}
                  >
                    lightbulb
                  </span>
                  <span>
                    <strong>Gợi ý:</strong> {client.aiSuggestion}
                  </span>
                </div>
              )}

              {/* Action Buttons (2x2 grid) */}
              <div className="grid grid-cols-2 gap-2 pt-1 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => onCall(client.phone, client.name)}
                  className="bg-brand-500 hover:bg-brand-600 active:scale-95 text-white font-medium text-xs px-3 py-2 rounded-lg shadow-theme-xs flex items-center justify-center gap-1 transition-all"
                >
                  <span className="material-symbols-outlined text-[16px]">call</span>
                  <span>Gọi</span>
                </button>
                <button
                  type="button"
                  onClick={() => onZalo(client.phone, client.name)}
                  className="bg-emerald-500 hover:bg-emerald-600 active:scale-95 text-white font-medium text-xs px-3 py-2 rounded-lg shadow-theme-xs flex items-center justify-center gap-1 transition-all"
                >
                  <span className="material-symbols-outlined text-[16px]">chat</span>
                  <span>Zalo</span>
                </button>
                <button
                  type="button"
                  onClick={() => onOpenQuickNote(client)}
                  className="bg-gray-100 hover:bg-gray-200 active:scale-95 text-gray-700 font-medium text-xs px-3 py-2 rounded-lg flex items-center justify-center gap-1 transition-all"
                >
                  <span className="material-symbols-outlined text-[16px]">edit_note</span>
                  <span>Ghi chú</span>
                </button>
                <button
                  type="button"
                  onClick={() => onSelectCustomer(client)}
                  className="border border-gray-200 bg-white hover:bg-gray-50 active:scale-95 text-gray-700 font-medium text-xs px-3 py-2 rounded-lg shadow-theme-xs flex items-center justify-center gap-1 transition-all"
                >
                  <span className="material-symbols-outlined text-[16px]">visibility</span>
                  <span>Xem</span>
                </button>
              </div>
            </article>
          ))}
        </section>
      )}

      {/* 6. Section 2: "HÔM NAY" */}
      {(filterType === 'all' || filterType === 'today') && (
        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="text-label-xs font-bold text-gray-500 tracking-wider flex items-center gap-1.5 uppercase">
              <span className="material-symbols-outlined text-[16px]">today</span>
              HÔM NAY ({todayList.length || 5})
            </h2>
            <span className="text-[11px] text-brand-500 font-medium">Còn 3 lịch</span>
          </div>

          {todayList.map((client) => (
            <article
              key={client.id}
              className="bg-white rounded-2xl border border-gray-200 p-4 shadow-theme-xs flex flex-col gap-3 hover:border-gray-300 transition-colors"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex flex-col">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span
                      onClick={() => onSelectCustomer(client)}
                      className="text-title-md font-semibold text-gray-900 cursor-pointer hover:text-brand-600 transition-colors"
                    >
                      {client.name}
                    </span>
                    <span
                      className={`text-label-xs px-2.5 py-0.5 rounded-full font-medium border ${
                        client.statusLabel === 'Khách net'
                          ? 'bg-warning-50 text-warning-700 border-warning-100'
                          : 'bg-success-50 text-success-700 border-success-100'
                      }`}
                    >
                      {client.statusLabel}
                    </span>
                  </div>
                  <span className="text-label-xs text-gray-500 mt-1">
                    {client.notesSummary || `Lịch hẹn xem dự án hôm nay với ${client.assignedLead}`}
                  </span>
                </div>
                <span className="text-label-xs text-brand-500 bg-brand-50 px-2 py-0.5 rounded font-medium shrink-0">
                  {client.project}
                </span>
              </div>

              {client.aiSuggestion && (
                <div className="bg-warning-50 border border-warning-100 text-warning-700 text-label-xs p-2.5 rounded-lg flex items-start gap-2">
                  <span
                    className="material-symbols-outlined text-warning-700 text-[18px] shrink-0 mt-0.5"
                    style={{ fontVariationSettings: "'FILL' 1" }}
                  >
                    lightbulb
                  </span>
                  <span>
                    <strong>Gợi ý:</strong> {client.aiSuggestion}
                  </span>
                </div>
              )}

              <div className="grid grid-cols-2 gap-2 pt-1 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => onCall(client.phone, client.name)}
                  className="bg-brand-500 hover:bg-brand-600 active:scale-95 text-white font-medium text-xs px-3 py-2 rounded-lg shadow-theme-xs flex items-center justify-center gap-1 transition-all"
                >
                  <span className="material-symbols-outlined text-[16px]">call</span>
                  <span>Gọi</span>
                </button>
                <button
                  type="button"
                  onClick={() => onZalo(client.phone, client.name)}
                  className="bg-emerald-500 hover:bg-emerald-600 active:scale-95 text-white font-medium text-xs px-3 py-2 rounded-lg shadow-theme-xs flex items-center justify-center gap-1 transition-all"
                >
                  <span className="material-symbols-outlined text-[16px]">chat</span>
                  <span>Zalo</span>
                </button>
                <button
                  type="button"
                  onClick={() => onOpenQuickNote(client)}
                  className="bg-gray-100 hover:bg-gray-200 active:scale-95 text-gray-700 font-medium text-xs px-3 py-2 rounded-lg flex items-center justify-center gap-1 transition-all"
                >
                  <span className="material-symbols-outlined text-[16px]">edit_note</span>
                  <span>Ghi chú</span>
                </button>
                <button
                  type="button"
                  onClick={() => onSelectCustomer(client)}
                  className="border border-gray-200 bg-white hover:bg-gray-50 active:scale-95 text-gray-700 font-medium text-xs px-3 py-2 rounded-lg shadow-theme-xs flex items-center justify-center gap-1 transition-all"
                >
                  <span className="material-symbols-outlined text-[16px]">visibility</span>
                  <span>Xem</span>
                </button>
              </div>
            </article>
          ))}
        </section>
      )}
    </div>
  );
};
