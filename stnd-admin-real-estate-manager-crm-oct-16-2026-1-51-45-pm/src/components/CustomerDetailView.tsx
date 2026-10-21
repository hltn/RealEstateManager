import React, { useState } from 'react';
import { Customer, CareLog } from '../types/crm';

interface CustomerDetailViewProps {
  customer: Customer;
  careLogs: CareLog[];
  onAddCareLog: (log: Omit<CareLog, 'id'>) => void;
  onUpdateCustomer: (updated: Customer) => void;
  onNavigate: (view: string) => void;
  onOpenCall: (customer: Customer) => void;
  onOpenZalo: (customer: Customer) => void;
  onOpenLightbox: (index: number) => void;
}

export const CustomerDetailView: React.FC<CustomerDetailViewProps> = ({
  customer,
  careLogs,
  onAddCareLog,
  onUpdateCustomer,
  onNavigate,
  onOpenCall,
  onOpenZalo,
  onOpenLightbox
}) => {
  const [activeTab, setActiveTab] = useState<'info' | 'criteria' | 'logs'>('info');
  const [showFullPhone, setShowFullPhone] = useState(false);
  const [showFullCccd, setShowFullCccd] = useState(false);
  const [showStatusDropdown, setShowStatusDropdown] = useState(false);

  // Care log form state
  const [quickNote, setQuickNote] = useState('');
  const [callResult, setCallResult] = useState('Khách quan tâm giá / Cần gửi bảng tính ▾');
  const [nextReminder, setNextReminder] = useState('Hẹn gọi lại sau 2 ngày (07/10)');
  const [attachedPhotos, setAttachedPhotos] = useState<string[]>([
    "https://lh3.googleusercontent.com/aida-public/AB6AXuDCkIQ7mpQJYeZOfhKImqdppZDc42T0i_BqTEgN2vzUH1nBKPA3EGn44CdLIzxYkMYjfzzOeD0WA0qv-V0cTmz7XY-iaEm31XkjqoIu3nQDxfdDrX9ByKLjsYh51xcFjMNgP2QLm2ZWIhedDsGtPy3VEjjOAK3-XqiUpGIJsnRVo7IK0MSDNB5usMlgm1lXdwY5bJ7qpf05CEZpV_YndPT3V_LHuTqwTBQESZaLJPt5xlzVVt5ewM_q",
    "https://lh3.googleusercontent.com/aida-public/AB6AXuAf4k1eTRQ_rasaw_csXvRMxNKKk6t3bJEVr3Uk7lSdkohuaTUmDv5yTOxqXirk-eCbMAJfXLrzcKsPoiTudjwWqKJo9mnZekGl5tlAsWjU-aRKVwvzM8YtE7POxNqaQ1v54uzK6eF_YEkcp9UwptMh7v8pl9enWzqJLAbVgxv1U7XnBU-lUAcBIOQUxlnXkAbXs3Hk7_ZYNQYuY1LywJQqTPLiKOyHt_eJcW0P-jfQlo1IpB6S3nyK",
    "https://lh3.googleusercontent.com/aida-public/AB6AXuAif_fLJHL2Id7DnANFa2l7i9pFboGa2giZUmxZA9UKs4GD0rH42EoCWWPEzJrlxAyWmfKPXXolLtgnR5lL_r7oPTx24RyER1SCKO6BYU4etWYzxwy24HLuWQkguJNn7XztmNrY5xoFgJCqpSfocad53cPjWQKMmEpKENb9AjvqblZaidS-ELLE6Lnmi1RTsUPBTEd5x2a63Z_OA0_9HzURUeIffflPjyoQlyBWBSiZq16hF3tK0C5O",
    "https://lh3.googleusercontent.com/aida-public/AB6AXuC3nyHvTUFF-CfhjyIoPLcnTVPK1CR8KnOHZ9BsZQI_OwVNtZspX-WSxv_63cp231YR4pNgE36oHsPLJksGGtE3HzQzdxDy6NRNBsRNwhQ3Guc5Y1cKj_03X5sqWUIPkvVR15EUO_S5ZOgd4KndLONf2XvMfF31nPO9EU12eCt8Mm1FHYWXIiR2QPhPxWxkb1KWD3M99Be6kFcskR0iiJRGroC5WjJP9FEAkQpgRi8SJhaV-7Hgf_mJ",
    "https://lh3.googleusercontent.com/aida-public/AB6AXuDUSCl_2pIJKaIqC8KTTroN5GGz9Qmorv3RdLM4l7b6tyZGowa-etca7xZyux0Bm4XfF_2PcvCDTq5Mns88axMHyrkLylc_ZV66ntlB5svpT0mVSvMG48wAdY2VR-L2ahvbMYW6ahJLx3iKzvx5iQOUsH7uOVF29nVWY3YkvpIaD4PgSDuqrnU-WzTPHzCAmodfIEBYvoBsxgWnvVdKqmyCckAS8qT0oo5M_DFI1jkS0tMwwETGGxIo"
  ]);

  // C4 Criteria toggles
  const handleToggleC4 = (key: keyof Customer['c4Criteria']) => {
    const updated = { ...customer };
    updated.c4Criteria[key].achieved = !updated.c4Criteria[key].achieved;

    // Recalculate percent
    const count = Object.values(updated.c4Criteria).filter((c) => c.achieved).length;
    updated.progressPercentage = count * 25;
    onUpdateCustomer(updated);
  };

  const handleSaveLog = (e: React.FormEvent) => {
    e.preventDefault();
    if (!quickNote.trim()) return;

    onAddCareLog({
      customerId: customer.id,
      author: 'Hạnh ★ (Chính)',
      authorRole: 'Trưởng nhóm kinh doanh',
      date: new Date().toLocaleDateString('vi-VN', {
        day: '2-digit',
        month: '2-digit'
      }) + ' ' + new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }),
      content: quickNote,
      callResult,
      tag: 'Cập nhật mới',
      images: attachedPhotos.map((src, idx) => ({
        src,
        caption: `Hình ảnh đính kèm ${idx + 1}`
      }))
    });

    setQuickNote('');
    alert('Đã thêm nhật ký chăm sóc thành công!');
  };

  const handleStatusChange = (newStatus: Customer['status']) => {
    onUpdateCustomer({ ...customer, status: newStatus });
    setShowStatusDropdown(false);
  };

  const c4Count = Object.values(customer.c4Criteria).filter((c) => c.achieved).length;

  return (
    <div className="space-y-6">
      {/* 1. BREADCRUMB & CLIENT HEADER CARD */}
      <div className="space-y-3">
        {/* Breadcrumb Navigation */}
        <nav className="flex items-center gap-2 text-xs text-gray-500">
          <button
            onClick={() => onNavigate('customers')}
            className="hover:text-brand-500 transition-colors"
          >
            Quản lý khách hàng
          </button>
          <span className="material-symbols-outlined text-xs text-gray-400">chevron_right</span>
          <button
            onClick={() => onNavigate('customers')}
            className="hover:text-brand-500 transition-colors"
          >
            Danh sách khách hàng
          </button>
          <span className="material-symbols-outlined text-xs text-gray-400">chevron_right</span>
          <span className="font-semibold text-gray-900">{customer.name}</span>
        </nav>

        {/* Customer Main Banner Card */}
        <div className="bg-surface-container-lowest border border-gray-200 rounded-2xl p-5 shadow-theme-sm flex flex-col xl:flex-row xl:items-center justify-between gap-5">
          {/* Left Group: Avatar + Details */}
          <div className="flex flex-wrap items-center gap-4">
            {/* Large Avatar */}
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-brand-50 to-brand-100 border border-brand-200 flex items-center justify-center text-brand-600 font-bold text-xl shadow-theme-xs">
              {customer.name
                .split(' ')
                .map((n) => n[0])
                .slice(-2)
                .join('')}
            </div>

            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2.5">
                <h1 className="font-title-lg text-2xl font-bold text-gray-900 tracking-tight">
                  {customer.name}
                </h1>

                {/* VIP badge */}
                {customer.isVip && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-purple-100 text-purple-800 border border-purple-200">
                    <span
                      className="material-symbols-outlined text-xs"
                      style={{ fontVariationSettings: "'FILL' 1" }}
                    >
                      stars
                    </span>
                    {customer.vipTier || 'VIP Platinum'}
                  </span>
                )}

                {/* Status Dropdown */}
                <div className="relative inline-block">
                  <button
                    onClick={() => setShowStatusDropdown(!showStatusDropdown)}
                    className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100/70 transition-colors"
                  >
                    <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                    <span>{customer.status}</span>
                    <span className="material-symbols-outlined text-[14px]">expand_more</span>
                  </button>

                  {showStatusDropdown && (
                    <div className="absolute left-0 top-8 mt-1 w-44 bg-white border border-gray-200 rounded-xl shadow-theme-md p-1 z-30">
                      {(['Có quan tâm', 'Khách net', 'Chưa tiếp cận', 'Bỏ / Không nhu cầu'] as const).map(
                        (st) => (
                          <button
                            key={st}
                            onClick={() => handleStatusChange(st)}
                            className={`w-full text-left px-3 py-1.5 text-xs rounded-lg transition-colors flex items-center gap-2 ${
                              customer.status === st
                                ? 'bg-brand-50 text-brand-600 font-bold'
                                : 'hover:bg-gray-50 text-gray-700'
                            }`}
                          >
                            <span
                              className={`w-2 h-2 rounded-full ${
                                st === 'Có quan tâm'
                                  ? 'bg-emerald-500'
                                  : st === 'Khách net'
                                  ? 'bg-amber-500'
                                  : 'bg-gray-400'
                              }`}
                            ></span>
                            {st}
                          </button>
                        )
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Phone & Care Team */}
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-gray-600 pt-0.5">
                {/* Phone with toggle */}
                <div className="flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-gray-400 text-[18px]">call</span>
                  <span className="font-medium tracking-wide text-gray-800">
                    {showFullPhone
                      ? customer.phone
                      : customer.phone.substring(0, 8) + ' •••'}
                  </span>
                  <button
                    onClick={() => setShowFullPhone(!showFullPhone)}
                    className="ml-1 text-xs text-brand-500 hover:text-brand-600 font-medium inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded hover:bg-brand-50 transition-colors"
                    title={showFullPhone ? 'Ẩn số điện thoại' : 'Hiện số đầy đủ'}
                  >
                    <span className="material-symbols-outlined text-xs">
                      {showFullPhone ? 'visibility_off' : 'visibility'}
                    </span>
                    {showFullPhone ? 'Ẩn số' : 'Hiện số'}
                  </button>
                </div>

                {/* Nhóm chăm sóc */}
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-400 uppercase font-medium">Nhóm chăm sóc:</span>
                  <div className="flex items-center -space-x-2">
                    <div
                      className="w-7 h-7 rounded-full bg-amber-100 border-2 border-white flex items-center justify-center text-amber-700 text-xs font-bold ring-1 ring-amber-300"
                      title="Hạnh (Chính)"
                    >
                      H
                    </div>
                    <div
                      className="w-7 h-7 rounded-full bg-blue-100 border-2 border-white flex items-center justify-center text-blue-700 text-xs font-bold"
                      title="Thảo"
                    >
                      T
                    </div>
                    <div
                      className="w-7 h-7 rounded-full bg-emerald-100 border-2 border-white flex items-center justify-center text-emerald-700 text-xs font-bold"
                      title="Tuấn"
                    >
                      T
                    </div>
                  </div>
                  <span className="text-xs font-medium text-gray-700">
                    <strong className="text-amber-600 font-semibold">★ Hạnh (Chính)</strong>, Thảo,
                    Tuấn ({customer.teamGroup || 'Nhóm C8'})
                  </span>
                  <button
                    onClick={() => alert('Thêm chuyên viên phối hợp chăm sóc khách hàng')}
                    className="text-xs text-gray-500 hover:text-brand-500 px-1.5 py-0.5 rounded border border-dashed border-gray-300 hover:border-brand-500 transition-colors flex items-center gap-0.5"
                  >
                    <span className="material-symbols-outlined text-[13px]">add</span>
                    Thêm người
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Right Action Buttons */}
          <div className="flex items-center gap-3 self-end xl:self-center">
            <button
              onClick={() => onOpenZalo(customer)}
              className="h-10 px-5 rounded-lg bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white font-medium text-sm flex items-center gap-2 shadow-theme-xs transition-all duration-150"
            >
              <span className="material-symbols-outlined text-[18px]">chat_bubble</span>
              Nhắn Zalo
            </button>

            <button
              onClick={() => onOpenCall(customer)}
              className="h-10 px-5 rounded-lg bg-brand-500 hover:bg-brand-600 active:scale-95 text-white font-medium text-sm flex items-center gap-2 shadow-theme-xs transition-all duration-150"
            >
              <span className="material-symbols-outlined text-[18px]">call</span>
              Gọi ngay
            </button>

            <button
              onClick={() => onNavigate('create_appointment')}
              className="w-10 h-10 rounded-lg border border-gray-200 hover:bg-gray-50 flex items-center justify-center text-gray-600 transition-colors shadow-theme-xs"
              title="Đặt lịch hẹn gặp khách"
            >
              <span className="material-symbols-outlined text-[20px]">calendar_month</span>
            </button>
          </div>
        </div>
      </div>

      {/* 2. TAB NAVIGATOR (SCREEN_22 Spec) */}
      <div className="bg-surface-container-lowest border border-gray-200 rounded-2xl p-1.5 shadow-theme-xs">
        <div className="grid grid-cols-3 gap-2" role="tablist">
          {/* Tab 1: Thông tin & Chân dung */}
          <button
            onClick={() => setActiveTab('info')}
            className={`tab-button flex items-center justify-center gap-2.5 py-3 px-4 rounded-xl font-medium text-sm transition-all duration-150 ${
              activeTab === 'info'
                ? 'bg-brand-50 text-brand-600 border border-brand-200 shadow-theme-xs font-semibold'
                : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
            }`}
          >
            <span
              className={`material-symbols-outlined text-[20px] ${
                activeTab === 'info' ? 'text-brand-600' : 'text-gray-400'
              }`}
            >
              account_circle
            </span>
            <span>Thông tin &amp; Chân dung</span>
          </button>

          {/* Tab 2: Tiến độ & 4 Tiêu chí */}
          <button
            onClick={() => setActiveTab('criteria')}
            className={`tab-button flex items-center justify-center gap-2.5 py-3 px-4 rounded-xl font-medium text-sm transition-all duration-150 ${
              activeTab === 'criteria'
                ? 'bg-brand-50 text-brand-600 border border-brand-200 shadow-theme-xs font-semibold'
                : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
            }`}
          >
            <span
              className={`material-symbols-outlined text-[20px] ${
                activeTab === 'criteria' ? 'text-brand-600' : 'text-gray-400'
              }`}
            >
              checklist
            </span>
            <span>Tiến độ &amp; 4 Tiêu chí</span>
            <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-amber-100 text-amber-700 border border-amber-200">
              {customer.progressPercentage}%
            </span>
          </button>

          {/* Tab 3: Nhật ký chăm sóc */}
          <button
            onClick={() => setActiveTab('logs')}
            className={`tab-button flex items-center justify-center gap-2.5 py-3 px-4 rounded-xl font-medium text-sm transition-all duration-150 ${
              activeTab === 'logs'
                ? 'bg-brand-50 text-brand-600 border border-brand-200 shadow-theme-xs font-semibold'
                : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
            }`}
          >
            <span
              className={`material-symbols-outlined text-[20px] ${
                activeTab === 'logs' ? 'text-brand-600' : 'text-gray-400'
              }`}
            >
              history
            </span>
            <span>Nhật ký chăm sóc</span>
            <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-gray-100 text-gray-700">
              {careLogs.length}
            </span>
          </button>
        </div>
      </div>

      {/* 3. TAB CONTENT PANELS */}

      {/* TAB PANEL 1: THÔNG TIN & CHÂN DUNG */}
      {activeTab === 'info' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start animate-in fade-in duration-200">
          {/* Card 1: Chân dung khách hàng (C10) */}
          <div className="bg-surface-container-lowest border border-gray-200 rounded-2xl p-6 shadow-theme-xs space-y-6">
            <div className="flex items-center justify-between pb-3.5 border-b border-gray-100">
              <div className="flex items-center gap-2.5">
                <span className="w-8 h-8 rounded-lg bg-brand-50 text-brand-600 flex items-center justify-center">
                  <span className="material-symbols-outlined text-[18px]">badge</span>
                </span>
                <h2 className="text-base font-bold text-gray-900">
                  Chân dung khách hàng (C10)
                </h2>
              </div>
              <button
                onClick={() => onNavigate('edit_persona')}
                className="text-xs font-medium text-brand-500 hover:text-brand-600 flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-brand-200 hover:bg-brand-50 transition-colors"
              >
                <span className="material-symbols-outlined text-[14px]">edit</span>
                Sửa
              </button>
            </div>

            {/* Nhóm Cá nhân & Dịp đặc biệt */}
            <div className="space-y-3">
              <div className="text-[11px] font-bold uppercase tracking-wider text-gray-400">
                Cá nhân &amp; Dịp đặc biệt
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="p-3 rounded-xl bg-gray-50/70 border border-gray-100">
                  <span className="text-xs text-gray-500 block mb-0.5">Ngày sinh</span>
                  <span className="font-semibold text-gray-900">{customer.birthDate}</span>
                </div>
                <div className="p-3 rounded-xl bg-gray-50/70 border border-gray-100">
                  <span className="text-xs text-gray-500 block mb-0.5">Quê quán</span>
                  <span className="font-semibold text-gray-900">{customer.hometown}</span>
                </div>
                <div className="p-3 rounded-xl bg-gray-50/70 border border-gray-100 col-span-2">
                  <span className="text-xs text-gray-500 block mb-0.5">Nơi ở hiện tại</span>
                  <span className="font-semibold text-gray-900">{customer.currentResidence}</span>
                </div>
                <div className="p-3 rounded-xl bg-gray-50/70 border border-gray-100 col-span-2 flex items-center justify-between">
                  <div>
                    <span className="text-xs text-gray-500 block mb-0.5">CCCD / Định danh</span>
                    <span className="font-semibold text-gray-900 tracking-wider font-mono">
                      {showFullCccd ? customer.idNumber : '•••• 1234 (4 số cuối)'}
                    </span>
                  </div>
                  <button
                    onClick={() => setShowFullCccd(!showFullCccd)}
                    className="text-xs text-brand-500 hover:text-brand-600 font-medium flex items-center gap-1 px-2.5 py-1 rounded bg-white border border-gray-200 shadow-theme-xs hover:bg-gray-50 transition-colors"
                  >
                    <span className="material-symbols-outlined text-xs">
                      {showFullCccd ? 'visibility_off' : 'visibility'}
                    </span>
                    {showFullCccd ? 'Ẩn' : 'Hiện'}
                  </button>
                </div>
              </div>
            </div>

            {/* Nhóm Nghề nghiệp & Gia cảnh */}
            <div className="space-y-3 pt-1">
              <div className="text-[11px] font-bold uppercase tracking-wider text-gray-400">
                Nghề nghiệp &amp; Gia cảnh
              </div>
              <div className="space-y-2.5 text-sm">
                <div className="p-3.5 rounded-xl bg-gray-50/70 border border-gray-100 space-y-1">
                  <div className="text-xs text-gray-500">Nghề nghiệp / Vị trí</div>
                  <div className="font-medium text-gray-900 flex items-center gap-2">
                    <span className="material-symbols-outlined text-brand-500 text-base">work</span>
                    {customer.occupation}
                  </div>
                </div>
                <div className="p-3.5 rounded-xl bg-gray-50/70 border border-gray-100 space-y-1">
                  <div className="text-xs text-gray-500">Người quyết định &amp; Gia cảnh</div>
                  <div className="font-medium text-gray-900 flex items-center gap-2">
                    <span className="material-symbols-outlined text-brand-500 text-base">
                      family_restroom
                    </span>
                    {customer.decisionMaker}; Có {customer.children}
                  </div>
                </div>
              </div>
            </div>

            {/* Sở thích & Lối sống (C11) */}
            <div className="space-y-3 pt-1">
              <div className="text-[11px] font-bold uppercase tracking-wider text-gray-400">
                Sở thích &amp; Lối sống (C11)
              </div>
              <div className="flex flex-wrap gap-2">
                {customer.lifestyleTags.map((tag, idx) => (
                  <span
                    key={idx}
                    className="px-3 py-1.5 rounded-full text-xs font-medium bg-brand-50 text-brand-600 border border-brand-100"
                  >
                    {tag}
                  </span>
                ))}
              </div>
              <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 flex items-center gap-2.5 text-xs text-amber-800">
                <span className="material-symbols-outlined text-[18px] text-amber-500 shrink-0">
                  schedule
                </span>
                <span>
                  <strong>Khung giờ rảnh:</strong> {customer.freeTimeSlot}
                </span>
              </div>
            </div>
          </div>

          {/* Card 2: Thông tin đầu tư */}
          <div className="bg-surface-container-lowest border border-gray-200 rounded-2xl p-6 shadow-theme-xs space-y-6">
            <div className="flex items-center justify-between pb-3.5 border-b border-gray-100">
              <div className="flex items-center gap-2.5">
                <span className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center">
                  <span className="material-symbols-outlined text-[18px]">real_estate_agent</span>
                </span>
                <h2 className="text-base font-bold text-gray-900">Thông tin đầu tư</h2>
              </div>
              <button
                onClick={() => onNavigate('edit_investment')}
                className="text-xs font-medium text-brand-500 hover:text-brand-600 flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-brand-200 hover:bg-brand-50 transition-colors"
              >
                <span className="material-symbols-outlined text-[14px]">edit</span>
                Sửa
              </button>
            </div>

            {/* Dự án quan tâm */}
            <div className="space-y-2">
              <div className="text-[11px] font-bold uppercase tracking-wider text-gray-400">
                Dự án quan tâm
              </div>
              <div className="flex flex-wrap gap-2">
                {customer.interestedProjects.map((p, i) => (
                  <span
                    key={i}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 ${
                      i === 0
                        ? 'bg-brand-50 text-brand-600 border border-brand-200'
                        : 'bg-gray-100 text-gray-700 border border-gray-200'
                    }`}
                  >
                    {i === 0 && <span className="w-2 h-2 rounded-full bg-brand-500"></span>}
                    {p}
                  </span>
                ))}
              </div>
            </div>

            {/* Tài chính & Ngân sách */}
            <div className="p-4 rounded-xl bg-gray-50 border border-gray-100 space-y-2.5">
              <div className="text-[11px] font-bold uppercase tracking-wider text-gray-400">
                Tài chính &amp; Ngân sách
              </div>
              <div className="flex items-baseline justify-between">
                <span className="text-xs text-gray-500">Ngân sách dự kiến:</span>
                <span className="text-lg font-bold text-brand-600">
                  {customer.budgetMin} – {customer.budgetMax} tỷ VNĐ
                </span>
              </div>
              <div className="flex items-baseline justify-between text-xs">
                <span className="text-gray-500">Vốn tự có sẵn:</span>
                <span className="font-semibold text-gray-800">{customer.equityRatio}</span>
              </div>
              {customer.loanIncentive && (
                <div className="text-[11px] text-gray-600 pt-2 border-t border-gray-200/60 flex items-start gap-1.5">
                  <span className="material-symbols-outlined text-[15px] text-brand-500 mt-0.5">
                    info
                  </span>
                  <span>Cần gói hỗ trợ lãi suất &amp; ân hạn nợ gốc từ ngân hàng đối tác.</span>
                </div>
              )}
            </div>

            {/* Nhu cầu & Tiêu chí BĐS */}
            <div className="space-y-3 text-sm">
              <div className="text-[11px] font-bold uppercase tracking-wider text-gray-400">
                Nhu cầu &amp; Tiêu chí BĐS
              </div>
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="p-3 rounded-xl bg-gray-50 border border-gray-100">
                  <span className="text-gray-400 block mb-0.5">Loại hình:</span>
                  <span className="font-semibold text-gray-800 text-sm">
                    {customer.propertyType}
                  </span>
                </div>
                <div className="p-3 rounded-xl bg-gray-50 border border-gray-100">
                  <span className="text-gray-400 block mb-0.5">Cơ cấu:</span>
                  <span className="font-semibold text-gray-800 text-sm">
                    {customer.bedroomType}
                  </span>
                </div>
              </div>

              <div className="space-y-1.5 pt-1">
                <span className="text-xs text-gray-500 block">Mục đích mua:</span>
                <div className="flex flex-wrap gap-1.5 text-xs">
                  {customer.purchasePurposes.map((m, i) => (
                    <span
                      key={i}
                      className="px-2.5 py-1 rounded-md bg-purple-50 text-purple-700 border border-purple-100 font-medium"
                    >
                      #{m}
                    </span>
                  ))}
                </div>
              </div>

              <div className="space-y-1.5 pt-1">
                <span className="text-xs text-gray-500 block">Tiêu chí ưu tiên:</span>
                <div className="flex flex-wrap gap-1.5 text-xs">
                  {customer.criteriaPriorities.map((c, i) => (
                    <span
                      key={i}
                      className="px-2.5 py-1 rounded-md bg-gray-100 text-gray-700 font-medium"
                    >
                      {c}
                    </span>
                  ))}
                </div>
              </div>

              {/* Khu vực */}
              <div className="p-3 rounded-xl bg-gray-50 border border-gray-100 space-y-1 text-xs">
                <div className="text-gray-400">Khu vực &amp; Địa bàn tìm kiếm:</div>
                <div className="font-semibold text-gray-800">
                  {customer.searchArea} • {customer.specificLocation}
                </div>
              </div>

              {/* Nguồn & Thời điểm chốt */}
              <div className="pt-2 border-t border-gray-100 flex items-center justify-between text-xs text-gray-600">
                <span>
                  Nguồn: <strong>{customer.leadSource}</strong>
                </span>
                <span className="text-brand-600 font-medium">
                  Mua/chốt: <strong>{customer.targetPurchaseTime}</strong>
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB PANEL 2: TIẾN ĐỘ & 4 TIÊU CHÍ (C4) */}
      {activeTab === 'criteria' && (
        <div className="max-w-4xl mx-auto space-y-6 animate-in fade-in duration-200">
          <div className="bg-surface-container-lowest border border-gray-200 rounded-2xl p-6 shadow-theme-xs space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3.5 border-b border-gray-100 gap-4">
              <div className="flex items-center gap-2.5">
                <span className="w-8 h-8 rounded-lg bg-brand-50 text-brand-600 flex items-center justify-center">
                  <span className="material-symbols-outlined text-[20px]">checklist</span>
                </span>
                <div>
                  <h2 className="text-base font-bold text-gray-900">
                    4 Tiêu chí chốt Deal (C4)
                  </h2>
                  <p className="text-xs text-gray-500">
                    Mô hình đánh giá chuẩn 4 tiêu chí sàng lọc khách hàng tiềm năng STND
                  </p>
                </div>
              </div>
              <button
                onClick={() =>
                  alert('Bấm trực tiếp vào các thẻ tiêu chí bên dưới để chuyển đổi trạng thái Đạt / Chưa đạt!')
                }
                className="py-2 px-3 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-700 text-xs font-medium flex items-center gap-1.5 transition-colors shadow-theme-xs shrink-0"
              >
                <span className="material-symbols-outlined text-sm">check_circle</span>
                Hướng dẫn đánh giá C4
              </button>
            </div>

            {/* Thanh tiến độ tổng quan */}
            <div className="p-4 rounded-xl bg-brand-50/60 border border-brand-100 space-y-2.5">
              <div className="flex items-center justify-between text-sm">
                <span className="font-semibold text-gray-800">Mức độ đạt chuẩn</span>
                <span className="font-bold text-brand-600 text-base">
                  {customer.progressPercentage}% Đạt ({c4Count}/4)
                </span>
              </div>
              <div className="w-full h-3 bg-gray-200 rounded-full overflow-hidden">
                <div
                  className="h-full bg-brand-500 rounded-full transition-all duration-300"
                  style={{ width: `${customer.progressPercentage}%` }}
                ></div>
              </div>
              <p className="text-xs text-gray-600 italic">
                {customer.progressPercentage < 75
                  ? 'Khách hàng cần làm rõ thêm Động cơ và Thời gian chốt hợp đồng.'
                  : 'Khách hàng đủ điều kiện ưu tiên hỗ trợ chọn căn tầng đẹp và chính sách chiết khấu cao!'}
              </p>
            </div>

            {/* 4 Tiêu chí cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* 1. Nhu cầu */}
              <div
                onClick={() => handleToggleC4('demand')}
                className={`p-4 rounded-xl border cursor-pointer transition-all ${
                  customer.c4Criteria.demand.achieved
                    ? 'border-emerald-200 bg-emerald-50/40 hover:bg-emerald-50/60'
                    : 'border-gray-200 bg-gray-50/60 hover:bg-gray-100'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span
                      className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shadow-theme-xs ${
                        customer.c4Criteria.demand.achieved
                          ? 'bg-emerald-500 text-white'
                          : 'border border-gray-300 text-gray-400 bg-white'
                      }`}
                    >
                      {customer.c4Criteria.demand.achieved ? '✓' : '○'}
                    </span>
                    <span className="text-sm font-bold text-gray-900">1. Nhu cầu</span>
                  </div>
                  <span
                    className={`px-2 py-0.5 rounded text-xs font-bold ${
                      customer.c4Criteria.demand.achieved
                        ? 'bg-emerald-100 text-emerald-700 border border-emerald-200'
                        : 'bg-gray-200 text-gray-600'
                    }`}
                  >
                    {customer.c4Criteria.demand.achieved ? '25% • Đạt' : 'Chưa đạt'}
                  </span>
                </div>
                <p className="text-xs text-gray-700 pl-8 leading-relaxed mt-2">
                  {customer.c4Criteria.demand.text}
                </p>
              </div>

              {/* 2. Động cơ */}
              <div
                onClick={() => handleToggleC4('motivation')}
                className={`p-4 rounded-xl border cursor-pointer transition-all ${
                  customer.c4Criteria.motivation.achieved
                    ? 'border-emerald-200 bg-emerald-50/40 hover:bg-emerald-50/60'
                    : 'border-gray-200 bg-gray-50/60 hover:bg-gray-100'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span
                      className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shadow-theme-xs ${
                        customer.c4Criteria.motivation.achieved
                          ? 'bg-emerald-500 text-white'
                          : 'border border-gray-300 text-gray-400 bg-white'
                      }`}
                    >
                      {customer.c4Criteria.motivation.achieved ? '✓' : '○'}
                    </span>
                    <span className="text-sm font-bold text-gray-900">2. Động cơ</span>
                  </div>
                  <span
                    className={`px-2 py-0.5 rounded text-xs font-bold ${
                      customer.c4Criteria.motivation.achieved
                        ? 'bg-emerald-100 text-emerald-700 border border-emerald-200'
                        : 'bg-gray-200 text-gray-600'
                    }`}
                  >
                    {customer.c4Criteria.motivation.achieved ? '25% • Đạt' : 'Chưa đạt'}
                  </span>
                </div>
                <p className="text-xs text-gray-700 pl-8 leading-relaxed mt-2">
                  {customer.c4Criteria.motivation.text}
                </p>
              </div>

              {/* 3. Tài chính */}
              <div
                onClick={() => handleToggleC4('finance')}
                className={`p-4 rounded-xl border cursor-pointer transition-all ${
                  customer.c4Criteria.finance.achieved
                    ? 'border-emerald-200 bg-emerald-50/40 hover:bg-emerald-50/60'
                    : 'border-gray-200 bg-gray-50/60 hover:bg-gray-100'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span
                      className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shadow-theme-xs ${
                        customer.c4Criteria.finance.achieved
                          ? 'bg-emerald-500 text-white'
                          : 'border border-gray-300 text-gray-400 bg-white'
                      }`}
                    >
                      {customer.c4Criteria.finance.achieved ? '✓' : '○'}
                    </span>
                    <span className="text-sm font-bold text-gray-900">3. Tài chính</span>
                  </div>
                  <span
                    className={`px-2 py-0.5 rounded text-xs font-bold ${
                      customer.c4Criteria.finance.achieved
                        ? 'bg-emerald-100 text-emerald-700 border border-emerald-200'
                        : 'bg-gray-200 text-gray-600'
                    }`}
                  >
                    {customer.c4Criteria.finance.achieved ? '25% • Đạt' : 'Chưa đạt'}
                  </span>
                </div>
                <p className="text-xs text-gray-700 pl-8 leading-relaxed mt-2">
                  {customer.c4Criteria.finance.text}
                </p>
              </div>

              {/* 4. Thời gian chốt */}
              <div
                onClick={() => handleToggleC4('timing')}
                className={`p-4 rounded-xl border cursor-pointer transition-all ${
                  customer.c4Criteria.timing.achieved
                    ? 'border-emerald-200 bg-emerald-50/40 hover:bg-emerald-50/60'
                    : 'border-gray-200 bg-gray-50/60 hover:bg-gray-100'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span
                      className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shadow-theme-xs ${
                        customer.c4Criteria.timing.achieved
                          ? 'bg-emerald-500 text-white'
                          : 'border border-gray-300 text-gray-400 bg-white'
                      }`}
                    >
                      {customer.c4Criteria.timing.achieved ? '✓' : '○'}
                    </span>
                    <span className="text-sm font-bold text-gray-900">4. Thời gian chốt</span>
                  </div>
                  <span
                    className={`px-2 py-0.5 rounded text-xs font-bold ${
                      customer.c4Criteria.timing.achieved
                        ? 'bg-emerald-100 text-emerald-700 border border-emerald-200'
                        : 'bg-gray-200 text-gray-600'
                    }`}
                  >
                    {customer.c4Criteria.timing.achieved ? '25% • Đạt' : 'Chưa đạt'}
                  </span>
                </div>
                <p className="text-xs text-gray-700 pl-8 leading-relaxed mt-2">
                  {customer.c4Criteria.timing.text}
                </p>
              </div>
            </div>
          </div>

          {/* Quy chuẩn đánh giá C4 */}
          <div className="p-4 rounded-2xl bg-surface-container-lowest border border-gray-200 shadow-theme-xs space-y-2">
            <div className="flex items-center gap-2 text-brand-600">
              <span className="material-symbols-outlined text-base">shield</span>
              <span className="text-xs font-bold uppercase tracking-wider">
                Quy chuẩn đánh giá C4 độc quyền STND
              </span>
            </div>
            <p className="text-xs text-gray-600 leading-relaxed">
              Để nâng mức xếp hạng khách hàng từ <strong>VIP Gold</strong> lên{' '}
              <strong>VIP Diamond / Ký HĐMB</strong>, chuyên viên tư vấn cần đạt tối thiểu 75% tiêu
              chí C4 (3/4 đạt).
            </p>
          </div>
        </div>
      )}

      {/* TAB PANEL 3: NHẬT KÝ CHĂM SÓC */}
      {activeTab === 'logs' && (
        <div className="max-w-4xl mx-auto space-y-6 animate-in fade-in duration-200">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* Left Col: Form "Thêm nhật ký chăm sóc" (5 cols) */}
            <div className="lg:col-span-5 space-y-5">
              <form
                onSubmit={handleSaveLog}
                className="bg-surface-container-lowest border border-gray-200 rounded-2xl p-5 shadow-theme-xs space-y-4"
              >
                <div className="flex items-center justify-between pb-3 border-b border-gray-100">
                  <div className="flex items-center gap-2">
                    <span className="w-8 h-8 rounded-lg bg-brand-50 text-brand-600 flex items-center justify-center">
                      <span className="material-symbols-outlined text-[18px]">chat</span>
                    </span>
                    <h2 className="font-bold text-sm text-gray-900 uppercase tracking-wide">
                      Thêm nhật ký chăm sóc
                    </h2>
                  </div>
                  <span className="text-[10px] text-gray-400 font-medium">Cập nhật 2h trước</span>
                </div>

                {/* Quick note textarea */}
                <div>
                  <textarea
                    rows={3}
                    value={quickNote}
                    onChange={(e) => setQuickNote(e.target.value)}
                    placeholder="Ghi chú nhanh nội dung trao đổi, kết quả cuộc gọi, phản hồi từ khách..."
                    className="w-full p-3 text-xs bg-gray-50/70 border border-gray-200 rounded-xl focus:outline-none focus:border-brand-500 focus:bg-white resize-none transition-all"
                  />
                </div>

                {/* Outcome & Reminder */}
                <div className="space-y-3">
                  <div>
                    <label className="block text-[11px] font-semibold text-gray-500 uppercase mb-1">
                      Kết quả liên hệ
                    </label>
                    <select
                      value={callResult}
                      onChange={(e) => setCallResult(e.target.value)}
                      className="w-full h-9 px-2.5 text-xs bg-white border border-gray-200 rounded-lg text-gray-700 focus:outline-none focus:border-brand-500 shadow-theme-xs"
                    >
                      <option value="Khách quan tâm giá / Cần gửi bảng tính ▾">
                        Khách quan tâm giá / Cần gửi bảng tính ▾
                      </option>
                      <option value="Hẹn xem sa bàn & nhà mẫu">Hẹn xem sa bàn &amp; nhà mẫu</option>
                      <option value="Bận gọi lại sau">Bận gọi lại sau</option>
                      <option value="Cần tư vấn thêm gói vay 40%">
                        Cần tư vấn thêm gói vay 40%
                      </option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-gray-500 uppercase mb-1">
                      Nhắc việc tiếp theo
                    </label>
                    <div className="relative">
                      <input
                        type="text"
                        value={nextReminder}
                        onChange={(e) => setNextReminder(e.target.value)}
                        className="w-full h-9 pl-8 pr-3 text-xs bg-white border border-gray-200 rounded-lg text-gray-700 focus:outline-none focus:border-brand-500 font-medium shadow-theme-xs"
                      />
                      <span className="material-symbols-outlined text-[15px] text-gray-400 absolute left-2.5 top-2.5">
                        event
                      </span>
                    </div>
                  </div>
                </div>

                {/* Photo attachments strip */}
                <div className="space-y-2 pt-2 border-t border-gray-100">
                  <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-1.5 text-emerald-600 font-medium">
                      <span className="material-symbols-outlined text-sm">check_circle</span>
                      <span>Đã chọn {attachedPhotos.length} ảnh</span>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        setAttachedPhotos([
                          ...attachedPhotos,
                          'https://lh3.googleusercontent.com/aida-public/AB6AXuC5InvsZp7ETa2o4XFSOxeaNbrAiNM7v1xkwsAMFDwkVpetCEIFV_BNm5FNHdLdTPsWYUUzNRDXVXd-kqS_JC8M-BnLMfMXpfMsU5QzIS1G2VtjbImom2DmCDqVRE53iZKuzNgGKQn_on5iKcpD_jhI3M0zLgnDNERwv1qj5_sAKOZ6FC796IJg1-TlsKlJfxIt3W2nh564a17HRsL_VmGuaEUyCV6soPJ0r7lU0D0R3O8IpHwAEjuh'
                        ])
                      }
                      className="text-brand-600 hover:text-brand-700 font-medium text-xs flex items-center gap-1"
                    >
                      <span className="material-symbols-outlined text-xs">add_photo_alternate</span>
                      Đính kèm
                    </button>
                  </div>

                  {/* Horizontal Scroll of Photos */}
                  <div className="flex items-center gap-2 overflow-x-auto pb-1 custom-scrollbar">
                    {attachedPhotos.map((img, idx) => (
                      <div
                        key={idx}
                        className="relative w-14 h-14 rounded-xl overflow-hidden border border-gray-200 shrink-0 group shadow-theme-xs"
                      >
                        <img src={img} alt="" className="w-full h-full object-cover" />
                        <button
                          type="button"
                          onClick={() =>
                            setAttachedPhotos(attachedPhotos.filter((_, i) => i !== idx))
                          }
                          className="absolute top-1 right-1 w-4 h-4 bg-gray-900/80 hover:bg-rose-500 text-white rounded-full flex items-center justify-center text-[10px] cursor-pointer transition-colors"
                          title="Xóa ảnh"
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                </div>

                <button
                  type="submit"
                  className="w-full h-10 rounded-lg bg-brand-500 hover:bg-brand-600 active:scale-[0.99] text-white font-medium text-sm flex items-center justify-center gap-2 shadow-theme-xs transition-all"
                >
                  <span className="material-symbols-outlined text-[18px]">save</span>
                  Lưu nhật ký chăm sóc
                </button>
              </form>

              {/* STND AI Hint Box */}
              <div className="p-4 rounded-xl bg-amber-50/70 border border-amber-200 flex items-start gap-3 shadow-theme-xs">
                <div className="w-9 h-9 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center shrink-0 shadow-theme-xs">
                  <span className="material-symbols-outlined text-lg">lightbulb</span>
                </div>
                <div className="flex-1 text-xs space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-gray-900 uppercase tracking-wide text-[11px]">
                      Gợi ý bước tiếp theo
                    </span>
                    <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 text-[10px] font-semibold border border-amber-200">
                      STND AI
                    </span>
                  </div>
                  <p className="text-gray-800 leading-relaxed text-xs">
                    &quot;Gửi cập nhật tiến độ pháp lý đợt 2, thử gọi lại sau <strong>19h</strong> (khung
                    giờ rảnh).&quot;
                  </p>
                </div>
              </div>
            </div>

            {/* Right Col: Timeline (7 cols) */}
            <div className="lg:col-span-7">
              <div className="bg-surface-container-lowest border border-gray-200 rounded-2xl p-6 shadow-theme-xs space-y-4">
                <div className="flex items-center justify-between pb-3 border-b border-gray-100">
                  <div className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-brand-500">timeline</span>
                    <h3 className="font-bold text-base text-gray-900 uppercase tracking-wide">
                      Dòng thời gian tương tác
                    </h3>
                  </div>
                  <span className="text-xs text-gray-500 font-medium flex items-center gap-1">
                    <span className="material-symbols-outlined text-xs text-gray-400">
                      unfold_more
                    </span>
                    Cuộn để xem tiếp
                  </span>
                </div>

                {/* Timeline scroll container */}
                <div className="overflow-y-auto max-h-[640px] pr-2 custom-scrollbar">
                  <div className="relative pl-6 space-y-6 before:absolute before:left-2 before:top-2 before:bottom-2 before:w-0.5 before:bg-gray-200">
                    {careLogs.map((log, idx) => (
                      <div key={log.id} className="relative space-y-2">
                        {/* Timeline point indicator */}
                        <div
                          className={`absolute -left-[27px] top-1 w-3.5 h-3.5 rounded-full border-2 border-white ring-2 ${
                            idx === 0
                              ? 'bg-brand-500 ring-brand-200'
                              : 'bg-gray-300 ring-gray-200'
                          }`}
                        ></div>

                        {/* Log card */}
                        <div className="p-4 rounded-xl bg-gray-50/70 border border-gray-200 shadow-theme-xs space-y-3 hover:border-brand-200 transition-colors">
                          <div className="flex items-center justify-between text-xs">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-bold text-gray-900 text-sm">{log.date}</span>
                              {log.tag && (
                                <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-blue-50 text-blue-700 border border-blue-200">
                                  {log.tag}
                                </span>
                              )}
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-brand-50 text-brand-700 border border-brand-200">
                                {log.author}
                              </span>
                              {log.contactMethod && (
                                <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
                                  {log.contactMethod}
                                </span>
                              )}
                            </div>

                            <button
                              className="text-gray-400 hover:text-brand-500"
                              title="Chỉnh sửa nhật ký"
                              onClick={() => alert('Chỉnh sửa nhật ký này')}
                            >
                              <span className="material-symbols-outlined text-[15px]">edit</span>
                            </button>
                          </div>

                          <p className="text-xs text-gray-700 leading-relaxed">{log.content}</p>

                          {/* Photos Grid if present */}
                          {log.images && log.images.length > 0 && (
                            <div className="space-y-1.5 pt-1">
                              <div className="flex items-center gap-1.5 text-xs text-brand-600 font-medium">
                                <span className="material-symbols-outlined text-sm">
                                  photo_library
                                </span>
                                <span>Ảnh thực tế sa bàn &amp; bản vẽ căn hộ ({log.images.length} ảnh)</span>
                              </div>
                              <div className="grid grid-cols-4 gap-2 pt-1">
                                {log.images.slice(0, 3).map((img, i) => (
                                  <div
                                    key={i}
                                    onClick={() => onOpenLightbox(i)}
                                    className="relative rounded-lg overflow-hidden border border-gray-200 aspect-video group cursor-pointer"
                                  >
                                    <img
                                      src={img.src}
                                      alt={img.caption}
                                      className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                                    />
                                    <div className="absolute bottom-0 inset-x-0 bg-gray-900/60 text-[9px] text-white px-1 py-0.5 truncate text-center">
                                      {img.caption.split(' ')[0]} {img.caption.split(' ')[1]}
                                    </div>
                                  </div>
                                ))}

                                <div
                                  onClick={() => onOpenLightbox(3)}
                                  className="relative rounded-lg overflow-hidden border border-gray-200 aspect-video bg-gray-900 text-white flex items-center justify-center font-bold text-xs cursor-pointer hover:bg-gray-800 transition-colors"
                                >
                                  +2 Xem tất cả
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
