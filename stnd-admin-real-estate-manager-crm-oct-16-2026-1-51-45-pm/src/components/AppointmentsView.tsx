import React, { useState } from 'react';
import { Appointment, Customer } from '../types/crm';

interface AppointmentsViewProps {
  appointments: Appointment[];
  customers: Customer[];
  onNavigate: (view: string) => void;
  onOpenCall: (cust: Customer) => void;
  onSelectCustomerByName: (name: string) => void;
}

export const AppointmentsView: React.FC<AppointmentsViewProps> = ({
  appointments,
  customers,
  onNavigate,
  onOpenCall,
  onSelectCustomerByName
}) => {
  const [selectedDay, setSelectedDay] = useState(21); // 21 Oct 2026

  const daysRibbon = [
    { dayName: 'T2', dateNum: 19, count: 1 },
    { dayName: 'T3', dateNum: 20, count: 2 },
    { dayName: 'T4', dateNum: 21, count: 3, isToday: true },
    { dayName: 'T5', dateNum: 22, count: 2 },
    { dayName: 'T6', dateNum: 23, count: 3 },
    { dayName: 'T7', dateNum: 24, count: 5, isHot: true },
    { dayName: 'CN', dateNum: 25, count: 1 }
  ];

  const handleCallCustomer = (name: string) => {
    const found = customers.find((c) => c.name.toLowerCase().includes(name.toLowerCase()));
    if (found) {
      onOpenCall(found);
    } else {
      alert(`Đang gọi đến khách hàng: ${name}`);
    }
  };

  return (
    <div className="space-y-6">
      {/* 1. Page Title & Action Subheader */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-bold text-gray-900 tracking-tight">
              Lịch hẹn &amp; Nhắc việc
            </h1>
            <span className="bg-brand-50 text-brand-600 font-semibold px-2 py-0.5 rounded-full text-xs border border-brand-100 uppercase tracking-wide">
              Live CRM
            </span>
          </div>
          <p className="text-xs text-gray-500 mt-1 uppercase font-medium tracking-wide">
            MỤC 4.4 • QUẢN LÝ KHÁCH HÀNG — Quản lý lịch gặp gỡ, dẫn khách xem nhà mẫu, ký cọc và nhắc gọi tư vấn
          </p>
        </div>

        <button
          onClick={() => onNavigate('create_appointment')}
          className="bg-brand-500 hover:bg-brand-600 active:scale-95 text-white font-medium text-sm px-4 py-2.5 rounded-lg shadow-theme-xs flex items-center gap-2 transition-all shrink-0 cursor-pointer"
        >
          <span className="material-symbols-outlined text-lg">add</span>
          <span>Tạo lịch hẹn mới</span>
        </button>
      </div>

      {/* 2. Sub-Navigation Module Tabs */}
      <div className="border-b border-gray-200 flex items-center gap-8">
        <button
          onClick={() => onNavigate('today')}
          className="pb-3 text-sm text-gray-500 hover:text-gray-900 font-medium transition-colors border-b-2 border-transparent"
        >
          <span>Việc hôm nay (7)</span>
        </button>

        <button
          onClick={() => onNavigate('customers')}
          className="pb-3 text-sm text-gray-500 hover:text-gray-900 font-medium transition-colors border-b-2 border-transparent"
        >
          <span>Khách hàng (128)</span>
        </button>

        <button
          onClick={() => onNavigate('calendar')}
          className="pb-3 text-sm text-brand-600 font-semibold border-b-2 border-brand-500 transition-colors flex items-center gap-1.5"
        >
          <span>Lịch hẹn (12)</span>
          <span className="w-1.5 h-1.5 rounded-full bg-brand-500"></span>
        </button>

        <button
          onClick={() => onNavigate('reports')}
          className="pb-3 text-sm text-gray-500 hover:text-gray-900 font-medium transition-colors border-b-2 border-transparent"
        >
          <span>Báo cáo Thống kê</span>
        </button>
      </div>

      {/* 3. KPI Metric Cards */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* KPI 1 */}
        <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-theme-xs flex flex-col justify-between hover:border-brand-300 transition-colors">
          <div className="flex items-center justify-between text-gray-500">
            <span className="text-xs uppercase font-semibold tracking-wider text-gray-400">
              Tổng cuộc hẹn
            </span>
            <div className="w-9 h-9 rounded-lg bg-brand-50 text-brand-500 flex items-center justify-center">
              <span className="material-symbols-outlined text-xl">calendar_month</span>
            </div>
          </div>
          <div className="mt-3 flex items-baseline justify-between">
            <div className="text-3xl font-bold text-gray-900 tracking-tight">12</div>
            <span className="inline-flex items-center text-xs font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-100">
              <span className="material-symbols-outlined text-sm leading-none mr-0.5">trending_up</span>
              +15%
            </span>
          </div>
          <p className="text-xs text-gray-500 mt-2">So với cùng kỳ tháng trước</p>
        </div>

        {/* KPI 2 */}
        <div className="bg-white p-5 rounded-2xl border border-brand-200 shadow-theme-xs flex flex-col justify-between hover:border-brand-400 transition-colors relative overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-1 bg-brand-500"></div>
          <div className="flex items-center justify-between text-gray-500">
            <span className="text-xs uppercase font-bold text-brand-600 tracking-wider">
              Hôm nay (21/10)
            </span>
            <div className="w-9 h-9 rounded-lg bg-orange-50 text-orange-500 flex items-center justify-center">
              <span className="material-symbols-outlined text-xl">notifications_active</span>
            </div>
          </div>
          <div className="mt-3 flex items-baseline justify-between">
            <div className="text-3xl font-bold text-gray-900 tracking-tight">3</div>
            <span className="text-xs font-medium text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
              3 ca sự kiện
            </span>
          </div>
          <p className="text-xs text-gray-600 mt-2 truncate">1 xem mẫu • 1 ký cọc • 1 gọi điện</p>
        </div>

        {/* KPI 3 */}
        <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-theme-xs flex flex-col justify-between hover:border-brand-300 transition-colors">
          <div className="flex items-center justify-between text-gray-500">
            <span className="text-xs uppercase font-semibold tracking-wider text-gray-400">
              Sắp tới trong tuần
            </span>
            <div className="w-9 h-9 rounded-lg bg-purple-50 text-purple-700 flex items-center justify-center">
              <span className="material-symbols-outlined text-xl">event_available</span>
            </div>
          </div>
          <div className="mt-3 flex items-baseline justify-between">
            <div className="text-3xl font-bold text-gray-900 tracking-tight">9</div>
            <span className="inline-flex items-center text-xs font-semibold text-brand-600 bg-brand-50 px-2 py-0.5 rounded-full border border-brand-100">
              92% xác nhận
            </span>
          </div>
          <p className="text-xs text-gray-500 mt-2">Đã đồng bộ Google Calendar</p>
        </div>

        {/* KPI 4 */}
        <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-theme-xs flex flex-col justify-between hover:border-brand-300 transition-colors">
          <div className="flex items-center justify-between text-gray-500">
            <span className="text-xs uppercase font-semibold tracking-wider text-gray-400">
              Hoàn thành tháng này
            </span>
            <div className="w-9 h-9 rounded-lg bg-emerald-50 text-emerald-700 flex items-center justify-center">
              <span className="material-symbols-outlined text-xl">task_alt</span>
            </div>
          </div>
          <div className="mt-3 flex items-baseline justify-between">
            <div className="text-3xl font-bold text-gray-900 tracking-tight">28</div>
            <span className="inline-flex items-center text-xs font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-100">
              86% dẫn thực tế
            </span>
          </div>
          <p className="text-xs text-gray-500 mt-2">Hiệu suất dẫn khách đạt chuẩn KPI</p>
        </div>
      </section>

      {/* 4. Main 2-Column Split View */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        {/* Left Column (8 cols) */}
        <div className="xl:col-span-8 space-y-6">
          {/* 7-Day Ribbon */}
          <div className="bg-white p-4 rounded-2xl border border-gray-200 shadow-theme-xs">
            <div className="flex items-center justify-between mb-3 px-1">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold uppercase tracking-wider text-gray-600">
                  Lịch tuần hiện tại
                </span>
                <span className="text-[11px] text-gray-400">• Bấm ngày để xem nhanh ca trực</span>
              </div>
              <span className="text-xs font-semibold text-brand-600">3 sự kiện cần xử lý hôm nay</span>
            </div>

            <div className="grid grid-cols-7 gap-2">
              {daysRibbon.map((d) => {
                const isSelected = selectedDay === d.dateNum;
                return (
                  <button
                    key={d.dateNum}
                    onClick={() => setSelectedDay(d.dateNum)}
                    className={`p-2.5 rounded-xl border text-center flex flex-col items-center justify-center transition-all relative ${
                      isSelected
                        ? 'border-2 border-brand-500 bg-brand-50/70 shadow-theme-xs'
                        : 'border-gray-200 hover:border-gray-300 bg-gray-50/50 hover:bg-gray-100'
                    }`}
                  >
                    {d.isToday && (
                      <span className="absolute -top-2 px-1.5 py-0.2 bg-brand-500 text-white text-[9px] font-bold rounded-full uppercase tracking-tighter">
                        Hôm nay
                      </span>
                    )}
                    <span
                      className={`text-[11px] font-semibold ${
                        isSelected ? 'text-brand-600' : 'text-gray-400'
                      }`}
                    >
                      {d.dayName}
                    </span>
                    <span
                      className={`text-base font-extrabold mt-0.5 ${
                        isSelected ? 'text-brand-700' : 'text-gray-700'
                      }`}
                    >
                      {d.dateNum}
                    </span>
                    <span
                      className={`mt-1 text-[10px] font-semibold rounded-full px-2 py-0.5 ${
                        isSelected
                          ? 'bg-white text-brand-600 border border-brand-200 font-bold'
                          : d.isHot
                          ? 'bg-amber-50 text-amber-700 border border-amber-200'
                          : 'text-gray-400'
                      }`}
                    >
                      {d.count} hẹn
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Timeline Sessions by Day Part */}
          <div className="space-y-6">
            {/* Session 1: Buổi sáng */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-amber-500 text-lg">wb_twilight</span>
                <h3 className="text-xs font-bold uppercase tracking-wider text-gray-600">
                  Buổi sáng (09:00 - 11:30) • <span className="text-brand-600">1 sự kiện</span>
                </h3>
              </div>

              {/* Event 1: Xem nhà mẫu Q'Terra */}
              <div className="bg-white rounded-2xl border border-gray-200 border-l-4 border-l-emerald-500 p-5 shadow-theme-xs hover:shadow-theme-sm transition-all group">
                <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
                  <div className="space-y-2 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-base font-bold text-gray-900 group-hover:text-brand-600 transition-colors">
                        09:30 — Xem nhà mẫu Q&apos;Terra
                      </span>
                      <span className="bg-emerald-50 text-emerald-700 font-semibold px-2.5 py-0.5 rounded-full text-xs border border-emerald-100 flex items-center gap-1">
                        <span className="material-symbols-outlined text-xs">home</span> Xem nhà mẫu
                      </span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-2 gap-x-4 pt-1 text-xs text-gray-600">
                      <div className="flex items-center gap-2">
                        <span className="material-symbols-outlined text-gray-400 text-base">person</span>
                        <span className="font-semibold text-gray-900">
                          Khách hàng: Lê Hoàng Long
                        </span>
                        <span className="bg-purple-100 text-purple-800 text-[11px] font-medium px-2 py-0.2 rounded-full">
                          Có quan tâm
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="material-symbols-outlined text-gray-400 text-base">phone</span>
                        <span>SĐT: <strong className="text-gray-800">0912 888 921</strong></span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="material-symbols-outlined text-gray-400 text-base">location_on</span>
                        <span>Văn phòng bán hàng dự án Q&apos;Terra Central</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="material-symbols-outlined text-gray-400 text-base">badge</span>
                        <span>
                          Phụ trách: <strong className="text-brand-600 font-semibold">Hạnh ★</strong> (Chuyên viên cấp cao)
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center md:flex-col justify-end gap-2 shrink-0 border-t md:border-t-0 pt-3 md:pt-0 border-gray-100">
                    <button
                      onClick={() => handleCallCustomer('Lê Hoàng Long')}
                      className="bg-brand-50 hover:bg-brand-100 text-brand-600 font-medium text-xs px-3 py-2 rounded-lg transition-colors flex items-center gap-1.5 w-full justify-center"
                    >
                      <span className="material-symbols-outlined text-sm">call</span>
                      <span>Gọi nhanh</span>
                    </button>
                    <div className="flex items-center gap-1.5 w-full">
                      <button
                        onClick={() => onSelectCustomerByName('Lê Hoàng Long')}
                        className="flex-1 bg-white hover:bg-gray-50 border border-gray-200 text-gray-700 text-xs font-medium py-1.5 px-2.5 rounded-lg transition-colors text-center whitespace-nowrap"
                      >
                        Hồ sơ khách
                      </button>
                      <button
                        onClick={() => alert('Thao tác khác cho lịch hẹn')}
                        className="w-8 h-8 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-100 flex items-center justify-center transition-colors"
                      >
                        <span className="material-symbols-outlined text-base">more_horiz</span>
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Session 2: Buổi chiều */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-orange-500 text-lg">wb_sunny</span>
                <h3 className="text-xs font-bold uppercase tracking-wider text-gray-600">
                  Buổi chiều (14:00 - 17:30) • <span className="text-brand-600">2 sự kiện</span>
                </h3>
              </div>

              {/* Event 2: Ký cọc The Privia */}
              <div className="bg-white rounded-2xl border border-gray-200 border-l-4 border-l-amber-500 p-5 shadow-theme-xs hover:shadow-theme-sm transition-all group">
                <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
                  <div className="space-y-2 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-base font-bold text-gray-900 group-hover:text-amber-700 transition-colors">
                        14:30 — Ký hợp đồng cọc dự án The Privia
                      </span>
                      <span className="bg-amber-50 text-amber-700 font-semibold px-2.5 py-0.5 rounded-full text-xs border border-amber-200 flex items-center gap-1">
                        <span className="material-symbols-outlined text-xs">contract</span> Ký cọc / Hợp đồng
                      </span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-2 gap-x-4 pt-1 text-xs text-gray-600">
                      <div className="flex items-center gap-2">
                        <span className="material-symbols-outlined text-gray-400 text-base">person</span>
                        <span className="font-semibold text-gray-900">
                          Khách hàng: Trần Thị Bích
                        </span>
                        <span className="bg-amber-50 text-amber-700 text-[11px] font-semibold px-2 py-0.2 rounded-full border border-amber-200">
                          Khách net
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="material-symbols-outlined text-gray-400 text-base">phone</span>
                        <span>SĐT: <strong className="text-gray-800">0988 333 112</strong></span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="material-symbols-outlined text-gray-400 text-base">apartment</span>
                        <span>Địa điểm: Trụ sở STND (Tầng 5 tòa nhà STND Tower)</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="material-symbols-outlined text-gray-400 text-base">payments</span>
                        <span>Căn: <strong className="text-gray-900">Căn 2PN-B08</strong> • Giá: 3.42 tỷ</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center md:flex-col justify-end gap-2 shrink-0 border-t md:border-t-0 pt-3 md:pt-0 border-gray-100">
                    <button
                      onClick={() => alert('Đã xác nhận hoàn thành ký cọc và lưu vào CRM!')}
                      className="bg-emerald-50 hover:bg-emerald-100 text-emerald-700 font-semibold text-xs px-3 py-2 rounded-lg transition-colors flex items-center gap-1.5 w-full justify-center border border-emerald-200"
                    >
                      <span className="material-symbols-outlined text-sm">check_circle</span>
                      <span>Xác nhận hoàn thành</span>
                    </button>
                    <div className="flex items-center gap-1.5 w-full">
                      <button
                        onClick={() => alert('Mở form ghi chú hợp đồng cọc')}
                        className="flex-1 bg-white hover:bg-gray-50 border border-gray-200 text-gray-700 text-xs font-medium py-1.5 px-2.5 rounded-lg transition-colors text-center whitespace-nowrap"
                      >
                        Ghi chú cọc
                      </button>
                      <button
                        onClick={() => onSelectCustomerByName('Trần Thị Bích')}
                        className="w-8 h-8 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-100 flex items-center justify-center transition-colors"
                        title="Xem hồ sơ"
                      >
                        <span className="material-symbols-outlined text-base">visibility</span>
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* Event 3: Nhắc gọi tư vấn */}
              <div className="bg-white rounded-2xl border border-gray-200 border-l-4 border-l-brand-500 p-5 shadow-theme-xs hover:shadow-theme-sm transition-all group">
                <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
                  <div className="space-y-2 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-base font-bold text-gray-900 group-hover:text-brand-600 transition-colors">
                        16:00 — Nhắc gọi lại tư vấn gói vay &amp; phương thức thanh toán
                      </span>
                      <span className="bg-brand-50 text-brand-600 font-semibold px-2.5 py-0.5 rounded-full text-xs border border-brand-100 flex items-center gap-1">
                        <span className="material-symbols-outlined text-xs">ring_volume</span> Nhắc gọi tư vấn
                      </span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-2 gap-x-4 pt-1 text-xs text-gray-600">
                      <div className="flex items-center gap-2">
                        <span className="material-symbols-outlined text-gray-400 text-base">person</span>
                        <span className="font-semibold text-gray-900">
                          Khách hàng: Nguyễn Văn A
                        </span>
                        <span className="bg-gray-100 text-gray-700 text-[11px] font-medium px-2 py-0.2 rounded-full">
                          Chờ gọi lại
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="material-symbols-outlined text-gray-400 text-base">phone</span>
                        <span>SĐT: <strong className="text-gray-800">0912 345 678</strong></span>
                      </div>
                      <div className="sm:col-span-2 flex items-start gap-2 bg-gray-50 p-2.5 rounded-lg border border-gray-200">
                        <span className="material-symbols-outlined text-brand-500 text-base mt-0.5">
                          sticky_note_2
                        </span>
                        <span className="text-xs text-gray-700 leading-relaxed">
                          <strong>Ghi chú:</strong> Gọi sau 16h khách rảnh, tư vấn gói hỗ trợ lãi suất 0% trong 24 tháng dự án The Privia &amp; lịch giải ngân Vietcombank.
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center md:flex-col justify-end gap-2 shrink-0 border-t md:border-t-0 pt-3 md:pt-0 border-gray-100">
                    <button
                      onClick={() => handleCallCustomer('Nguyễn Văn A')}
                      className="bg-brand-500 hover:bg-brand-600 text-white font-medium text-xs px-3 py-2 rounded-lg transition-colors flex items-center gap-1.5 w-full justify-center shadow-theme-xs"
                    >
                      <span className="material-symbols-outlined text-sm">call</span>
                      <span>Gọi ngay cho khách</span>
                    </button>
                    <div className="flex items-center gap-1.5 w-full">
                      <button
                        onClick={() => alert('Đã đánh dấu liên hệ xong!')}
                        className="flex-1 bg-white hover:bg-gray-50 border border-gray-200 text-gray-700 text-xs font-medium py-1.5 px-2.5 rounded-lg transition-colors text-center whitespace-nowrap"
                      >
                        Đã liên hệ xong
                      </button>
                      <button
                        onClick={() => onSelectCustomerByName('Nguyễn Văn A')}
                        className="w-8 h-8 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-100 flex items-center justify-center transition-colors"
                        title="Xem hồ sơ"
                      >
                        <span className="material-symbols-outlined text-base">visibility</span>
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column (4 cols) */}
        <div className="xl:col-span-4 space-y-6">
          {/* Mini Calendar Card */}
          <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-theme-xs">
            <div className="flex items-center justify-between mb-4">
              <span className="text-xs font-bold uppercase tracking-wider text-gray-700">
                Lịch tháng 10/2026
              </span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => alert('Tháng trước')}
                  className="w-7 h-7 rounded hover:bg-gray-100 flex items-center justify-center text-gray-500"
                >
                  <span className="material-symbols-outlined text-sm">chevron_left</span>
                </button>
                <button
                  onClick={() => alert('Tháng sau')}
                  className="w-7 h-7 rounded hover:bg-gray-100 flex items-center justify-center text-gray-500"
                >
                  <span className="material-symbols-outlined text-sm">chevron_right</span>
                </button>
              </div>
            </div>

            {/* Days grid */}
            <div className="grid grid-cols-7 gap-1 text-center text-xs">
              <span className="text-gray-400 font-semibold py-1">T2</span>
              <span className="text-gray-400 font-semibold py-1">T3</span>
              <span className="text-gray-400 font-semibold py-1">T4</span>
              <span className="text-gray-400 font-semibold py-1">T5</span>
              <span className="text-gray-400 font-semibold py-1">T6</span>
              <span className="text-gray-400 font-semibold py-1">T7</span>
              <span className="text-gray-400 font-semibold py-1">CN</span>

              {/* Month days */}
              <span className="py-1.5 text-gray-300">28</span>
              <span className="py-1.5 text-gray-300">29</span>
              <span className="py-1.5 text-gray-300">30</span>
              <span className="py-1.5 text-gray-700">1</span>
              <span className="py-1.5 text-gray-700">2</span>
              <span className="py-1.5 text-gray-700">3</span>
              <span className="py-1.5 text-gray-700">4</span>
              <span className="py-1.5 text-gray-700">5</span>
              <span className="py-1.5 text-gray-700">6</span>
              <span className="py-1.5 text-gray-700">7</span>
              <span className="py-1.5 text-gray-700">8</span>
              <span className="py-1.5 text-gray-700">9</span>
              <span className="py-1.5 text-gray-700">10</span>
              <span className="py-1.5 text-gray-700">11</span>
              <span className="py-1.5 text-gray-700">12</span>
              <span className="py-1.5 text-gray-700">13</span>
              <span className="py-1.5 text-gray-700">14</span>
              <span className="py-1.5 text-gray-700">15</span>
              <span className="py-1.5 text-gray-700">16</span>
              <span className="py-1.5 text-gray-700">17</span>
              <span className="py-1.5 text-gray-700">18</span>
              <span className="py-1.5 text-gray-700 rounded-md">19</span>
              <span className="py-1.5 text-gray-700 rounded-md">20</span>
              <span className="py-1.5 bg-brand-500 text-white font-bold rounded-lg shadow-theme-xs">
                21
              </span>
              <span className="py-1.5 text-gray-700 font-medium hover:bg-gray-100 rounded-md">
                22
              </span>
              <span className="py-1.5 text-gray-700 font-medium hover:bg-gray-100 rounded-md">
                23
              </span>
              <span className="py-1.5 text-amber-700 font-semibold bg-amber-50 rounded-md">
                24
              </span>
              <span className="py-1.5 text-gray-700 font-medium hover:bg-gray-100 rounded-md">
                25
              </span>
              <span className="py-1.5 text-gray-700">26</span>
              <span className="py-1.5 text-gray-700">27</span>
              <span className="py-1.5 text-gray-700">28</span>
              <span className="py-1.5 text-gray-700">29</span>
              <span className="py-1.5 text-gray-700">30</span>
              <span className="py-1.5 text-gray-700">31</span>
              <span className="py-1.5 text-gray-300">1</span>
            </div>

            <div className="mt-3 pt-3 border-t border-gray-100 flex items-center justify-between text-xs text-gray-500">
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-brand-500"></span> Ngày chọn
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-amber-500"></span> Ngày cao điểm
              </span>
            </div>
          </div>

          {/* STND AI Assistant Widget */}
          <div className="bg-gradient-to-br from-purple-50 via-white to-brand-50 p-5 rounded-2xl border border-purple-200 shadow-theme-xs">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-purple-100 text-purple-800 flex items-center justify-center">
                  <span className="material-symbols-outlined text-base">auto_awesome</span>
                </div>
                <span className="text-xs font-bold uppercase tracking-wider text-purple-900">
                  Gợi ý từ STND AI
                </span>
              </div>
              <span className="text-[10px] font-semibold bg-purple-100 text-purple-800 px-2 py-0.5 rounded-full">
                Hôm nay
              </span>
            </div>

            <div className="space-y-2.5 text-xs">
              <div className="p-2.5 rounded-xl bg-white/80 border border-purple-100 shadow-theme-xs flex items-start gap-2.5">
                <span className="material-symbols-outlined text-purple-700 text-sm mt-0.5">
                  calculate
                </span>
                <div>
                  <p className="font-semibold text-gray-900 leading-snug">
                    Chuẩn bị bảng tính dòng tiền đợt 2
                  </p>
                  <p className="text-gray-500 text-[11px] mt-0.5">
                    Khách <strong>Trần Thị Bích</strong> (The Privia) lúc 14:30. Khách quan tâm lịch
                    vay ân hạn gốc.
                  </p>
                </div>
              </div>

              <div className="p-2.5 rounded-xl bg-white/80 border border-purple-100 shadow-theme-xs flex items-start gap-2.5">
                <span className="material-symbols-outlined text-brand-600 text-sm mt-0.5">
                  description
                </span>
                <div>
                  <p className="font-semibold text-gray-900 leading-snug">Hồ sơ pháp lý Q&apos;Terra</p>
                  <p className="text-gray-500 text-[11px] mt-0.5">
                    Khách <strong>Lê Hoàng Long</strong> cần xem bản phê duyệt 1/500 và phụ lục vật
                    liệu bàn giao.
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Upcoming Events List */}
          <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-theme-xs">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-bold uppercase tracking-wider text-gray-700">
                Lịch sắp tới tuần này
              </span>
              <button
                onClick={() => alert('Xem toàn bộ lịch trình')}
                className="text-xs font-semibold text-brand-600 hover:underline"
              >
                Xem tất cả
              </button>
            </div>

            <div className="divide-y divide-gray-100 text-xs">
              <div className="py-3 flex items-start justify-between gap-2">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-gray-800">T5, 22/10 • 10:00</span>
                    <span className="text-[10px] bg-brand-50 text-brand-600 px-1.5 py-0.2 rounded font-medium">
                      Tư vấn
                    </span>
                  </div>
                  <p className="text-gray-900 font-semibold">Phạm Thanh Sơn</p>
                  <p className="text-gray-500 text-[11px]">
                    Dự án Ecopark Grand • Phụ trách: Thảo Sale
                  </p>
                </div>
                <button
                  onClick={() => onSelectCustomerByName('Phạm Thanh Sơn')}
                  className="text-gray-400 hover:text-gray-600 p-1"
                >
                  <span className="material-symbols-outlined text-base">chevron_right</span>
                </button>
              </div>

              <div className="py-3 flex items-start justify-between gap-2">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-gray-800">T6, 23/10 • 15:30</span>
                    <span className="text-[10px] bg-emerald-50 text-emerald-700 px-1.5 py-0.2 rounded font-medium">
                      Dẫn sa bàn
                    </span>
                  </div>
                  <p className="text-gray-900 font-semibold">Vũ Minh Đức</p>
                  <p className="text-gray-500 text-[11px]">
                    Khu căn hộ mẫu The Privia • Phụ trách: Hạnh ★
                  </p>
                </div>
                <button
                  onClick={() => onSelectCustomerByName('Vũ Minh Đức')}
                  className="text-gray-400 hover:text-gray-600 p-1"
                >
                  <span className="material-symbols-outlined text-base">chevron_right</span>
                </button>
              </div>

              <div className="py-3 flex items-start justify-between gap-2">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-gray-800">T7, 24/10 • 09:00</span>
                    <span className="text-[10px] bg-amber-50 text-amber-700 px-1.5 py-0.2 rounded font-medium">
                      Event mở bán
                    </span>
                  </div>
                  <p className="text-gray-900 font-semibold">5 khách tham gia mở bán đợt 1</p>
                  <p className="text-gray-500 text-[11px]">Trung tâm hội nghị STND Plaza</p>
                </div>
                <button
                  onClick={() => alert('Chi tiết sự kiện mở bán')}
                  className="text-gray-400 hover:text-gray-600 p-1"
                >
                  <span className="material-symbols-outlined text-base">chevron_right</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
