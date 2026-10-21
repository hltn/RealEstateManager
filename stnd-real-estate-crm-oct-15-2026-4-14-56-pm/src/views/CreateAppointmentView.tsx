import React, { useState } from 'react';
import { Customer, Appointment } from '../types';
import { AVATAR_HANH, AVATAR_MINH } from '../data/mockData';

interface CreateAppointmentViewProps {
  customers: Customer[];
  onBack: () => void;
  onSaveAppointment: (appt: Appointment) => void;
}

export const CreateAppointmentView: React.FC<CreateAppointmentViewProps> = ({
  customers,
  onBack,
  onSaveAppointment,
}) => {
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>(
    customers[0]?.id || 'kh-05'
  );
  const selectedCustomer = customers.find((c) => c.id === selectedCustomerId) || customers[0];

  const [selectedProject, setSelectedProject] = useState("Q'Terra Residential Suites");
  const [appointmentType, setAppointmentType] = useState<
    'xem_nha' | 'ky_coc' | 'gap_truc_tiep' | 'nhac_goi' | 'khac'
  >('xem_nha');

  const [date, setDate] = useState('2026-10-21');
  const [time, setTime] = useState('09:30 AM');
  const [location, setLocation] = useState(
    "Văn phòng bán hàng Q'Terra, Số 28 Mai Chí Thọ, P. An Phú, TP. Thủ Đức"
  );

  const [leadPIC, setLeadPIC] = useState('Trần Mỹ Hạnh ★');
  const [coWorker, setCoWorker] = useState('Vũ Quang Minh');
  const [reminderTime, setReminderTime] = useState('1h');
  const [autoSms, setAutoSms] = useState(true);
  const [noteContent, setNoteContent] = useState(
    'Khách hàng quan tâm tầng cao view hồ. Mang theo brochure in màu phân khu Vịnh Tây và 02 bản thỏa thuận đặt cọc tiêu chuẩn.'
  );

  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleConfirm = () => {
    setIsSubmitting(true);

    const typeLabels = {
      xem_nha: 'Xem nhà mẫu',
      ky_coc: 'Ký cọc / Hợp đồng',
      gap_truc_tiep: 'Gặp tư vấn',
      nhac_goi: 'Nhắc gọi tư vấn',
      khac: 'Mục đích khác',
    };

    const newAppt: Appointment = {
      id: `lh-${Date.now()}`,
      title: `${time} - ${typeLabels[appointmentType]} ${selectedCustomer ? selectedCustomer.name : ''}`,
      customerId: selectedCustomer?.id || 'kh-01',
      customerName: selectedCustomer?.name || 'Khách hàng',
      customerPhone: selectedCustomer?.phone || '0912 345 678',
      customerTag: selectedCustomer?.statusLabel || 'Có quan tâm',
      date,
      time,
      dayOfWeek: 'T4',
      dayNumber: 21,
      period: time.includes('AM') || parseInt(time) < 12 ? 'morning' : 'afternoon',
      type: appointmentType,
      typeLabel: typeLabels[appointmentType],
      location,
      assignedLead: leadPIC,
      coWorker,
      reminderTime: reminderTime === '1h' ? 'Trước 1 tiếng (Khuyến nghị)' : 'Trước 30 phút',
      note: noteContent,
      autoSms,
    };

    setTimeout(() => {
      onSaveAppointment(newAppt);
      setIsSubmitting(false);
    }, 400);
  };

  return (
    <div className="w-full max-w-[430px] min-h-screen bg-gray-50 flex flex-col relative pb-32 border-x border-gray-200 shadow-theme-xs mx-auto animate-in fade-in duration-200">
      {/* Top App Bar */}
      <header className="sticky top-0 z-50 bg-white/95 backdrop-blur-md px-4 h-[68px] flex items-center justify-between shadow-theme-xs border-b border-gray-200">
        <div className="flex items-center gap-3">
          <button
            type="button"
            aria-label="Quay lại"
            onClick={onBack}
            className="w-10 h-10 rounded-lg flex items-center justify-center text-gray-700 hover:bg-gray-100 active:scale-95 transition-all"
          >
            <span className="material-symbols-outlined text-gray-700">arrow_back</span>
          </button>
          <div>
            <h1 className="text-title-md font-bold text-gray-900 tracking-tight">
              Tạo lịch hẹn mới
            </h1>
            <p className="text-label-xs text-gray-500">Khách hàng & Nhắc việc</p>
          </div>
        </div>

        <button
          type="button"
          onClick={onBack}
          className="w-9 h-9 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-gray-500 transition-colors"
        >
          <span className="material-symbols-outlined text-gray-600">close</span>
        </button>
      </header>

      {/* Main Form Body */}
      <main className="flex-1 px-4 py-4 space-y-4">
        {/* Status Indicator Pill */}
        <div className="flex items-center justify-between bg-white p-3.5 rounded-2xl border border-gray-200 shadow-theme-xs">
          <div className="flex items-center gap-2.5">
            <div className="w-2.5 h-2.5 rounded-full bg-brand-500 animate-pulse"></div>
            <span className="text-body-md font-medium text-gray-800">
              Trạng thái tạo: <span className="text-brand-600">Đang khởi tạo</span>
            </span>
          </div>
          <span className="text-label-xs text-gray-400 font-mono">ID: #LH-2026</span>
        </div>

        {/* Section 1: Khách hàng & Dự án */}
        <section className="bg-white rounded-2xl border border-gray-200 p-4 shadow-theme-xs space-y-4">
          <div className="flex items-center justify-between border-b border-gray-100 pb-2.5">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-brand-500">person_search</span>
              <h2 className="text-body-lg-bold font-bold text-gray-900">
                1. Khách hàng & Dự án
              </h2>
            </div>
            <span className="text-error-600 text-label-xs font-semibold">* Bắt buộc</span>
          </div>

          <div>
            <label className="block text-label-xs uppercase text-gray-500 mb-1.5 font-medium tracking-wider">
              Khách hàng quan tâm <span className="text-brand-500">*</span>
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-gray-400">
                <span className="material-symbols-outlined text-[18px]">person</span>
              </div>
              <select
                value={selectedCustomerId}
                onChange={(e) => setSelectedCustomerId(e.target.value)}
                className="w-full h-11 pl-10 pr-9 bg-white border border-gray-200 rounded-lg text-body-md text-gray-800 focus:border-brand-500 outline-none appearance-none"
              >
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} — {c.phone} ({c.statusLabel})
                  </option>
                ))}
              </select>
              <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none text-gray-400">
                <span className="material-symbols-outlined">expand_more</span>
              </div>
            </div>

            {selectedCustomer && (
              <div className="mt-2 flex items-center gap-2 flex-wrap">
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-success-50 text-success-700 text-label-xs font-medium">
                  <span className="material-symbols-outlined text-[14px]">check_circle</span>{' '}
                  {selectedCustomer.statusLabel}
                </span>
                <span className="text-label-xs text-gray-500">
                  Phụ trách: {selectedCustomer.assignedLead} (Team Nam Sài Gòn)
                </span>
              </div>
            )}
          </div>

          <div>
            <label className="block text-label-xs uppercase text-gray-500 mb-1.5 font-medium tracking-wider">
              Dự án liên quan <span className="text-brand-500">*</span>
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-gray-400">
                <span className="material-symbols-outlined text-[18px]">apartment</span>
              </div>
              <select
                value={selectedProject}
                onChange={(e) => setSelectedProject(e.target.value)}
                className="w-full h-11 pl-10 pr-9 bg-white border border-gray-200 rounded-lg text-body-md text-gray-800 focus:border-brand-500 outline-none appearance-none"
              >
                <option value="Q'Terra Residential Suites">Q'Terra Residential Suites</option>
                <option value="Vinhomes Ocean Park 3 — Phân khu Vịnh Tây">
                  Vinhomes Ocean Park 3 — Phân khu Vịnh Tây
                </option>
                <option value="The Privia">The Privia</option>
                <option value="Ecopark Grand">Ecopark Grand</option>
              </select>
              <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none text-gray-400">
                <span className="material-symbols-outlined">expand_more</span>
              </div>
            </div>
          </div>
        </section>

        {/* Section 2: Loại cuộc hẹn & Mục đích */}
        <section className="bg-white rounded-2xl border border-gray-200 p-4 shadow-theme-xs space-y-3">
          <div className="flex items-center justify-between border-b border-gray-100 pb-2.5">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-brand-500">category</span>
              <h2 className="text-body-lg-bold font-bold text-gray-900">
                2. Loại cuộc hẹn & Mục đích
              </h2>
            </div>
            <span className="text-label-xs text-gray-400">Chọn 1 hình thức</span>
          </div>
          <p className="text-label-xs text-gray-500">Mục tiêu ưu tiên phục vụ buổi làm việc:</p>

          <div className="grid grid-cols-2 gap-2.5 pt-1">
            {/* Item 1: Xem nhà mẫu */}
            <div
              onClick={() => setAppointmentType('xem_nha')}
              className={`cursor-pointer relative flex items-center p-3 rounded-xl transition-all select-none ${
                appointmentType === 'xem_nha'
                  ? 'border-2 border-brand-500 bg-brand-50/50 shadow-theme-xs'
                  : 'border border-gray-200 bg-white hover:border-gray-300'
              }`}
            >
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-brand-500 text-white flex items-center justify-center shrink-0">
                  <span className="material-symbols-outlined text-[18px]">domain</span>
                </div>
                <div>
                  <span className="block font-medium text-xs text-brand-900 leading-tight">
                    Xem nhà mẫu
                  </span>
                  <span className="text-[11px] text-brand-600">Trải nghiệm dự án</span>
                </div>
              </div>
              {appointmentType === 'xem_nha' && (
                <span className="absolute top-2 right-2 text-brand-500 material-symbols-outlined text-[18px]">
                  check_circle
                </span>
              )}
            </div>

            {/* Item 2: Ký cọc / Hợp đồng */}
            <div
              onClick={() => setAppointmentType('ky_coc')}
              className={`cursor-pointer relative flex items-center p-3 rounded-xl transition-all select-none ${
                appointmentType === 'ky_coc'
                  ? 'border-2 border-warning-500 bg-warning-50/50 shadow-theme-xs'
                  : 'border border-gray-200 bg-white hover:border-warning-500'
              }`}
            >
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-warning-50 text-warning-700 flex items-center justify-center shrink-0">
                  <span className="material-symbols-outlined text-[18px]">edit_document</span>
                </div>
                <div>
                  <span className="block font-medium text-xs text-gray-800 leading-tight">
                    Ký cọc / HĐ
                  </span>
                  <span className="text-[11px] text-warning-700 font-semibold">Ưu tiên cao</span>
                </div>
              </div>
              {appointmentType === 'ky_coc' && (
                <span className="absolute top-2 right-2 text-warning-500 material-symbols-outlined text-[18px]">
                  check_circle
                </span>
              )}
            </div>

            {/* Item 3: Gặp trực tiếp tư vấn */}
            <div
              onClick={() => setAppointmentType('gap_truc_tiep')}
              className={`cursor-pointer relative flex items-center p-3 rounded-xl transition-all select-none ${
                appointmentType === 'gap_truc_tiep'
                  ? 'border-2 border-brand-500 bg-brand-50/50 shadow-theme-xs'
                  : 'border border-gray-200 bg-white hover:border-brand-300'
              }`}
            >
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-blue-50 text-brand-600 flex items-center justify-center shrink-0">
                  <span className="material-symbols-outlined text-[18px]">groups</span>
                </div>
                <div>
                  <span className="block font-medium text-xs text-gray-800 leading-tight">
                    Gặp tư vấn
                  </span>
                  <span className="text-[11px] text-gray-500">Trao đổi chính sách</span>
                </div>
              </div>
              {appointmentType === 'gap_truc_tiep' && (
                <span className="absolute top-2 right-2 text-brand-500 material-symbols-outlined text-[18px]">
                  check_circle
                </span>
              )}
            </div>

            {/* Item 4: Nhắc gọi điện */}
            <div
              onClick={() => setAppointmentType('nhac_goi')}
              className={`cursor-pointer relative flex items-center p-3 rounded-xl transition-all select-none ${
                appointmentType === 'nhac_goi'
                  ? 'border-2 border-purple-500 bg-purple-50 shadow-theme-xs'
                  : 'border border-gray-200 bg-white hover:border-brand-300'
              }`}
            >
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-purple-100 text-purple-800 flex items-center justify-center shrink-0">
                  <span className="material-symbols-outlined text-[18px]">call</span>
                </div>
                <div>
                  <span className="block font-medium text-xs text-gray-800 leading-tight">
                    Nhắc gọi điện
                  </span>
                  <span className="text-[11px] text-purple-800">Telesale / Chốt deal</span>
                </div>
              </div>
              {appointmentType === 'nhac_goi' && (
                <span className="absolute top-2 right-2 text-purple-600 material-symbols-outlined text-[18px]">
                  check_circle
                </span>
              )}
            </div>

            {/* Item 5: Khác */}
            <div
              onClick={() => setAppointmentType('khac')}
              className={`col-span-2 cursor-pointer relative flex items-center p-2.5 px-3 rounded-xl transition-all select-none ${
                appointmentType === 'khac'
                  ? 'border-2 border-brand-500 bg-brand-50/50'
                  : 'border border-gray-200 bg-white hover:border-brand-300'
              }`}
            >
              <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-lg bg-gray-100 text-gray-600 flex items-center justify-center shrink-0">
                  <span className="material-symbols-outlined text-[16px]">more_horiz</span>
                </div>
                <span className="font-medium text-xs text-gray-700">
                  Mục đích khác (Ghi rõ chi tiết ở phần ghi chú)
                </span>
              </div>
            </div>
          </div>
        </section>

        {/* Section 3: Thời gian & Địa điểm */}
        <section className="bg-white rounded-2xl border border-gray-200 p-4 shadow-theme-xs space-y-4">
          <div className="flex items-center justify-between border-b border-gray-100 pb-2.5">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-brand-500">event_upcoming</span>
              <h2 className="text-body-lg-bold font-bold text-gray-900">
                3. Thời gian & Địa điểm
              </h2>
            </div>
            <span className="text-label-xs text-brand-600 font-semibold bg-brand-50 px-2 py-0.5 rounded-md">
              Lịch tự động
            </span>
          </div>

          <div>
            <label className="block text-label-xs uppercase text-gray-500 mb-1.5 font-medium tracking-wider">
              Ngày diễn ra <span className="text-brand-500">*</span>
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-brand-500">
                <span className="material-symbols-outlined">calendar_month</span>
              </div>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full h-11 pl-10 pr-4 bg-white border border-gray-200 rounded-lg text-body-md text-gray-800 focus:border-brand-500 outline-none"
              />
            </div>
            <p className="text-label-xs text-gray-400 mt-1">
              Thứ Tư, ngày 21 tháng 10 năm 2026
            </p>
          </div>

          <div>
            <label className="block text-label-xs uppercase text-gray-500 mb-1.5 font-medium tracking-wider">
              Thời gian diễn ra <span className="text-brand-500">*</span>
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-gray-400">
                <span className="material-symbols-outlined">schedule</span>
              </div>
              <input
                type="text"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                className="w-full h-11 pl-10 pr-4 bg-white border border-gray-200 rounded-lg text-body-md text-gray-800 focus:border-brand-500 outline-none"
              />
            </div>
          </div>

          <div>
            <label className="block text-label-xs uppercase text-gray-500 mb-1.5 font-medium tracking-wider">
              Địa điểm gặp mặt <span className="text-brand-500">*</span>
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-brand-500">
                <span className="material-symbols-outlined">location_on</span>
              </div>
              <input
                type="text"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="Nhập địa chỉ hoặc chọn địa điểm"
                className="w-full h-11 pl-10 pr-9 bg-white border border-gray-200 rounded-lg text-body-md text-gray-800 focus:border-brand-500 outline-none"
              />
              <button
                type="button"
                className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400 hover:text-brand-500"
                title="Chọn từ bản đồ STND"
              >
                <span className="material-symbols-outlined">my_location</span>
              </button>
            </div>
          </div>
        </section>

        {/* Section 4: Nhân sự phụ trách */}
        <section className="bg-white rounded-2xl border border-gray-200 p-4 shadow-theme-xs space-y-4">
          <div className="flex items-center justify-between border-b border-gray-100 pb-2.5">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-brand-500">badge</span>
              <h2 className="text-body-lg-bold font-bold text-gray-900">
                4. Nhân sự phụ trách
              </h2>
            </div>
            <span className="text-label-xs text-gray-500">2 nhân sự</span>
          </div>

          <div>
            <label className="block text-label-xs uppercase text-gray-500 mb-1.5 font-medium tracking-wider">
              Người phụ trách chính <span className="text-brand-500">*</span>
            </label>
            <div className="flex items-center justify-between p-2.5 bg-gray-50 border border-gray-200 rounded-lg">
              <div className="flex items-center gap-3">
                <img
                  className="w-10 h-10 rounded-full object-cover border-2 border-brand-500 shadow-theme-xs"
                  src={AVATAR_HANH}
                  alt={leadPIC}
                />
                <div className="flex items-center gap-1.5">
                  <span className="font-semibold text-gray-900 text-xs">{leadPIC}</span>
                </div>
              </div>
              <button
                type="button"
                onClick={() =>
                  setLeadPIC(leadPIC === 'Trần Mỹ Hạnh ★' ? 'Nguyễn Tuấn ★' : 'Trần Mỹ Hạnh ★')
                }
                className="px-2.5 py-1 bg-white border border-gray-200 text-gray-600 rounded-md text-xs hover:bg-gray-50 font-medium"
              >
                Đổi
              </button>
            </div>
          </div>

          <div>
            <label className="block text-label-xs uppercase text-gray-500 mb-1.5 font-medium tracking-wider">
              Cộng sự / Quản lý hỗ trợ (Tùy chọn)
            </label>
            <div className="space-y-2">
              <div className="flex items-center justify-between p-2 px-3 bg-brand-25 rounded-lg border border-brand-100">
                <div className="flex items-center gap-2.5">
                  <img
                    className="w-8 h-8 rounded-full object-cover"
                    src={AVATAR_MINH}
                    alt={coWorker}
                  />
                  <span className="font-medium text-xs text-brand-900">{coWorker}</span>
                </div>
                <button
                  type="button"
                  onClick={() => setCoWorker('')}
                  className="text-gray-400 hover:text-red-500 p-1"
                >
                  <span className="material-symbols-outlined text-[18px]">close</span>
                </button>
              </div>

              {!coWorker && (
                <button
                  type="button"
                  onClick={() => setCoWorker('Vũ Quang Minh')}
                  className="w-full h-10 border border-dashed border-gray-300 hover:border-brand-500 hover:bg-brand-50/50 rounded-lg flex items-center justify-center gap-2 text-gray-600 hover:text-brand-600 font-medium text-xs transition-all"
                >
                  <span className="material-symbols-outlined text-[18px]">person_add</span>
                  + Thêm nhân viên hỗ trợ
                </button>
              )}
            </div>
          </div>
        </section>

        {/* Section 5: Nhắc nhở & Chuẩn bị */}
        <section className="bg-white rounded-2xl border border-gray-200 p-4 shadow-theme-xs space-y-4">
          <div className="flex items-center justify-between border-b border-gray-100 pb-2.5">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-brand-500">notifications_active</span>
              <h2 className="text-body-lg-bold font-bold text-gray-900">
                5. Nhắc nhở & Chuẩn bị
              </h2>
            </div>
            <span className="text-label-xs text-success-700 bg-success-50 px-2 py-0.5 rounded-md font-medium">
              Bật thông báo
            </span>
          </div>

          <div>
            <label className="block text-label-xs uppercase text-gray-500 mb-1.5 font-medium tracking-wider">
              Thời điểm thông báo nhắc trước
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-warning-500">
                <span className="material-symbols-outlined">alarm</span>
              </div>
              <select
                value={reminderTime}
                onChange={(e) => setReminderTime(e.target.value)}
                className="w-full h-11 pl-10 pr-9 bg-white border border-gray-200 rounded-lg text-body-md text-gray-800 focus:border-brand-500 outline-none appearance-none"
              >
                <option value="15m">Trước 15 phút (Thông báo đẩy & Chuông)</option>
                <option value="30m">Trước 30 phút</option>
                <option value="1h">Trước 1 tiếng (Khuyến nghị)</option>
                <option value="1d">Trước 1 ngày</option>
              </select>
              <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none text-gray-400">
                <span className="material-symbols-outlined">expand_more</span>
              </div>
            </div>
          </div>

          {/* SMS / Zalo sync toggle */}
          <div className="flex items-center justify-between p-3 bg-gray-50 rounded-xl border border-gray-200">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-success-100 text-success-700 flex items-center justify-center shrink-0">
                <span className="material-symbols-outlined text-[18px]">sms</span>
              </div>
              <div>
                <p className="font-medium text-xs text-gray-900">Tự động gửi SMS / Zalo ZNS</p>
                <p className="text-label-xs text-gray-500">Gửi thiệp mời xác nhận lịch đến khách hàng</p>
              </div>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={autoSms}
                onChange={(e) => setAutoSms(e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-brand-500"></div>
            </label>
          </div>

          <div>
            <label className="block text-label-xs uppercase text-gray-500 mb-1.5 font-medium tracking-wider">
              Nội dung trao đổi & Tài liệu chuẩn bị
            </label>
            <textarea
              rows={3}
              value={noteContent}
              onChange={(e) => setNoteContent(e.target.value)}
              maxLength={500}
              placeholder="Nhập ghi chú chi tiết..."
              className="w-full p-3 bg-white border border-gray-200 rounded-lg text-body-md text-gray-800 focus:border-brand-500 outline-none resize-none"
            />
            <div className="flex justify-between items-center mt-1">
              <span className="text-label-xs text-gray-400">Tối đa 500 ký tự</span>
              <span className="text-label-xs text-brand-600 font-medium">
                {noteContent.length} / 500
              </span>
            </div>
          </div>
        </section>

        {/* Operational Assurance Alert */}
        <div className="flex items-start gap-2.5 p-3 rounded-xl bg-brand-50 border border-brand-200 text-brand-900">
          <span className="material-symbols-outlined text-brand-600 text-[20px] shrink-0 mt-0.5">
            info
          </span>
          <p className="text-label-xs text-brand-800 leading-relaxed">
            Lịch hẹn sau khi tạo sẽ tự động đồng bộ vào mục <strong>"Việc hôm nay"</strong> của Hạnh ★ và gửi lời nhắc trên lịch di động của ban quản lý STND.
          </p>
        </div>
      </main>

      {/* Bottom Sticky Action Bar */}
      <div className="fixed bottom-0 left-0 right-0 z-50 flex justify-center pointer-events-none">
        <div className="w-full max-w-[430px] bg-white/98 backdrop-blur-md border-t border-gray-200 px-4 py-3.5 shadow-theme-md pointer-events-auto flex items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            className="w-1/3 h-12 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700 font-medium text-xs flex items-center justify-center border border-gray-200 active:scale-95 transition-all"
          >
            Hủy bỏ
          </button>
          <button
            type="button"
            disabled={isSubmitting}
            onClick={handleConfirm}
            className="flex-1 h-12 rounded-lg bg-brand-500 hover:bg-brand-600 text-white font-medium text-xs flex items-center justify-center gap-2 shadow-theme-xs active:scale-95 transition-all disabled:opacity-75"
          >
            {isSubmitting ? (
              <>
                <span className="material-symbols-outlined animate-spin text-[20px]">
                  progress_activity
                </span>
                <span>Đang lưu lịch hẹn...</span>
              </>
            ) : (
              <>
                <span className="material-symbols-outlined text-[20px]">calendar_add_on</span>
                <span>Xác nhận tạo lịch hẹn</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
