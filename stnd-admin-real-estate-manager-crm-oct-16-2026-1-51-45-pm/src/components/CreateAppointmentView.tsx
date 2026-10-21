import React, { useState } from 'react';
import { Appointment, Customer } from '../types/crm';

interface CreateAppointmentViewProps {
  customers: Customer[];
  onAddAppointment: (newApt: Appointment) => void;
  onCancel: () => void;
}

export const CreateAppointmentView: React.FC<CreateAppointmentViewProps> = ({
  customers,
  onAddAppointment,
  onCancel
}) => {
  const [selectedCustomer, setSelectedCustomer] = useState<Customer>(
    customers.find((c) => c.name === 'Lê Hoàng Long') || customers[0]
  );
  const [showCustomerPicker, setShowCustomerPicker] = useState(false);

  const [projectName, setProjectName] = useState(
    "Q'Terra Residential Suites (Thủ Đức, TP.HCM)"
  );
  const [purpose, setPurpose] = useState<Appointment['purpose']>('Xem nhà mẫu');
  const [otherPurpose, setOtherPurpose] = useState(false);
  const [date, setDate] = useState('10/21/2026');
  const [time, setTime] = useState('09:30 AM');
  const [location, setLocation] = useState(
    "Văn phòng bán hàng Q'Terra, Số 2 đường Mai Chí Thọ, P. An Phú, TP. Thủ Đức"
  );
  const [details, setDetails] = useState(
    'Khách hàng quan tâm tầng cao view hồ phân khu Vịnh Tây. Chuẩn bị bảng tính dòng tiền đợt 2, brochure in màu và 02 bản thỏa thuận đặt cọc tiêu chuẩn.'
  );

  const [reminderBefore, setReminderBefore] = useState('Trước 1 tiếng (Khuyến nghị)');
  const [smsZnsAuto, setSmsZnsAuto] = useState(true);
  const [calendarSync, setCalendarSync] = useState(true);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const newAppointment: Appointment = {
      id: `APT-${Date.now().toString().slice(-4)}`,
      customerId: selectedCustomer.id,
      customerName: selectedCustomer.name,
      customerPhone: selectedCustomer.phone,
      customerStatus: selectedCustomer.status,
      projectName,
      purpose,
      date,
      time,
      location,
      details,
      leadStaff: 'TH',
      leadStaffName: 'Hạnh ★ (Trần Mỹ Hạnh)',
      supportStaff: 'Vũ Quang Minh (Trưởng phòng KD)',
      reminderBefore,
      smsZnsAuto,
      calendarSync,
      isCompleted: false
    };

    onAddAppointment(newAppointment);
    alert('Đã tạo lịch hẹn mới thành công và đồng bộ vào mục Việc hôm nay!');
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6 animate-in fade-in duration-200">
      {/* 1. Header Toolbar */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 pb-2">
        <div>
          <div className="flex items-center gap-2 text-xs text-gray-500 mb-2">
            <button
              type="button"
              onClick={onCancel}
              className="hover:text-brand-500 transition-colors"
            >
              Quản lý khách hàng
            </button>
            <span className="material-symbols-outlined text-[14px]">chevron_right</span>
            <button
              type="button"
              onClick={onCancel}
              className="hover:text-brand-500 transition-colors"
            >
              Lịch hẹn &amp; Nhắc việc
            </button>
            <span className="material-symbols-outlined text-[14px]">chevron_right</span>
            <span className="text-brand-500 font-semibold">Tạo lịch hẹn mới</span>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Tạo lịch hẹn mới</h1>
            <span className="px-2.5 py-0.5 bg-gray-100 border border-gray-200 text-gray-700 font-mono text-xs rounded-full">
              ID: #LH-2026
            </span>
            <span className="px-2.5 py-0.5 bg-brand-50 border border-brand-100 text-brand-600 text-xs rounded-full font-semibold">
              Đang khởi tạo
            </span>
          </div>
          <p className="text-xs text-gray-500 mt-1">
            Thiết lập cuộc hẹn gặp gỡ khách hàng, dẫn xem nhà mẫu, ký cọc hoặc nhắc nhở chăm sóc định kỳ.
          </p>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={onCancel}
            className="h-10 px-4 rounded-lg border border-gray-200 bg-white text-gray-700 text-xs font-semibold hover:bg-gray-50 shadow-theme-xs transition-colors"
          >
            Hủy bỏ
          </button>
          <button
            type="submit"
            className="h-10 px-5 rounded-lg bg-brand-500 hover:bg-brand-600 active:scale-95 text-white font-semibold text-xs flex items-center gap-2 shadow-theme-xs transition-all"
          >
            <span className="material-symbols-outlined text-[18px]">add_circle</span>
            <span>Xác nhận tạo lịch hẹn</span>
          </button>
        </div>
      </div>

      {/* 2. 2-Column Desktop Grid Layout */}
      <div className="grid grid-cols-12 gap-7 items-start pb-16">
        {/* Left Column (8 of 12 cols) */}
        <div className="col-span-12 xl:col-span-8 space-y-6">
          {/* Section 1: Khách hàng & Dự án liên quan */}
          <div className="bg-surface-container-lowest rounded-2xl border border-gray-200 p-6 shadow-theme-xs space-y-5">
            <div className="flex items-center gap-2 pb-3 border-b border-gray-200">
              <span className="w-7 h-7 rounded-lg bg-brand-50 text-brand-500 flex items-center justify-center font-bold text-sm">
                1
              </span>
              <h2 className="text-base font-bold text-gray-900">
                Khách hàng &amp; Dự án liên quan
              </h2>
            </div>

            <div className="space-y-4">
              {/* Client Selector Box */}
              <div>
                <label className="block text-xs font-semibold uppercase text-gray-500 mb-2">
                  KHÁCH HÀNG QUAN TÂM <span className="text-brand-500">*</span>
                </label>

                <div className="border border-brand-500 ring-4 ring-brand-500/10 rounded-xl p-3.5 bg-brand-50/20 flex flex-col md:flex-row md:items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="w-11 h-11 rounded-full bg-blue-600 text-white font-bold flex items-center justify-center text-sm shadow-theme-xs">
                      {selectedCustomer.name
                        .split(' ')
                        .map((n) => n[0])
                        .slice(-2)
                        .join('')}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-gray-900 text-sm">
                          {selectedCustomer.name}
                        </span>
                        <span className="text-xs text-gray-500">— {selectedCustomer.phone}</span>
                        <span className="px-2 py-0.5 rounded-full text-[11px] bg-amber-50 text-amber-700 border border-amber-200 font-semibold">
                          {selectedCustomer.status}
                        </span>
                      </div>
                      <p className="text-xs text-gray-500 mt-0.5">
                        Đã tương tác: 4 cuộc gọi gần nhất • Nhu cầu:{' '}
                        {selectedCustomer.bedroomType || 'Căn 3PN'} {selectedCustomer.interestedProjects[0]}
                      </p>
                    </div>
                  </div>

                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => setShowCustomerPicker(!showCustomerPicker)}
                      className="px-3 py-1.5 text-xs font-semibold text-brand-600 bg-white border border-brand-200 rounded-lg hover:bg-brand-50 transition-colors shadow-theme-xs"
                    >
                      Thay đổi khách
                    </button>

                    {showCustomerPicker && (
                      <div className="absolute right-0 top-10 mt-1 w-64 bg-white border border-gray-200 rounded-xl shadow-theme-lg p-2 z-30 space-y-1 max-h-56 overflow-y-auto custom-scrollbar">
                        {customers.map((c) => (
                          <button
                            key={c.id}
                            type="button"
                            onClick={() => {
                              setSelectedCustomer(c);
                              setShowCustomerPicker(false);
                            }}
                            className="w-full text-left p-2 rounded-lg hover:bg-brand-50 text-xs transition-colors"
                          >
                            <div className="font-bold text-gray-900">{c.name}</div>
                            <div className="text-[11px] text-gray-500">{c.phone}</div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Dự án liên quan */}
              <div>
                <label className="block text-xs font-semibold uppercase text-gray-500 mb-2">
                  DỰ ÁN LIÊN QUAN <span className="text-brand-500">*</span>
                </label>
                <div className="relative">
                  <select
                    value={projectName}
                    onChange={(e) => setProjectName(e.target.value)}
                    className="w-full h-11 pl-3.5 pr-10 text-xs font-semibold bg-white border border-gray-200 rounded-lg focus:border-brand-500 outline-none text-gray-900 shadow-theme-xs"
                  >
                    <option value="Q'Terra Residential Suites (Thủ Đức, TP.HCM)">
                      Q&apos;Terra Residential Suites (Thủ Đức, TP.HCM)
                    </option>
                    <option value="The Rivus Grand Marina - Masterise">
                      The Rivus Grand Marina - Masterise
                    </option>
                    <option value="Eaton Park Gamuda Land">Eaton Park Gamuda Land</option>
                    <option value="Lumiere Riverside - Thảo Điền">
                      Lumiere Riverside - Thảo Điền
                    </option>
                    <option value="The Privia (Bình Tân, TP.HCM)">
                      The Privia (Bình Tân, TP.HCM)
                    </option>
                  </select>
                </div>
                <div className="mt-2 flex items-center gap-2 text-xs text-gray-500">
                  <span className="px-2 py-0.5 rounded bg-gray-100 text-gray-700 font-semibold">
                    Phân khúc cao cấp
                  </span>
                  <span>Khoảng giá: 95 - 130 triệu/m²</span>
                  <span>•</span>
                  <span className="text-emerald-700 font-semibold">Đang mở bán Giai đoạn 2</span>
                </div>
              </div>
            </div>
          </div>

          {/* Section 2: Loại cuộc hẹn & Mục đích làm việc */}
          <div className="bg-surface-container-lowest rounded-2xl border border-gray-200 p-6 shadow-theme-xs space-y-5">
            <div className="flex items-center gap-2 pb-3 border-b border-gray-200">
              <span className="w-7 h-7 rounded-lg bg-brand-50 text-brand-500 flex items-center justify-center font-bold text-sm">
                2
              </span>
              <h2 className="text-base font-bold text-gray-900">
                Loại cuộc hẹn &amp; Mục đích làm việc
              </h2>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Option 1: Xem nhà mẫu */}
              <div
                onClick={() => setPurpose('Xem nhà mẫu')}
                className={`relative p-4 rounded-xl border-2 cursor-pointer shadow-theme-xs transition-all ${
                  purpose === 'Xem nhà mẫu'
                    ? 'border-brand-500 bg-brand-50/40'
                    : 'border-gray-200 bg-white hover:bg-gray-50'
                }`}
              >
                <div className="flex items-start justify-between">
                  <div className="w-10 h-10 rounded-lg bg-brand-500 text-white flex items-center justify-center shadow-theme-xs">
                    <span className="material-symbols-outlined text-[22px]">apartment</span>
                  </div>
                  {purpose === 'Xem nhà mẫu' && (
                    <span className="w-5 h-5 rounded-full bg-brand-500 text-white flex items-center justify-center">
                      <span className="material-symbols-outlined text-[16px] font-bold">check</span>
                    </span>
                  )}
                </div>
                <h3 className="font-bold text-sm text-gray-900 mt-3">
                  Xem nhà mẫu / Trải nghiệm thực tế
                </h3>
                <p className="text-xs text-gray-500 mt-1 leading-relaxed">
                  Dẫn khách thăm quan sa bàn, căn hộ mẫu thực tế và tiện ích nội khu dự án.
                </p>
              </div>

              {/* Option 2: Ký cọc */}
              <div
                onClick={() => setPurpose('Ký cọc / Hợp đồng')}
                className={`relative p-4 rounded-xl border-2 cursor-pointer shadow-theme-xs transition-all ${
                  purpose === 'Ký cọc / Hợp đồng'
                    ? 'border-brand-500 bg-brand-50/40'
                    : 'border-gray-200 bg-white hover:bg-gray-50'
                }`}
              >
                <div className="flex items-start justify-between">
                  <div className="w-10 h-10 rounded-lg bg-rose-50 text-rose-600 flex items-center justify-center">
                    <span className="material-symbols-outlined text-[22px]">contract</span>
                  </div>
                  <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-rose-50 text-rose-600 border border-rose-100">
                    Ưu tiên cao
                  </span>
                </div>
                <h3 className="font-bold text-sm text-gray-900 mt-3">
                  Ký cọc / Ký hợp đồng mua bán
                </h3>
                <p className="text-xs text-gray-500 mt-1 leading-relaxed">
                  Thủ tục đặt cọc thiện chí, ký văn bản thỏa thuận hoặc HĐMB trực tiếp với CĐT.
                </p>
              </div>

              {/* Option 3: Gặp tư vấn */}
              <div
                onClick={() => setPurpose('Gặp tư vấn / Pháp lý')}
                className={`relative p-4 rounded-xl border-2 cursor-pointer shadow-theme-xs transition-all ${
                  purpose === 'Gặp tư vấn / Pháp lý'
                    ? 'border-brand-500 bg-brand-50/40'
                    : 'border-gray-200 bg-white hover:bg-gray-50'
                }`}
              >
                <div className="flex items-start justify-between">
                  <div className="w-10 h-10 rounded-lg bg-purple-100 text-purple-800 flex items-center justify-center">
                    <span className="material-symbols-outlined text-[22px]">forum</span>
                  </div>
                  {purpose === 'Gặp tư vấn / Pháp lý' && (
                    <span className="w-5 h-5 rounded-full bg-brand-500 text-white flex items-center justify-center">
                      <span className="material-symbols-outlined text-[16px] font-bold">check</span>
                    </span>
                  )}
                </div>
                <h3 className="font-bold text-sm text-gray-900 mt-3">
                  Gặp tư vấn trực tiếp / Pháp lý
                </h3>
                <p className="text-xs text-gray-500 mt-1 leading-relaxed">
                  Phân tích tiến độ dòng tiền, bảng so sánh lợi nhuận và thủ tục ngân hàng hỗ trợ.
                </p>
              </div>

              {/* Option 4: Nhắc gọi telesale */}
              <div
                onClick={() => setPurpose('Nhắc gọi tư vấn')}
                className={`relative p-4 rounded-xl border-2 cursor-pointer shadow-theme-xs transition-all ${
                  purpose === 'Nhắc gọi tư vấn'
                    ? 'border-brand-500 bg-brand-50/40'
                    : 'border-gray-200 bg-white hover:bg-gray-50'
                }`}
              >
                <div className="flex items-start justify-between">
                  <div className="w-10 h-10 rounded-lg bg-emerald-50 text-emerald-700 flex items-center justify-center">
                    <span className="material-symbols-outlined text-[22px]">call</span>
                  </div>
                  {purpose === 'Nhắc gọi tư vấn' && (
                    <span className="w-5 h-5 rounded-full bg-brand-500 text-white flex items-center justify-center">
                      <span className="material-symbols-outlined text-[16px] font-bold">check</span>
                    </span>
                  )}
                </div>
                <h3 className="font-bold text-sm text-gray-900 mt-3">
                  Nhắc gọi điện / Telesale chốt deal
                </h3>
                <p className="text-xs text-gray-500 mt-1 leading-relaxed">
                  Nhắc nhở cuộc gọi theo hẹn trước để cập nhật rổ hàng mới hoặc giữ chỗ ưu tiên.
                </p>
              </div>
            </div>

            <div className="pt-2 flex items-center gap-2">
              <input
                id="other_purpose_chk"
                type="checkbox"
                checked={otherPurpose}
                onChange={(e) => setOtherPurpose(e.target.checked)}
                className="w-4 h-4 rounded border-gray-300 text-brand-500 focus:ring-brand-500/20"
              />
              <label
                htmlFor="other_purpose_chk"
                className="text-xs text-gray-600 cursor-pointer select-none"
              >
                Mục đích khác (Ghi rõ chi tiết ở phần nội dung ghi chú bên dưới)
              </label>
            </div>
          </div>

          {/* Section 3: Thời gian & Địa điểm */}
          <div className="bg-surface-container-lowest rounded-2xl border border-gray-200 p-6 shadow-theme-xs space-y-5">
            <div className="flex items-center gap-2 pb-3 border-b border-gray-200">
              <span className="w-7 h-7 rounded-lg bg-brand-50 text-brand-500 flex items-center justify-center font-bold text-sm">
                3
              </span>
              <h2 className="text-base font-bold text-gray-900">Thời gian &amp; Địa điểm</h2>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <div>
                <label className="block text-xs font-semibold uppercase text-gray-500 mb-2">
                  NGÀY DIỄN RA <span className="text-brand-500">*</span>
                </label>
                <div className="relative">
                  <input
                    type="text"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    className="w-full h-11 pl-10 pr-4 text-xs font-semibold text-gray-900 bg-white border border-gray-200 rounded-lg focus:border-brand-500 shadow-theme-xs"
                  />
                  <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-[20px]">
                    calendar_month
                  </span>
                </div>
                <p className="text-xs text-gray-500 mt-1.5 flex items-center gap-1">
                  <span className="material-symbols-outlined text-[14px] text-brand-500">info</span>
                  Thứ Tư, 21 tháng 10 năm 2026
                </p>
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase text-gray-500 mb-2">
                  THỜI GIAN DIỄN RA <span className="text-brand-500">*</span>
                </label>
                <div className="relative">
                  <input
                    type="text"
                    value={time}
                    onChange={(e) => setTime(e.target.value)}
                    className="w-full h-11 pl-10 pr-4 text-xs font-semibold text-gray-900 bg-white border border-gray-200 rounded-lg focus:border-brand-500 shadow-theme-xs"
                  />
                  <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-[20px]">
                    schedule
                  </span>
                </div>
                <p className="text-xs text-gray-500 mt-1.5">
                  Thời điểm hẹn gặp trực tiếp với khách hàng
                </p>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase text-gray-500 mb-2">
                ĐỊA ĐIỂM GẶP MẶT <span className="text-brand-500">*</span>
              </label>
              <div className="relative">
                <input
                  type="text"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  className="w-full h-11 pl-10 pr-4 text-xs text-gray-900 bg-white border border-gray-200 rounded-lg focus:border-brand-500 shadow-theme-xs"
                />
                <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-[20px]">
                  location_on
                </span>
              </div>
            </div>
          </div>

          {/* Section 4: Nội dung trao đổi & Chuẩn bị */}
          <div className="bg-surface-container-lowest rounded-2xl border border-gray-200 p-6 shadow-theme-xs space-y-4">
            <div className="flex items-center gap-2 pb-3 border-b border-gray-200">
              <span className="w-7 h-7 rounded-lg bg-brand-50 text-brand-500 flex items-center justify-center font-bold text-sm">
                4
              </span>
              <h2 className="text-base font-bold text-gray-900">
                Nội dung trao đổi &amp; Chuẩn bị tài liệu
              </h2>
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase text-gray-500 mb-2">
                CHI TIẾT TRAO ĐỔI &amp; NHIỆM VỤ CHUẨN BỊ
              </label>
              <textarea
                rows={4}
                value={details}
                onChange={(e) => setDetails(e.target.value)}
                className="w-full p-3.5 text-xs text-gray-900 bg-white border border-gray-200 rounded-lg focus:border-brand-500 leading-relaxed shadow-theme-xs"
              />
              <div className="mt-2 flex items-center justify-between text-xs text-gray-400">
                <span>Ghi chú nội bộ cho chuyên viên tư vấn và quản lý</span>
                <span className="font-mono text-gray-500">{details.length} / 500 ký tự</span>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column (4 of 12 cols) */}
        <div className="col-span-12 xl:col-span-4 space-y-6">
          {/* Card 1: Nhân sự phụ trách & Phối hợp */}
          <div className="bg-surface-container-lowest rounded-2xl border border-gray-200 p-6 shadow-theme-xs space-y-4">
            <h3 className="text-base font-bold text-gray-900 pb-3 border-b border-gray-200 flex items-center justify-between">
              <span>Nhân sự phụ trách &amp; Phối hợp</span>
              <span className="material-symbols-outlined text-gray-400 text-[20px]">badge</span>
            </h3>

            <div>
              <label className="block text-xs font-semibold uppercase text-gray-500 mb-2">
                NGƯỜI PHỤ TRÁCH CHÍNH <span className="text-brand-500">*</span>
              </label>
              <div className="p-3 bg-gray-50 border border-gray-200 rounded-xl flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-brand-500 text-white font-bold flex items-center justify-center text-sm shadow-theme-xs">
                    TH
                  </div>
                  <div>
                    <div className="flex items-center gap-1.5 font-bold text-gray-900 text-xs">
                      <span>Hạnh ★</span>
                      <span className="text-gray-500 font-normal">(Trần Mỹ Hạnh)</span>
                    </div>
                    <p className="text-xs text-brand-600 font-medium">
                      Chuyên viên tư vấn cấp cao (Leader)
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => alert('Đổi người phụ trách')}
                  className="text-xs text-gray-600 hover:text-brand-500 font-medium px-2 py-1 rounded hover:bg-white border border-transparent hover:border-gray-200"
                >
                  Đổi
                </button>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase text-gray-500 mb-2">
                CỘNG SỰ / QUẢN LÝ HỖ TRỢ (TÙY CHỌN)
              </label>
              <div className="space-y-2">
                <div className="p-2.5 bg-gray-50 border border-gray-200 rounded-lg flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <span className="w-6 h-6 rounded-full bg-gray-200 text-gray-700 flex items-center justify-center text-[10px] font-bold">
                      QM
                    </span>
                    <div>
                      <span className="font-semibold text-gray-900">Vũ Quang Minh</span>
                      <span className="text-gray-500 ml-1.5">— Trưởng phòng KD</span>
                    </div>
                  </div>
                  <button type="button" className="text-gray-400 hover:text-rose-600 p-1">
                    <span className="material-symbols-outlined text-[16px]">close</span>
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => alert('Thêm nhân viên hỗ trợ')}
                  className="w-full py-2 px-3 border border-dashed border-gray-300 rounded-lg text-xs text-brand-600 hover:bg-brand-50 font-medium flex items-center justify-center gap-1.5 transition-colors"
                >
                  <span className="material-symbols-outlined text-[16px]">add</span>
                  <span>Thêm nhân viên hỗ trợ</span>
                </button>
              </div>
            </div>
          </div>

          {/* Card 2: Cài đặt Nhắc nhở & Tự động */}
          <div className="bg-surface-container-lowest rounded-2xl border border-gray-200 p-6 shadow-theme-xs space-y-4">
            <h3 className="text-base font-bold text-gray-900 pb-3 border-b border-gray-200 flex items-center justify-between">
              <span>Cài đặt Nhắc nhở &amp; Tự động</span>
              <span className="material-symbols-outlined text-gray-400 text-[20px]">
                notifications_active
              </span>
            </h3>

            <div className="space-y-4 text-xs">
              <div>
                <label className="block font-semibold uppercase text-gray-500 mb-2">
                  THÔNG BÁO NHẮC TRƯỚC
                </label>
                <select
                  value={reminderBefore}
                  onChange={(e) => setReminderBefore(e.target.value)}
                  className="w-full h-10 px-3 bg-white border border-gray-200 rounded-lg text-xs font-medium text-gray-900 focus:border-brand-500 shadow-theme-xs"
                >
                  <option value="Trước 1 tiếng (Khuyến nghị)">Trước 1 tiếng (Khuyến nghị)</option>
                  <option value="Trước 30 phút">Trước 30 phút</option>
                  <option value="Trước 2 tiếng">Trước 2 tiếng</option>
                  <option value="Trước 1 ngày">Trước 1 ngày</option>
                </select>
              </div>

              <div className="border-t border-gray-100 pt-3 flex items-center justify-between gap-3">
                <div>
                  <p className="font-semibold text-gray-900">Tự động gửi SMS / Zalo ZNS</p>
                  <p className="text-[11px] text-gray-500">Gửi thiệp mời xác nhận lịch đến khách</p>
                </div>
                <button
                  type="button"
                  onClick={() => setSmsZnsAuto(!smsZnsAuto)}
                  className={`w-12 h-7 rounded-full p-0.5 cursor-pointer flex items-center transition-colors ${
                    smsZnsAuto ? 'bg-emerald-500 justify-end' : 'bg-gray-300 justify-start'
                  }`}
                >
                  <div className="w-6 h-6 bg-white rounded-full shadow-theme-xs"></div>
                </button>
              </div>

              <div className="border-t border-gray-100 pt-3 flex items-center justify-between gap-3">
                <div>
                  <p className="font-semibold text-gray-900">Đồng bộ Google &amp; Outlook</p>
                  <p className="text-[11px] text-gray-500">Tạo sự kiện trong Calendar chuyên viên</p>
                </div>
                <button
                  type="button"
                  onClick={() => setCalendarSync(!calendarSync)}
                  className={`w-12 h-7 rounded-full p-0.5 cursor-pointer flex items-center transition-colors ${
                    calendarSync ? 'bg-emerald-500 justify-end' : 'bg-gray-300 justify-start'
                  }`}
                >
                  <div className="w-6 h-6 bg-white rounded-full shadow-theme-xs"></div>
                </button>
              </div>
            </div>
          </div>

          {/* Card 3: STND Smart Assistant */}
          <div className="bg-surface-container-lowest rounded-2xl border border-gray-200 p-6 shadow-theme-xs space-y-4">
            <div className="flex items-center gap-2 pb-3 border-b border-gray-200">
              <span className="material-symbols-outlined text-brand-500 text-[20px]">
                psychology
              </span>
              <h3 className="text-sm font-bold text-gray-900">STND Smart Assistant</h3>
            </div>

            <div className="p-3 bg-brand-50 border border-brand-100 rounded-xl">
              <div className="flex items-start gap-2 text-xs text-gray-700 leading-relaxed">
                <span className="material-symbols-outlined text-brand-500 text-sm mt-0.5">
                  auto_awesome
                </span>
                <p>
                  Lịch hẹn sau khi tạo sẽ tự động đồng bộ vào mục <strong>&quot;Việc hôm nay&quot;</strong> của Hạnh ★ và gửi lời nhắc trên lịch di động của ban quản lý STND.
                </p>
              </div>
            </div>

            <div>
              <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-2">
                GỢI Ý CHUẨN BỊ NHANH
              </p>
              <div className="flex flex-wrap gap-2 text-xs">
                {['Kiểm tra căn còn trống', 'In phiếu tính dòng tiền', 'Đăng ký xe đón khách'].map(
                  (tip) => (
                    <button
                      key={tip}
                      type="button"
                      onClick={() => alert(`Đã kích hoạt: ${tip}`)}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors"
                    >
                      <span className="material-symbols-outlined text-[14px]">
                        check_box_outline_blank
                      </span>
                      <span>{tip}</span>
                    </button>
                  )
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 3. Sticky Action Footer */}
      <div className="sticky bottom-0 bg-surface-container-lowest/95 backdrop-blur-md border border-gray-200 rounded-2xl px-8 py-3.5 flex items-center justify-between shadow-theme-md mt-6">
        <div className="flex items-center gap-3 text-xs text-gray-500">
          <span className="w-2 h-2 rounded-full bg-brand-500"></span>
          <span>Bản nháp tự động lưu lúc 09:42 AM</span>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="h-10 px-5 rounded-lg border border-gray-200 bg-white text-gray-700 text-xs font-semibold hover:bg-gray-50 shadow-theme-xs transition-colors"
          >
            Hủy bỏ
          </button>
          <button
            type="button"
            onClick={() => alert('Đã lưu nháp lịch hẹn!')}
            className="h-10 px-5 rounded-lg bg-brand-50 text-brand-600 hover:bg-brand-100 text-xs font-semibold transition-colors"
          >
            Lưu nháp
          </button>
          <button
            type="submit"
            className="h-10 px-6 rounded-lg bg-brand-500 hover:bg-brand-600 active:scale-95 text-white font-semibold text-xs shadow-theme-xs transition-all flex items-center gap-2"
          >
            <span className="material-symbols-outlined text-[18px]">event_available</span>
            <span>Xác nhận tạo lịch hẹn</span>
          </button>
        </div>
      </div>
    </form>
  );
};
