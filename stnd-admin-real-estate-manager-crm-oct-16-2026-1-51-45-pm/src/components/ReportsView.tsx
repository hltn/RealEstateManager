import React, { useState } from 'react';
import { StaffPerformance } from '../types/crm';
import { INITIAL_STAFF_PERFORMANCE } from '../data/mockData';

interface ReportsViewProps {
  onNavigate: (view: string) => void;
}

export const ReportsView: React.FC<ReportsViewProps> = ({ onNavigate }) => {
  const [timeFilter, setTimeFilter] = useState<'week' | 'month' | 'quarter' | 'year'>('month');
  const [staffList] = useState<StaffPerformance[]>(INITIAL_STAFF_PERFORMANCE);

  return (
    <div className="space-y-6">
      {/* 1. Header Toolbar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Báo cáo khách hàng</h1>
            <span className="bg-brand-50 text-brand-600 font-semibold px-2.5 py-0.5 rounded-full text-xs border border-brand-100">
              Live CRM
            </span>
          </div>
          <p className="text-sm text-gray-500 mt-1">
            MỤC 4.4 • QUẢN LÝ KHÁCH HÀNG — Thống kê, phân tích dữ liệu tương tác và hiệu suất chăm sóc khách hàng
          </p>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <button
            onClick={() => alert('Đang xuất tệp Excel báo cáo CRM tháng 10/2026...')}
            className="h-10 px-4 bg-white border border-gray-200 hover:bg-gray-50 text-gray-700 font-medium text-sm rounded-lg flex items-center gap-2 shadow-theme-xs transition-colors"
          >
            <span className="material-symbols-outlined text-[18px]">download</span>
            <span>Xuất Excel / Báo cáo</span>
          </button>
          <button
            onClick={() => onNavigate('create_customer')}
            className="h-10 px-4 bg-brand-500 hover:bg-brand-600 active:scale-95 text-white font-medium text-sm rounded-lg flex items-center gap-2 shadow-theme-xs transition-colors cursor-pointer"
          >
            <span className="material-symbols-outlined text-[18px]">person_add</span>
            <span>Thêm khách</span>
          </button>
        </div>
      </div>

      {/* 2. Sub-Tabs Header Navigation */}
      <div className="border-b border-gray-200 flex items-center gap-8">
        <button
          onClick={() => onNavigate('today')}
          className="pb-3 text-sm text-gray-500 hover:text-gray-900 flex items-center gap-2 transition-colors border-b-2 border-transparent"
        >
          <span>Việc hôm nay</span>
          <span className="px-2 py-0.5 text-[11px] rounded-full bg-gray-100 text-gray-600 font-medium">
            7
          </span>
        </button>

        <button
          onClick={() => onNavigate('customers')}
          className="pb-3 text-sm text-gray-500 hover:text-gray-900 flex items-center gap-2 transition-colors border-b-2 border-transparent"
        >
          <span>Khách hàng</span>
          <span className="px-2 py-0.5 text-[11px] rounded-full bg-gray-100 text-gray-600 font-medium">
            128
          </span>
        </button>

        <button
          onClick={() => onNavigate('calendar')}
          className="pb-3 text-sm text-gray-500 hover:text-gray-900 flex items-center gap-2 transition-colors border-b-2 border-transparent"
        >
          <span>Lịch hẹn</span>
          <span className="px-2 py-0.5 text-[11px] rounded-full bg-gray-100 text-gray-600 font-medium">
            12
          </span>
        </button>

        <button
          onClick={() => onNavigate('reports')}
          className="pb-3 text-sm font-semibold text-brand-600 border-b-2 border-brand-500 flex items-center gap-2"
        >
          <span>Báo cáo</span>
          <span className="px-2 py-0.5 text-[11px] rounded-full bg-brand-50 text-brand-600 font-bold">
            Thống kê
          </span>
        </button>
      </div>

      {/* 3. Filter Bar (Time, Project, Staff) */}
      <div className="bg-surface-container-lowest border border-gray-200 rounded-xl p-4 shadow-theme-xs flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative">
            <button
              onClick={() => alert('Chọn khoảng thời gian')}
              className="h-9 px-3 bg-white border border-gray-200 hover:border-gray-300 rounded-lg flex items-center gap-2 text-xs text-gray-700 shadow-theme-xs"
            >
              <span className="material-symbols-outlined text-[18px] text-gray-500">
                calendar_month
              </span>
              <span className="text-gray-500 font-medium">Thời gian:</span>
              <span className="font-semibold text-gray-900">Tháng này (10/2026)</span>
              <span className="material-symbols-outlined text-[18px] text-gray-400">expand_more</span>
            </button>
          </div>

          <div className="relative">
            <button
              onClick={() => alert('Chọn dự án')}
              className="h-9 px-3 bg-white border border-gray-200 hover:border-gray-300 rounded-lg flex items-center gap-2 text-xs text-gray-700 shadow-theme-xs"
            >
              <span className="material-symbols-outlined text-[18px] text-gray-500">apartment</span>
              <span className="text-gray-500 font-medium">Dự án:</span>
              <span className="font-semibold text-gray-900">Tất cả dự án</span>
              <span className="material-symbols-outlined text-[18px] text-gray-400">expand_more</span>
            </button>
          </div>

          <div className="relative">
            <button
              onClick={() => alert('Chọn nhân viên')}
              className="h-9 px-3 bg-white border border-gray-200 hover:border-gray-300 rounded-lg flex items-center gap-2 text-xs text-gray-700 shadow-theme-xs"
            >
              <span className="material-symbols-outlined text-[18px] text-gray-500">
                person_outline
              </span>
              <span className="text-gray-500 font-medium">Nhân viên phụ trách:</span>
              <span className="font-semibold text-gray-900">Tất cả nhân viên</span>
              <span className="material-symbols-outlined text-[18px] text-gray-400">expand_more</span>
            </button>
          </div>
        </div>

        {/* Time Segmented Buttons */}
        <div className="inline-flex p-1 bg-gray-100 rounded-lg border border-gray-200 text-xs">
          {(['week', 'month', 'quarter', 'year'] as const).map((mode) => {
            const labels = { week: 'Tuần', month: 'Tháng', quarter: 'Quý', year: 'Năm' };
            const isActive = timeFilter === mode;
            return (
              <button
                key={mode}
                onClick={() => setTimeFilter(mode)}
                className={`px-3 py-1 rounded-md font-semibold transition-all ${
                  isActive
                    ? 'bg-white text-brand-600 shadow-theme-xs'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                {labels[mode]}
              </button>
            );
          })}
        </div>
      </div>

      {/* 4. KPI Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        {/* KPI 1 */}
        <div className="bg-surface-container-lowest border border-gray-200 rounded-2xl p-6 shadow-theme-xs flex flex-col justify-between hover:border-brand-200 transition-all">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">
              Tổng khách hàng
            </span>
            <div className="w-10 h-10 rounded-xl bg-brand-50 text-brand-500 flex items-center justify-center">
              <span className="material-symbols-outlined text-[22px]">group</span>
            </div>
          </div>
          <div className="mt-4">
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-bold text-gray-900 leading-none">174</span>
              <span className="text-xs font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full flex items-center gap-0.5">
                <span className="material-symbols-outlined text-[14px]">arrow_upward</span>
                +12%
              </span>
            </div>
            <p className="text-xs text-gray-400 mt-2">So với 155 khách tháng trước</p>
          </div>
        </div>

        {/* KPI 2 */}
        <div className="bg-surface-container-lowest border border-gray-200 rounded-2xl p-6 shadow-theme-xs flex flex-col justify-between hover:border-brand-200 transition-all">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">
              Đang chăm sóc
            </span>
            <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
              <span className="material-symbols-outlined text-[22px]">support_agent</span>
            </div>
          </div>
          <div className="mt-4">
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-bold text-brand-600 leading-none">128</span>
              <span className="text-xs font-bold text-brand-600 bg-brand-50 px-2 py-0.5 rounded-full">
                73.5%
              </span>
            </div>
            <p className="text-xs text-gray-400 mt-2">Khách có tương tác trong 7 ngày</p>
          </div>
        </div>

        {/* KPI 3 */}
        <div className="bg-surface-container-lowest border border-gray-200 rounded-2xl p-6 shadow-theme-xs flex flex-col justify-between hover:border-amber-200 transition-all">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">
              Khách Net (Cao)
            </span>
            <div className="w-10 h-10 rounded-xl bg-amber-50 text-amber-500 flex items-center justify-center">
              <span className="material-symbols-outlined text-[22px]">star</span>
            </div>
          </div>
          <div className="mt-4">
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-bold text-amber-700 leading-none">14</span>
              <span className="text-xs font-bold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full">
                C/V 8.0%
              </span>
            </div>
            <p className="text-xs text-gray-400 mt-2">Nhu cầu mua ngay &amp; tài chính sẵn</p>
          </div>
        </div>

        {/* KPI 4 */}
        <div className="bg-surface-container-lowest border border-gray-200 rounded-2xl p-6 shadow-theme-xs flex flex-col justify-between hover:border-emerald-200 transition-all">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">
              Lịch hẹn xong
            </span>
            <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-700 flex items-center justify-center">
              <span className="material-symbols-outlined text-[22px]">event_available</span>
            </div>
          </div>
          <div className="mt-4">
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-bold text-emerald-700 leading-none">38</span>
              <span className="text-xs font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full flex items-center gap-0.5">
                <span className="material-symbols-outlined text-[14px]">trending_up</span>
                86% tỷ lệ đến
              </span>
            </div>
            <p className="text-xs text-gray-400 mt-2">Dẫn khách xem dự án thực tế</p>
          </div>
        </div>
      </div>

      {/* 5. Deep Analytics 2-Column Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Column 1: Phân bổ theo tình trạng with Donut */}
        <div className="bg-surface-container-lowest border border-gray-200 rounded-2xl p-6 shadow-theme-xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between pb-4 border-b border-gray-100">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-brand-500 text-[20px]">
                  donut_large
                </span>
                <h2 className="text-base text-gray-900 font-bold">Phân bổ theo tình trạng</h2>
              </div>
              <span className="text-xs text-gray-400 font-semibold">Tổng 174 khách</span>
            </div>

            {/* Overall progress multi-bar */}
            <div className="mt-6">
              <div className="flex justify-between text-xs text-gray-500 mb-2">
                <span>Tỷ lệ tiến độ phễu khách hàng</span>
                <span className="font-semibold text-gray-800">100% dữ liệu đồng bộ</span>
              </div>
              <div className="w-full h-3 bg-gray-100 rounded-full overflow-hidden flex">
                <div className="bg-brand-500 h-full" style={{ width: '73.5%' }} title="Đang chăm sóc: 73.5%"></div>
                <div className="bg-amber-500 h-full" style={{ width: '8.0%' }} title="Khách net: 8.0%"></div>
                <div className="bg-rose-500 h-full" style={{ width: '18.5%' }} title="Bỏ / Không nhu cầu: 18.5%"></div>
              </div>
            </div>

            {/* SVG Donut & Status Breakdowns */}
            <div className="mt-8 flex flex-col sm:flex-row items-center gap-6 justify-between">
              {/* Donut Chart */}
              <div className="relative w-40 h-40 shrink-0 flex items-center justify-center">
                <svg className="w-full h-full transform -rotate-90" viewBox="0 0 120 120">
                  <circle cx="60" cy="60" fill="transparent" r="50" stroke="#F2F4F7" strokeWidth="14" />
                  {/* Segment 1: Đang chăm sóc (73.5%) -> 231 / 314 */}
                  <circle
                    cx="60"
                    cy="60"
                    fill="transparent"
                    r="50"
                    stroke="#465FFF"
                    strokeWidth="14"
                    strokeDasharray="231 314"
                    strokeDashoffset="0"
                  />
                  {/* Segment 2: Khách Net (8.0%) -> 25 / 314 */}
                  <circle
                    cx="60"
                    cy="60"
                    fill="transparent"
                    r="50"
                    stroke="#F79009"
                    strokeWidth="14"
                    strokeDasharray="25 314"
                    strokeDashoffset="-231"
                  />
                  {/* Segment 3: Bỏ (18.5%) -> 58 / 314 */}
                  <circle
                    cx="60"
                    cy="60"
                    fill="transparent"
                    r="50"
                    stroke="#F04438"
                    strokeWidth="14"
                    strokeDasharray="58 314"
                    strokeDashoffset="-256"
                  />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-2xl font-bold text-gray-900 leading-tight">174</span>
                  <span className="text-[11px] text-gray-400 uppercase font-bold tracking-wider">
                    Hồ sơ
                  </span>
                </div>
              </div>

              {/* Status List */}
              <div className="flex-1 w-full space-y-3">
                <div className="p-3 bg-brand-50/40 rounded-xl border border-brand-100 flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <span className="w-3 h-3 rounded-full bg-brand-500"></span>
                    <span className="text-sm font-semibold text-gray-900">Đang chăm sóc</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-bold text-gray-900">128 khách</span>
                    <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-brand-100 text-brand-700">
                      73.5%
                    </span>
                  </div>
                </div>

                <div className="p-3 bg-amber-50/50 rounded-xl border border-amber-100 flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <span className="w-3 h-3 rounded-full bg-amber-500"></span>
                    <span className="text-sm font-semibold text-gray-900">Khách net (nóng)</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-bold text-gray-900">14 khách</span>
                    <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-amber-100 text-amber-700">
                      8.0%
                    </span>
                  </div>
                </div>

                <div className="p-3 bg-rose-50/50 rounded-xl border border-rose-100 flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <span className="w-3 h-3 rounded-full bg-rose-500"></span>
                    <span className="text-sm font-semibold text-gray-900">Bỏ / Không nhu cầu</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-bold text-gray-900">32 khách</span>
                    <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-rose-100 text-rose-600">
                      18.5%
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-6 pt-4 border-t border-gray-100 flex items-center justify-between text-xs text-gray-400">
            <span>Cập nhật lúc: 10:45 Hôm nay</span>
            <button
              onClick={() => onNavigate('customers')}
              className="text-brand-600 hover:underline font-semibold"
            >
              Chi tiết phân khúc ➔
            </button>
          </div>
        </div>

        {/* Column 2: Nguồn khách hàng hiệu quả */}
        <div className="bg-surface-container-lowest border border-gray-200 rounded-2xl p-6 shadow-theme-xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between pb-4 border-b border-gray-100">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-brand-500 text-[20px]">
                  campaign
                </span>
                <h2 className="text-base text-gray-900 font-bold">Nguồn khách hàng hiệu quả</h2>
              </div>
              <span className="text-xs text-gray-400 font-semibold">4 kênh chủ lực</span>
            </div>

            <div className="mt-6 space-y-5">
              {/* Facebook Ads */}
              <div>
                <div className="flex justify-between items-center mb-1.5 text-sm">
                  <div className="flex items-center gap-2 text-gray-900 font-semibold">
                    <span className="material-symbols-outlined text-[18px] text-brand-500">
                      ads_click
                    </span>
                    <span>Facebook Ads</span>
                  </div>
                  <div className="flex items-center gap-2 text-gray-700">
                    <span className="font-bold text-gray-900">78 khách</span>
                    <span className="text-gray-400 text-xs">(45%)</span>
                  </div>
                </div>
                <div className="w-full h-2.5 bg-gray-100 rounded-full overflow-hidden">
                  <div className="h-full bg-brand-500 rounded-full" style={{ width: '45%' }}></div>
                </div>
              </div>

              {/* Website */}
              <div>
                <div className="flex justify-between items-center mb-1.5 text-sm">
                  <div className="flex items-center gap-2 text-gray-900 font-semibold">
                    <span className="material-symbols-outlined text-[18px] text-blue-500">
                      public
                    </span>
                    <span>Website STND Real Estate</span>
                  </div>
                  <div className="flex items-center gap-2 text-gray-700">
                    <span className="font-bold text-gray-900">52 khách</span>
                    <span className="text-gray-400 text-xs">(30%)</span>
                  </div>
                </div>
                <div className="w-full h-2.5 bg-gray-100 rounded-full overflow-hidden">
                  <div className="h-full bg-blue-500 rounded-full" style={{ width: '30%' }}></div>
                </div>
              </div>

              {/* Referral */}
              <div>
                <div className="flex justify-between items-center mb-1.5 text-sm">
                  <div className="flex items-center gap-2 text-gray-900 font-semibold">
                    <span className="material-symbols-outlined text-[18px] text-purple-600">
                      recommend
                    </span>
                    <span>Giới thiệu (Referral)</span>
                  </div>
                  <div className="flex items-center gap-2 text-gray-700">
                    <span className="font-bold text-gray-900">26 khách</span>
                    <span className="text-gray-400 text-xs">(15%)</span>
                  </div>
                </div>
                <div className="w-full h-2.5 bg-gray-100 rounded-full overflow-hidden">
                  <div className="h-full bg-purple-600 rounded-full" style={{ width: '15%' }}></div>
                </div>
              </div>

              {/* Other channels */}
              <div>
                <div className="flex justify-between items-center mb-1.5 text-sm">
                  <div className="flex items-center gap-2 text-gray-900 font-semibold">
                    <span className="material-symbols-outlined text-[18px] text-gray-500">
                      call
                    </span>
                    <span>Kênh Khác (Telesale / Sự kiện)</span>
                  </div>
                  <div className="flex items-center gap-2 text-gray-700">
                    <span className="font-bold text-gray-900">18 khách</span>
                    <span className="text-gray-400 text-xs">(10%)</span>
                  </div>
                </div>
                <div className="w-full h-2.5 bg-gray-100 rounded-full overflow-hidden">
                  <div className="h-full bg-gray-400 rounded-full" style={{ width: '10%' }}></div>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-6 pt-4 border-t border-gray-100 flex items-center justify-between text-xs text-gray-400">
            <span>Chi phí CPL trung bình: 142.000 đ/lead</span>
            <button
              onClick={() => onNavigate('sources')}
              className="text-brand-600 hover:underline font-semibold"
            >
              Cấu hình nguồn chiến dịch ➔
            </button>
          </div>
        </div>
      </div>

      {/* 6. Staff Performance Table */}
      <div className="bg-surface-container-lowest border border-gray-200 rounded-2xl p-6 shadow-theme-xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-gray-100">
          <div>
            <div className="flex items-center gap-3">
              <h2 className="text-lg text-gray-900 font-bold">Hiệu suất chăm sóc theo nhân sự</h2>
              <span className="bg-emerald-50 text-emerald-700 text-xs font-semibold px-3 py-1 rounded-full border border-emerald-100 flex items-center gap-1">
                <span className="material-symbols-outlined text-[16px]">military_tech</span>
                Top 5 nhân sự xuất sắc tháng này
              </span>
            </div>
            <p className="text-xs text-gray-500 mt-1">
              Đánh giá thực tế dựa trên tỷ lệ hẹn khách, tỷ lệ chuyển đổi chốt cọc bất động sản
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => alert('Sắp xếp theo tỷ lệ KPI cao nhất')}
              className="h-9 px-3 bg-gray-50 hover:bg-gray-100 border border-gray-200 rounded-lg text-gray-700 text-xs font-semibold flex items-center gap-1.5 transition-colors"
            >
              <span className="material-symbols-outlined text-[18px]">sort</span>
              <span>Sắp xếp: KPI cao nhất</span>
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-gray-200 text-gray-400 text-xs uppercase font-semibold">
                <th className="py-3 px-4 w-16">Hạng</th>
                <th className="py-3 px-4">Chuyên viên tư vấn</th>
                <th className="py-3 px-4 text-center">Khách phụ trách</th>
                <th className="py-3 px-4 text-center">Khách Net</th>
                <th className="py-3 px-4 text-center">Lịch hẹn xong</th>
                <th className="py-3 px-4 text-right">Doanh số / Cọc</th>
                <th className="py-3 px-4 text-center">Tỷ lệ KPI</th>
                <th className="py-3 px-4 text-center w-24">Thao tác</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 text-sm">
              {staffList.map((st) => (
                <tr key={st.rank} className="hover:bg-gray-50/70 transition-colors">
                  <td className="py-4 px-4">
                    <div
                      className={`w-7 h-7 rounded-full font-bold flex items-center justify-center text-xs ${
                        st.rank === 1
                          ? 'bg-amber-100 text-amber-800 ring-2 ring-amber-400/50'
                          : st.rank === 2
                          ? 'bg-slate-100 text-slate-700 ring-1 ring-slate-300'
                          : 'bg-orange-50 text-orange-700'
                      }`}
                    >
                      {st.rank}
                    </div>
                  </td>

                  <td className="py-4 px-4">
                    <div className="flex items-center gap-3">
                      <div className="relative">
                        <div
                          className={`w-10 h-10 rounded-full font-bold flex items-center justify-center text-sm ${st.avatarBg}`}
                        >
                          {st.avatarText}
                        </div>
                        <span className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-emerald-500 ring-2 ring-white"></span>
                      </div>
                      <div>
                        <div className="flex items-center gap-1.5 font-bold text-gray-900">
                          <span>{st.name}</span>
                          {st.rank === 1 && (
                            <span className="material-symbols-outlined text-base text-amber-500">
                              workspace_premium
                            </span>
                          )}
                        </div>
                        <span className="text-xs text-gray-500">{st.role}</span>
                      </div>
                    </div>
                  </td>

                  <td className="py-4 px-4 text-center font-bold text-gray-900">
                    {st.customersHandled}
                  </td>

                  <td className="py-4 px-4 text-center">
                    <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-50 text-amber-700 border border-amber-200">
                      {st.hotLeads} khách
                    </span>
                  </td>

                  <td className="py-4 px-4 text-center font-bold text-gray-900">
                    {st.appointmentsCompleted} hẹn
                  </td>

                  <td className="py-4 px-4 text-right">
                    <span className="font-bold text-emerald-700">{st.salesOrDeposits}</span>
                    <p className="text-xs text-gray-400">{st.projectName}</p>
                  </td>

                  <td className="py-4 px-4 text-center">
                    <div className="inline-flex items-center gap-2">
                      <div className="w-16 bg-gray-100 h-2 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full ${
                            st.kpiRate >= 100
                              ? 'bg-emerald-500'
                              : st.kpiRate >= 70
                              ? 'bg-brand-500'
                              : 'bg-amber-500'
                          }`}
                          style={{ width: `${Math.min(st.kpiRate, 100)}%` }}
                        ></div>
                      </div>
                      <span className="text-xs font-bold text-gray-800">{st.kpiRate}%</span>
                    </div>
                  </td>

                  <td className="py-4 px-4 text-center">
                    <button
                      onClick={() => alert(`Xem chi tiết KPI của chuyên viên ${st.name}`)}
                      className="p-1.5 text-gray-400 hover:text-brand-600 hover:bg-brand-50 rounded-lg transition-colors"
                      title="Xem phân tích chi tiết"
                    >
                      <span className="material-symbols-outlined text-[18px]">visibility</span>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
