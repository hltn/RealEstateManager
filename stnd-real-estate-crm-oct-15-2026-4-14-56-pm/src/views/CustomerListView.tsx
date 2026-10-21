import React, { useState, useMemo } from 'react';
import { Customer, FilterOptions } from '../types';
import { ModuleNavTabs } from '../components/ModuleNavTabs';

interface CustomerListViewProps {
  customers: Customer[];
  onSelectCustomer: (cust: Customer) => void;
  onOpenAddClient: () => void;
  onOpenAdvancedFilter: () => void;
  onOpenQuickNote: (cust: Customer) => void;
  onCall: (phone: string, name: string) => void;
  onZalo: (phone: string, name: string) => void;
  onSelectTab: (tab: any) => void;
  filters: FilterOptions;
  onUpdateSearch: (search: string) => void;
}

export const CustomerListView: React.FC<CustomerListViewProps> = ({
  customers,
  onSelectCustomer,
  onOpenAddClient,
  onOpenAdvancedFilter,
  onOpenQuickNote,
  onCall,
  onZalo,
  onSelectTab,
  filters,
  onUpdateSearch,
}) => {
  const [activeStatusPill, setActiveStatusPill] = useState<'all' | 'caring' | 'hot' | 'dropped'>('caring');
  const [selectedSort, setSelectedSort] = useState<'newest' | 'name' | 'progress'>('newest');
  const [currentPage, setCurrentPage] = useState<number>(1);

  // Filtered customer list
  const filteredCustomers = useMemo(() => {
    return customers.filter((cust) => {
      // Status pill filter
      if (activeStatusPill === 'caring' && cust.status !== 'caring') return false;
      if (activeStatusPill === 'hot' && cust.status !== 'hot') return false;
      if (activeStatusPill === 'dropped' && cust.status !== 'dropped') return false;

      // Search keyword filter
      if (filters.search) {
        const q = filters.search.toLowerCase();
        const matchName = cust.name.toLowerCase().includes(q);
        const matchPhone = cust.phone.includes(q);
        const matchProject = cust.project.toLowerCase().includes(q);
        if (!matchName && !matchPhone && !matchProject) return false;
      }

      // Advanced selected projects filter
      if (filters.projectsSelected.length > 0) {
        if (!filters.projectsSelected.includes(cust.project)) return false;
      }

      // Staff filter
      if (filters.staff && filters.staff !== 'all') {
        if (!cust.assignedLead.includes(filters.staff.replace(' (Trưởng nhóm kinh doanh 1)', '').trim())) {
          return false;
        }
      }

      return true;
    });
  }, [customers, activeStatusPill, filters]);

  const caringCount = customers.filter((c) => c.status === 'caring').length || 128;
  const hotCount = customers.filter((c) => c.status === 'hot').length || 14;
  const droppedCount = customers.filter((c) => c.status === 'dropped').length || 32;

  return (
    <div className="flex-1 pb-24 px-4 pt-3 max-w-md mx-auto w-full animate-in fade-in duration-200">
      {/* PAGE TITLE & PRIMARY ACTION */}
      <div className="flex items-center justify-between mb-3">
        <h1 className="text-headline-sm-mobile font-bold text-gray-900">
          Quản lý khách hàng
        </h1>
        <button
          type="button"
          onClick={onOpenAddClient}
          className="flex items-center gap-1.5 h-9 px-3.5 bg-brand-500 text-white font-medium text-xs rounded-lg shadow-theme-xs hover:bg-brand-600 active:scale-95 transition-transform duration-150"
        >
          <span className="material-symbols-outlined text-[18px]">add</span>
          <span>Thêm khách</span>
        </button>
      </div>

      {/* INTERNAL HORIZONTAL MODULE NAV TABS */}
      <ModuleNavTabs currentTab="customers" onSelectTab={onSelectTab} todayCount={7} />

      {/* SUB STATUS PILL TABS */}
      <div className="flex items-center gap-2 mb-3.5 overflow-x-auto no-scrollbar">
        <button
          type="button"
          onClick={() => setActiveStatusPill('caring')}
          className={`whitespace-nowrap px-3.5 py-1.5 rounded-full text-label-xs transition-all active:scale-95 ${
            activeStatusPill === 'caring'
              ? 'bg-brand-50 text-brand-500 font-semibold shadow-theme-xs'
              : 'bg-white text-gray-600 hover:bg-gray-100 border border-gray-200'
          }`}
        >
          Đang chăm sóc ({caringCount})
        </button>
        <button
          type="button"
          onClick={() => setActiveStatusPill('hot')}
          className={`whitespace-nowrap px-3.5 py-1.5 rounded-full text-label-xs transition-all active:scale-95 ${
            activeStatusPill === 'hot'
              ? 'bg-warning-50 text-warning-700 font-semibold border border-warning-100 shadow-theme-xs'
              : 'bg-white text-gray-600 hover:bg-gray-100 border border-gray-200'
          }`}
        >
          Khách net ({hotCount})
        </button>
        <button
          type="button"
          onClick={() => setActiveStatusPill('dropped')}
          className={`whitespace-nowrap px-3.5 py-1.5 rounded-full text-label-xs transition-all active:scale-95 ${
            activeStatusPill === 'dropped'
              ? 'bg-gray-200 text-gray-900 font-semibold shadow-theme-xs'
              : 'bg-white text-gray-600 hover:bg-gray-100 border border-gray-200'
          }`}
        >
          Bỏ ({droppedCount})
        </button>
      </div>

      {/* TOOLBAR & FILTER SECTION */}
      <section className="bg-white border border-gray-200 rounded-2xl p-2.5 shadow-theme-xs mb-3.5 space-y-2">
        {/* Row 2: Search Input */}
        <div className="relative">
          <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-[20px]">
            search
          </span>
          <input
            type="text"
            value={filters.search}
            onChange={(e) => onUpdateSearch(e.target.value)}
            placeholder="Tìm trong trang này..."
            className="w-full h-[40px] pl-10 pr-3 bg-white border border-gray-200 rounded-lg text-body-md text-gray-900 placeholder-gray-400 focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
          />
          {filters.search && (
            <button
              type="button"
              onClick={() => onUpdateSearch('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            >
              <span className="material-symbols-outlined text-[16px]">cancel</span>
            </button>
          )}
        </div>

        {/* Row 3: Horizontal Scrollable Quick Filters */}
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pt-0.5">
          <button
            type="button"
            onClick={() => setSelectedSort(selectedSort === 'newest' ? 'progress' : 'newest')}
            className="whitespace-nowrap flex items-center gap-1 h-[34px] px-2.5 bg-gray-50 border border-gray-200 rounded-lg text-label-xs text-gray-700 hover:bg-gray-100 transition-colors"
          >
            <span>{selectedSort === 'newest' ? 'Cập nhật mới nhất' : 'Theo tiến độ'}</span>
            <span className="material-symbols-outlined text-[16px]">expand_more</span>
          </button>

          <button
            type="button"
            onClick={onOpenAdvancedFilter}
            className="whitespace-nowrap flex items-center gap-1 h-[34px] px-2.5 bg-gray-50 border border-gray-200 rounded-lg text-label-xs text-gray-700 hover:bg-gray-100 transition-colors"
          >
            <span>Dự án</span>
            <span className="material-symbols-outlined text-[16px]">expand_more</span>
          </button>

          <button
            type="button"
            onClick={onOpenAdvancedFilter}
            className="whitespace-nowrap flex items-center gap-1 h-[34px] px-2.5 bg-gray-50 border border-gray-200 rounded-lg text-label-xs text-gray-700 hover:bg-gray-100 transition-colors"
          >
            <span>Phụ trách</span>
            <span className="material-symbols-outlined text-[16px]">expand_more</span>
          </button>

          <button
            type="button"
            onClick={onOpenAdvancedFilter}
            className="whitespace-nowrap flex items-center gap-1 h-[34px] px-2.5 bg-brand-50 border border-brand-200 rounded-lg text-label-xs text-brand-600 hover:bg-brand-100 transition-colors font-medium ml-auto"
          >
            <span className="material-symbols-outlined text-[15px]">tune</span>
            <span>Bộ lọc nâng cao</span>
          </button>
        </div>
      </section>

      {/* RESULT COUNTER */}
      <div className="flex items-center justify-between px-1 mb-2.5">
        <span className="text-label-xs text-gray-500">
          Hiển thị 1–{filteredCustomers.length} / 128 khách · Trang 1/7
        </span>
        <div
          onClick={onOpenAdvancedFilter}
          className="flex items-center gap-1 text-label-xs text-gray-500 cursor-pointer hover:text-brand-600"
        >
          <span className="material-symbols-outlined text-[14px]">tune</span>
          <span>{filters.projectsSelected.length > 0 ? `Đã lọc (${filters.projectsSelected.length})` : 'Đã lọc'}</span>
        </div>
      </div>

      {/* CUSTOMER CARDS LIST */}
      <div className="space-y-3">
        {filteredCustomers.map((cust) => {
          const maskedPhone = cust.phone.replace(/(\d{4})\d{3}(\d{3})/, '$1 *** $2');

          return (
            <article
              key={cust.id}
              className="bg-white border border-gray-200 rounded-2xl shadow-theme-xs p-4 transition-all hover:border-brand-200"
            >
              {/* Header row: Code, Name, Phone & Status Chip */}
              <div className="flex items-start justify-between gap-2 mb-2.5">
                <div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-label-xs text-gray-400 font-mono">{cust.code}</span>
                    <h3
                      onClick={() => onSelectCustomer(cust)}
                      className="text-body-lg-bold text-gray-900 cursor-pointer hover:text-brand-600 transition-colors"
                    >
                      {cust.name}
                    </h3>
                  </div>
                  <p className="text-body-md text-gray-500 font-mono text-xs">{maskedPhone}</p>
                </div>

                <span
                  className={`inline-flex items-center h-6 px-2.5 rounded-full text-label-xs font-medium ${
                    cust.statusLabel === 'Khách net'
                      ? 'bg-warning-50 text-warning-700'
                      : 'bg-success-50 text-success-700'
                  }`}
                >
                  {cust.statusLabel}
                </span>
              </div>

              {/* Meta Details: Dự án, Tiến độ 4 bước, Phụ trách, Lịch hẹn */}
              <div className="grid grid-cols-2 gap-y-2 py-2.5 my-2.5 border-y border-gray-100 text-body-md">
                {/* Dự án */}
                <div className="flex items-center gap-1.5">
                  <span className="text-gray-400 text-label-xs">Dự án:</span>
                  <span
                    className={`inline-flex items-center px-2 py-0.5 rounded-full text-label-xs font-medium ${
                      cust.project === 'The Privia'
                        ? 'bg-purple-100 text-purple-800'
                        : 'bg-brand-50 text-brand-500'
                    }`}
                  >
                    {cust.project}
                  </span>
                </div>

                {/* Tiến độ 4 bước */}
                <div className="flex items-center justify-end gap-1.5">
                  <span className="text-gray-400 text-label-xs">Tiến độ:</span>
                  <div className="flex items-center gap-1" title={`Tiến độ: ${cust.progressPercent}%`}>
                    {[1, 2, 3, 4].map((step) => {
                      const isFilled = step <= cust.progressStep;
                      return (
                        <span
                          key={step}
                          className={`w-2.5 h-2.5 rounded-full ${
                            isFilled
                              ? cust.statusLabel === 'Khách net'
                                ? 'bg-warning-500'
                                : 'bg-brand-500'
                              : 'bg-gray-200'
                          }`}
                        />
                      );
                    })}
                  </div>
                  <span className="text-label-xs font-medium text-gray-700">
                    {cust.progressPercent}%
                  </span>
                </div>

                {/* Phụ trách */}
                <div className="flex items-center gap-1.5">
                  <span className="text-gray-400 text-label-xs">Phụ trách:</span>
                  <div className="flex items-center gap-1 text-gray-800 font-medium text-label-xs">
                    <span className="text-brand-500 font-semibold">{cust.assignedLead}</span>
                    {cust.assignedMembers.length > 0 && (
                      <span>, {cust.assignedMembers.join(', ')}</span>
                    )}
                  </div>
                </div>

                {/* Lịch hẹn */}
                <div className="flex items-center justify-end gap-1 text-gray-700 text-label-xs">
                  <span className="material-symbols-outlined text-brand-500 text-[16px]">
                    calendar_month
                  </span>
                  <span className="font-medium">{cust.nextAppointmentDate}</span>
                </div>
              </div>

              {/* 2x2 Operational Action Buttons */}
              <div className="grid grid-cols-2 gap-2 mt-3">
                {/* Row 1: Quick Connect */}
                <button
                  type="button"
                  onClick={() => onCall(cust.phone, cust.name)}
                  className="h-9 flex items-center justify-center gap-1.5 rounded-lg bg-brand-500 text-white font-medium text-xs hover:bg-brand-600 active:scale-95 transition-transform duration-150 shadow-theme-xs"
                >
                  <span className="material-symbols-outlined text-[18px]">call</span>
                  <span>Gọi</span>
                </button>
                <button
                  type="button"
                  onClick={() => onZalo(cust.phone, cust.name)}
                  className="h-9 flex items-center justify-center gap-1.5 rounded-lg bg-emerald-500 text-white font-medium text-xs hover:bg-emerald-600 active:scale-95 transition-transform duration-150 shadow-theme-xs"
                >
                  <span className="material-symbols-outlined text-[18px]">chat</span>
                  <span>Zalo</span>
                </button>

                {/* Row 2: Management Tools */}
                <button
                  type="button"
                  onClick={() => onOpenQuickNote(cust)}
                  className="h-9 flex items-center justify-center gap-1.5 rounded-lg bg-gray-100 text-gray-700 border border-gray-200 font-medium text-xs hover:bg-gray-200 active:scale-95 transition-transform duration-150"
                >
                  <span className="material-symbols-outlined text-[18px] text-gray-500">edit_note</span>
                  <span>Ghi chú</span>
                </button>
                <button
                  type="button"
                  onClick={() => onSelectCustomer(cust)}
                  className="h-9 flex items-center justify-center gap-1.5 rounded-lg bg-gray-100 text-gray-700 border border-gray-200 font-medium text-xs hover:bg-gray-200 active:scale-95 transition-transform duration-150"
                >
                  <span className="material-symbols-outlined text-[18px] text-gray-500">visibility</span>
                  <span>Xem</span>
                </button>
              </div>
            </article>
          );
        })}
      </div>

      {/* PAGINATION CONTROLS */}
      <div className="flex items-center justify-center gap-1.5 mt-6 mb-2">
        <button
          type="button"
          onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
          className="w-9 h-9 flex items-center justify-center rounded-lg bg-white border border-gray-200 text-gray-600 hover:bg-gray-100 shadow-theme-xs active:scale-95 transition-all"
        >
          <span className="material-symbols-outlined text-[18px]">chevron_left</span>
        </button>

        {[1, 2, 3].map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => setCurrentPage(p)}
            className={`w-9 h-9 flex items-center justify-center rounded-lg text-xs transition-all active:scale-95 ${
              currentPage === p
                ? 'bg-brand-500 text-white font-medium shadow-theme-xs'
                : 'bg-white border border-gray-200 text-gray-700 hover:bg-gray-100 shadow-theme-xs'
            }`}
          >
            {p}
          </button>
        ))}

        <span className="w-7 text-center text-gray-400 text-xs">...</span>

        <button
          type="button"
          onClick={() => setCurrentPage(7)}
          className={`w-9 h-9 flex items-center justify-center rounded-lg text-xs transition-all active:scale-95 ${
            currentPage === 7
              ? 'bg-brand-500 text-white font-medium shadow-theme-xs'
              : 'bg-white border border-gray-200 text-gray-700 hover:bg-gray-100 shadow-theme-xs'
          }`}
        >
          7
        </button>

        <button
          type="button"
          onClick={() => setCurrentPage(Math.min(7, currentPage + 1))}
          className="w-9 h-9 flex items-center justify-center rounded-lg bg-white border border-gray-200 text-gray-600 hover:bg-gray-100 shadow-theme-xs active:scale-95 transition-all"
        >
          <span className="material-symbols-outlined text-[18px]">chevron_right</span>
        </button>
      </div>
    </div>
  );
};
