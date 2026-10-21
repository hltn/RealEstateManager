import React, { useState } from 'react';
import { ModuleNavTabs } from '../components/ModuleNavTabs';

interface ReportsViewProps {
  onOpenAdvancedFilter: () => void;
  onExport: () => void;
  onSelectTab: (tab: any) => void;
}

export const ReportsView: React.FC<ReportsViewProps> = ({
  onOpenAdvancedFilter,
  onExport,
  onSelectTab,
}) => {
  const [timeFilter, setTimeFilter] = useState<'Tháng này' | 'Tuần này' | 'Quý này'>('Tháng này');
  const [staffFilter, setStaffFilter] = useState<string>('Tất cả nhân viên');

  return (
    <div className="flex-1 pb-24 px-4 pt-3 max-w-md mx-auto w-full animate-in fade-in duration-200">
      {/* Title & Filter Header */}
      <div className="space-y-3 mb-4">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-headline-sm-mobile font-bold text-gray-900 tracking-tight">
              Báo cáo khách hàng
            </h1>
            <p className="text-label-xs text-gray-500 uppercase mt-0.5">
              Mục 4.4 • Quản lý khách hàng
            </p>
          </div>
          <button
            type="button"
            onClick={onExport}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-brand-50 text-brand-500 rounded-lg text-label-xs font-medium hover:bg-brand-100 active:scale-95 transition-all shadow-theme-xs border border-brand-200"
          >
            <span className="material-symbols-outlined text-[18px]">download</span>
            <span>Xuất file</span>
          </button>
        </div>

        {/* Module Nav Tabs */}
        <ModuleNavTabs currentTab="reports" onSelectTab={onSelectTab} todayCount={7} />

        {/* Filters Pill Controls */}
        <div className="flex items-center gap-2 overflow-x-auto pb-1 no-scrollbar">
          {/* Time Filter Dropdown */}
          <div className="relative inline-block">
            <select
              value={timeFilter}
              onChange={(e) => setTimeFilter(e.target.value as any)}
              className="appearance-none flex items-center gap-1.5 bg-white border border-gray-200 shadow-theme-xs rounded-lg pl-8 pr-7 py-2 text-label-xs font-medium text-gray-700 hover:bg-gray-50 outline-none cursor-pointer"
            >
              <option value="Tháng này">Tháng này</option>
              <option value="Tuần này">Tuần này</option>
              <option value="Quý này">Quý này</option>
            </select>
            <span className="material-symbols-outlined absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500 text-[16px] pointer-events-none">
              calendar_today
            </span>
            <span className="material-symbols-outlined absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 text-[16px] pointer-events-none">
              expand_more
            </span>
          </div>

          {/* Staff Filter Dropdown */}
          <div className="relative inline-block">
            <select
              value={staffFilter}
              onChange={(e) => setStaffFilter(e.target.value)}
              className="appearance-none flex items-center gap-1.5 bg-white border border-gray-200 shadow-theme-xs rounded-lg pl-8 pr-7 py-2 text-label-xs font-medium text-gray-700 hover:bg-gray-50 outline-none cursor-pointer"
            >
              <option value="Tất cả nhân viên">Tất cả nhân viên</option>
              <option value="Hạnh ★">Hạnh ★</option>
              <option value="Thảo">Thảo</option>
              <option value="Tuấn">Tuấn</option>
            </select>
            <span className="material-symbols-outlined absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500 text-[16px] pointer-events-none">
              person
            </span>
            <span className="material-symbols-outlined absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 text-[16px] pointer-events-none">
              expand_more
            </span>
          </div>

          <button
            type="button"
            onClick={onOpenAdvancedFilter}
            className="p-2 bg-white border border-gray-200 shadow-theme-xs rounded-lg text-gray-600 hover:bg-gray-50 active:scale-95 transition-all shrink-0"
          >
            <span className="material-symbols-outlined text-[18px]">tune</span>
          </button>
        </div>
      </div>

      {/* Metrics Cards 2x2 Bento Grid */}
      <section className="grid grid-cols-2 gap-3 mb-4">
        {/* Card 1 */}
        <div className="bg-white border border-gray-200 rounded-2xl p-4 shadow-theme-xs flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-label-xs text-gray-500">TỔNG KHÁCH HÀNG</span>
            <span className="w-7 h-7 rounded-full bg-brand-50 text-brand-500 flex items-center justify-center">
              <span className="material-symbols-outlined text-[16px]">group</span>
            </span>
          </div>
          <div className="mt-2">
            <div className="text-headline-sm font-bold text-gray-900 leading-tight">174</div>
            <div className="flex items-center gap-1 mt-1">
              <span className="material-symbols-outlined text-[14px] text-success-700 font-bold">
                trending_up
              </span>
              <span className="text-label-xs text-success-700 font-medium">+12%</span>
              <span className="text-label-xs text-gray-400">vs tháng trước</span>
            </div>
          </div>
        </div>

        {/* Card 2 */}
        <div className="bg-white border border-gray-200 rounded-2xl p-4 shadow-theme-xs flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-label-xs text-gray-500">ĐANG CHĂM SÓC</span>
            <span className="w-7 h-7 rounded-full bg-brand-50 text-brand-500 flex items-center justify-center">
              <span className="material-symbols-outlined text-[16px]">support_agent</span>
            </span>
          </div>
          <div className="mt-2">
            <div className="text-headline-sm font-bold text-gray-900 leading-tight">128</div>
            <div className="flex items-center gap-1 mt-1">
              <span className="px-1.5 py-0.5 rounded-full bg-brand-50 text-brand-500 text-[10px] font-medium">
                Chiếm 73.5%
              </span>
            </div>
          </div>
        </div>

        {/* Card 3 */}
        <div className="bg-white border border-gray-200 rounded-2xl p-4 shadow-theme-xs flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-label-xs text-gray-500">KHÁCH NET (CAO)</span>
            <span className="w-7 h-7 rounded-full bg-warning-50 text-warning-700 flex items-center justify-center">
              <span className="material-symbols-outlined text-[16px]">stars</span>
            </span>
          </div>
          <div className="mt-2">
            <div className="text-headline-sm font-bold text-gray-900 leading-tight">14</div>
            <div className="flex items-center gap-1 mt-1">
              <span className="text-label-xs text-warning-700 font-medium">Tỷ lệ C/V 8%</span>
            </div>
          </div>
        </div>

        {/* Card 4 */}
        <div className="bg-white border border-gray-200 rounded-2xl p-4 shadow-theme-xs flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-label-xs text-gray-500">LỊCH HẸN XONG</span>
            <span className="w-7 h-7 rounded-full bg-success-50 text-success-700 flex items-center justify-center">
              <span className="material-symbols-outlined text-[16px]">event_available</span>
            </span>
          </div>
          <div className="mt-2">
            <div className="text-headline-sm font-bold text-gray-900 leading-tight">38</div>
            <div className="flex items-center gap-1 mt-1">
              <span className="text-label-xs text-gray-600">cuộc hẹn thành công</span>
            </div>
          </div>
        </div>
      </section>

      {/* Visual Chart 1: Customer Status Distribution */}
      <section className="bg-white border border-gray-200 rounded-2xl p-5 shadow-theme-xs mb-4">
        <div className="flex items-center justify-between pb-3 border-b border-gray-100">
          <div>
            <h2 className="text-title-md font-semibold text-gray-900">Phân bổ theo tình trạng</h2>
            <p className="text-label-xs text-gray-400 mt-0.5">Tỷ trọng nhóm trạng thái hiện hành</p>
          </div>
          <span className="px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 text-label-xs font-medium">
            174 khách
          </span>
        </div>

        <div className="mt-4">
          {/* Segmented Progress Bar */}
          <div className="w-full h-3 rounded-full overflow-hidden flex bg-gray-100 p-0.5">
            <div
              className="h-full bg-brand-500 rounded-l-full transition-all duration-700"
              style={{ width: '73.5%' }}
            />
            <div
              className="h-full bg-warning-500 mx-0.5 transition-all duration-700"
              style={{ width: '8.0%' }}
            />
            <div
              className="h-full bg-error-500 rounded-r-full transition-all duration-700"
              style={{ width: '18.5%' }}
            />
          </div>

          {/* Breakdown List */}
          <div className="mt-4 space-y-3">
            <div className="flex items-center justify-between text-body-md">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-brand-500"></span>
                <span className="text-gray-700 font-medium text-xs">Đang chăm sóc</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-gray-900 text-sm">128</span>
                <span className="text-label-xs text-gray-400">(73.5%)</span>
              </div>
            </div>

            <div className="flex items-center justify-between text-body-md">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-warning-500"></span>
                <span className="text-gray-700 font-medium text-xs">Khách net (nóng)</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-gray-900 text-sm">14</span>
                <span className="text-label-xs text-gray-400">(8.0%)</span>
              </div>
            </div>

            <div className="flex items-center justify-between text-body-md">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-red-500"></span>
                <span className="text-gray-700 font-medium text-xs">Bỏ / Không nhu cầu</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-gray-900 text-sm">32</span>
                <span className="text-label-xs text-gray-400">(18.5%)</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Visual Chart 2: Customer Acquisition Sources */}
      <section className="bg-white border border-gray-200 rounded-2xl p-5 shadow-theme-xs mb-4">
        <div className="flex items-center justify-between pb-3 border-b border-gray-100">
          <div>
            <h2 className="text-title-md font-semibold text-gray-900">Nguồn khách hàng hiệu quả</h2>
            <p className="text-label-xs text-gray-400 mt-0.5">Tỷ lệ đóng góp từ các kênh tiếp thị</p>
          </div>
          <span className="material-symbols-outlined text-gray-400 text-[20px]">bar_chart</span>
        </div>

        <div className="mt-4 space-y-3.5">
          {/* Source 1 */}
          <div>
            <div className="flex justify-between items-center mb-1 text-label-xs">
              <span className="font-medium text-gray-700 flex items-center gap-1.5">
                <span className="w-2 h-2 rounded bg-brand-500"></span>
                Facebook Ads
              </span>
              <span className="font-bold text-brand-600">45%</span>
            </div>
            <div className="w-full bg-gray-100 h-2 rounded-full overflow-hidden">
              <div className="bg-brand-500 h-full rounded-full transition-all duration-700" style={{ width: '45%' }} />
            </div>
          </div>

          {/* Source 2 */}
          <div>
            <div className="flex justify-between items-center mb-1 text-label-xs">
              <span className="font-medium text-gray-700 flex items-center gap-1.5">
                <span className="w-2 h-2 rounded bg-brand-400"></span>
                Website STND
              </span>
              <span className="font-bold text-brand-500">30%</span>
            </div>
            <div className="w-full bg-gray-100 h-2 rounded-full overflow-hidden">
              <div className="bg-brand-400 h-full rounded-full transition-all duration-700" style={{ width: '30%' }} />
            </div>
          </div>

          {/* Source 3 */}
          <div>
            <div className="flex justify-between items-center mb-1 text-label-xs">
              <span className="font-medium text-gray-700 flex items-center gap-1.5">
                <span className="w-2 h-2 rounded bg-purple-600"></span>
                Giới thiệu (Referral)
              </span>
              <span className="font-bold text-purple-600">15%</span>
            </div>
            <div className="w-full bg-gray-100 h-2 rounded-full overflow-hidden">
              <div className="bg-purple-600 h-full rounded-full transition-all duration-700" style={{ width: '15%' }} />
            </div>
          </div>

          {/* Source 4 */}
          <div>
            <div className="flex justify-between items-center mb-1 text-label-xs">
              <span className="font-medium text-gray-700 flex items-center gap-1.5">
                <span className="w-2 h-2 rounded bg-gray-400"></span>
                Kênh Khác (Telesale/Offline)
              </span>
              <span className="font-bold text-gray-600">10%</span>
            </div>
            <div className="w-full bg-gray-100 h-2 rounded-full overflow-hidden">
              <div className="bg-gray-400 h-full rounded-full transition-all duration-700" style={{ width: '10%' }} />
            </div>
          </div>
        </div>
      </section>

      {/* Visual Chart 3: Agent Performance Ranking */}
      <section className="bg-white border border-gray-200 rounded-2xl p-5 shadow-theme-xs">
        <div className="flex items-center justify-between pb-3 border-b border-gray-100">
          <div>
            <h2 className="text-title-md font-semibold text-gray-900">
              Hiệu suất chăm sóc theo nhân sự
            </h2>
            <p className="text-label-xs text-gray-400 mt-0.5">
              Xếp hạng hoạt động nhân viên phụ trách
            </p>
          </div>
          <span className="px-2 py-0.5 rounded-full bg-brand-50 text-brand-500 text-label-xs font-medium">
            Top 3
          </span>
        </div>

        <div className="mt-4 space-y-3">
          {/* Rank 1: Hạnh */}
          <div className="p-3 bg-brand-25 border border-brand-100 rounded-xl flex items-center justify-between shadow-theme-xs">
            <div className="flex items-center gap-3">
              <div className="w-7 h-7 rounded-full bg-brand-500 text-white flex items-center justify-center font-bold text-label-xs">
                1
              </div>
              <div>
                <div className="flex items-center gap-1.5">
                  <span className="font-bold text-gray-900 text-sm">Hạnh</span>
                  <span className="w-1.5 h-1.5 rounded-full bg-success-500"></span>
                </div>
                <p className="text-label-xs text-gray-500">Chuyên viên tư vấn cao cấp</p>
              </div>
            </div>
            <div className="text-right">
              <div className="font-semibold text-gray-900 text-xs">48 khách</div>
              <div className="flex items-center gap-1.5 text-label-xs mt-0.5">
                <span className="text-warning-700 font-medium">6 net</span>
                <span className="text-gray-300">•</span>
                <span className="text-brand-600 font-medium">15 hẹn</span>
              </div>
            </div>
          </div>

          {/* Rank 2: Thảo */}
          <div className="p-3 bg-white border border-gray-200 rounded-xl flex items-center justify-between shadow-theme-xs">
            <div className="flex items-center gap-3">
              <div className="w-7 h-7 rounded-full bg-gray-100 text-gray-700 flex items-center justify-center font-bold text-label-xs border border-gray-200">
                2
              </div>
              <div>
                <div className="flex items-center gap-1.5">
                  <span className="font-bold text-gray-900 text-sm">Thảo</span>
                </div>
                <p className="text-label-xs text-gray-500">Chuyên viên kinh doanh</p>
              </div>
            </div>
            <div className="text-right">
              <div className="font-semibold text-gray-900 text-xs">35 khách</div>
              <div className="flex items-center gap-1.5 text-label-xs mt-0.5">
                <span className="text-warning-700 font-medium">4 net</span>
                <span className="text-gray-300">•</span>
                <span className="text-brand-600 font-medium">11 hẹn</span>
              </div>
            </div>
          </div>

          {/* Rank 3: Tuấn */}
          <div className="p-3 bg-white border border-gray-200 rounded-xl flex items-center justify-between shadow-theme-xs">
            <div className="flex items-center gap-3">
              <div className="w-7 h-7 rounded-full bg-gray-100 text-gray-700 flex items-center justify-center font-bold text-label-xs border border-gray-200">
                3
              </div>
              <div>
                <div className="flex items-center gap-1.5">
                  <span className="font-bold text-gray-900 text-sm">Tuấn</span>
                </div>
                <p className="text-label-xs text-gray-500">Tư vấn viên</p>
              </div>
            </div>
            <div className="text-right">
              <div className="font-semibold text-gray-900 text-xs">28 khách</div>
              <div className="flex items-center gap-1.5 text-label-xs mt-0.5">
                <span className="text-warning-700 font-medium">2 net</span>
                <span className="text-gray-300">•</span>
                <span className="text-brand-600 font-medium">8 hẹn</span>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};
