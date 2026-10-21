import React, { useState } from 'react';
import { Customer } from '../types';
import { AVATAR_HANH } from '../data/mockData';

interface CustomerDetailViewProps {
  customer: Customer;
  onBack: () => void;
  onEditPersona: (cust: Customer) => void;
  onEditInvestment: (cust: Customer) => void;
  onCall: (phone: string, name: string) => void;
  onZalo: (phone: string, name: string) => void;
  onOpenLightbox: (photos: Array<{ url: string; title: string }>, startIndex: number) => void;
  onAddTimelineLog: (customerId: string, logContent: string) => void;
}

export const CustomerDetailView: React.FC<CustomerDetailViewProps> = ({
  customer,
  onBack,
  onEditPersona,
  onEditInvestment,
  onCall,
  onZalo,
  onOpenLightbox,
  onAddTimelineLog,
}) => {
  const [activeSubTab, setActiveSubTab] = useState<'info' | 'progress' | 'timeline'>('info');
  const [showFullPhone, setShowFullPhone] = useState(false);
  const [showFullCccd, setShowFullCccd] = useState(false);
  const [statusMenuOpen, setStatusMenuOpen] = useState(false);
  const [currentStatus, setCurrentStatus] = useState(customer.statusLabel);

  // 4 Deal Criteria state
  const [criteria, setCriteria] = useState({
    demand: customer.dealCriteria?.demand?.met ?? true,
    motivation: customer.dealCriteria?.motivation?.met ?? false,
    finance: customer.dealCriteria?.finance?.met ?? true,
    timeline: customer.dealCriteria?.timeline?.met ?? false,
  });

  // Calculate progress
  const metCount = Object.values(criteria).filter(Boolean).length;
  const progressPercent = metCount * 25;

  // Quick note state in detail view
  const [newLogNote, setNewLogNote] = useState('');
  const [selectedPhotos, setSelectedPhotos] = useState<string[]>([
    'https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?auto=format&fit=crop&w=300&q=80',
    'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=300&q=80',
    'https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?auto=format&fit=crop&w=300&q=80',
    'https://images.unsplash.com/photo-1512917774080-9991f1c4c750?auto=format&fit=crop&w=300&q=80',
    'https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?auto=format&fit=crop&w=300&q=80',
  ]);

  const handleSaveLog = () => {
    if (!newLogNote.trim()) return;
    onAddTimelineLog(customer.id, newLogNote.trim());
    setNewLogNote('');
  };

  const removePhoto = (index: number) => {
    setSelectedPhotos(selectedPhotos.filter((_, i) => i !== index));
  };

  const handleAddPhotos = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      // Simulate adding sample real estate images
      setSelectedPhotos([
        ...selectedPhotos,
        'https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?auto=format&fit=crop&w=300&q=80',
      ]);
    }
  };

  const galleryImages = [
    { url: 'https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?auto=format&fit=crop&w=1000&q=85', title: "Sa bàn thực tế dự án Q'Terra" },
    { url: 'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=1000&q=85', title: 'Phòng khách nhà mẫu 3PN sang trọng' },
    { url: 'https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?auto=format&fit=crop&w=1000&q=85', title: 'Ban công hướng trực diện sông Nam Sài Gòn' },
    { url: 'https://images.unsplash.com/photo-1512917774080-9991f1c4c750?auto=format&fit=crop&w=1000&q=85', title: 'Mặt bằng căn 3 phòng ngủ layout tối ưu' },
    { url: 'https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?auto=format&fit=crop&w=1000&q=85', title: 'Thiết kế phòng ngủ Master view thoáng' },
    { url: 'https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?auto=format&fit=crop&w=1000&q=85', title: 'Khu vực bếp và bàn ăn bàn giao chuẩn Châu Âu' },
  ];

  return (
    <div className="w-full max-w-[425px] min-h-screen bg-gray-50 flex flex-col relative pb-28 mx-auto animate-in fade-in duration-200">
      {/* Top Navigation Header */}
      <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-md px-4 py-3 flex items-center justify-between border-b border-gray-200 shadow-theme-xs">
        <div className="flex items-center gap-2 overflow-hidden">
          <button
            type="button"
            aria-label="Quay lại"
            onClick={onBack}
            className="flex items-center justify-center w-9 h-9 rounded-lg hover:bg-gray-100 active:scale-95 transition-all text-gray-700"
          >
            <span className="material-symbols-outlined text-gray-700">arrow_back</span>
          </button>
          <div className="flex flex-col truncate">
            <div className="flex items-center gap-1 text-[11px] text-gray-400">
              <span>Quản lý khách hàng</span>
              <span className="material-symbols-outlined text-[14px]">chevron_right</span>
            </div>
            <h1 className="text-title-md font-bold text-gray-900 truncate">
              {customer.name}
            </h1>
          </div>
        </div>

        <button
          type="button"
          onClick={() => onEditPersona(customer)}
          className="text-brand-500 hover:text-brand-600 font-medium text-xs flex items-center gap-1"
        >
          <span className="material-symbols-outlined text-[16px]">edit</span>
          <span>Chỉnh sửa</span>
        </button>
      </header>

      {/* Main Content Canvas */}
      <main className="flex-1 px-4 pt-4 space-y-4">
        {/* Profile Header Summary Card */}
        <section className="bg-white rounded-2xl p-4 border border-gray-200 shadow-theme-xs space-y-3.5">
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-headline-sm-mobile text-gray-950 font-bold">{customer.name}</h2>
                {customer.isVip && (
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-label-xs bg-purple-100 text-purple-800 font-semibold">
                    VIP
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-body-md text-gray-600 font-mono tracking-tight font-medium">
                  {showFullPhone
                    ? customer.phone
                    : customer.phone.replace(/(\d{4})\d{3}(\d{3})/, '$1 *** $2')}
                </span>
                <button
                  type="button"
                  onClick={() => setShowFullPhone(!showFullPhone)}
                  className="inline-flex items-center text-brand-600 hover:text-brand-700 text-label-xs font-semibold gap-0.5"
                >
                  <span className="material-symbols-outlined text-[14px]">call</span>
                  <span>{showFullPhone ? 'Ẩn số' : 'Hiện số'}</span>
                </button>
              </div>
            </div>

            {/* Status Dropdown */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setStatusMenuOpen(!statusMenuOpen)}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-label-xs bg-success-50 text-success-700 border border-success-100 shadow-theme-xs font-semibold active:scale-95 transition-all"
              >
                <span className="w-2 h-2 rounded-full bg-success-500"></span>
                <span>{currentStatus}</span>
                <span className="material-symbols-outlined text-[16px]">expand_more</span>
              </button>
              {statusMenuOpen && (
                <div className="absolute right-0 mt-1 w-36 bg-white border border-gray-200 rounded-xl shadow-theme-md py-1 z-30 text-xs">
                  {['Có quan tâm', 'Khách net', 'Chờ gọi lại', 'Đã chốt cọc', 'Bỏ nhu cầu'].map(
                    (st) => (
                      <button
                        key={st}
                        type="button"
                        onClick={() => {
                          setCurrentStatus(st);
                          setStatusMenuOpen(false);
                        }}
                        className="w-full text-left px-3 py-1.5 hover:bg-gray-50 text-gray-700 font-medium"
                      >
                        {st}
                      </button>
                    )
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 pt-0.5">
            <button
              type="button"
              onClick={() => onCall(customer.phone, customer.name)}
              className="flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg bg-brand-500 text-white font-medium text-xs shadow-theme-xs active:scale-[0.98] transition-all hover:bg-brand-600"
            >
              <span className="material-symbols-outlined text-[18px]">call</span>
              <span>Gọi ngay</span>
            </button>
            <button
              type="button"
              onClick={() => onZalo(customer.phone, customer.name)}
              className="flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg bg-success-500 text-white font-medium text-xs shadow-theme-xs active:scale-[0.98] transition-all hover:bg-success-700"
            >
              <span className="material-symbols-outlined text-[18px]">chat</span>
              <span>Nhắn Zalo</span>
            </button>
          </div>

          {/* Care Team */}
          <div className="border-t border-gray-100 pt-3 flex flex-col gap-2.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="flex -space-x-2 overflow-hidden items-center">
                  <div className="relative">
                    <img
                      alt="Hạnh (Chính)"
                      className="w-7 h-7 rounded-full object-cover border-2 border-white"
                      src={AVATAR_HANH}
                    />
                    <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-brand-500 rounded-full flex items-center justify-center text-[8px] text-white">
                      ★
                    </span>
                  </div>
                  <div className="w-7 h-7 rounded-full bg-brand-100 text-brand-700 font-bold text-[11px] flex items-center justify-center border-2 border-white">
                    T
                  </div>
                  <div className="w-7 h-7 rounded-full bg-purple-100 text-purple-800 font-bold text-[11px] flex items-center justify-center border-2 border-white">
                    T
                  </div>
                </div>
                <div className="flex flex-col">
                  <div className="flex items-center gap-1 text-label-xs font-semibold text-gray-900">
                    <span>★ {customer.assignedLead}</span>
                    <span className="text-gray-400">·</span>
                    <span className="text-gray-600 font-normal">Thảo, Tuấn</span>
                  </div>
                  <span className="text-[11px] text-gray-400">Nhóm cùng chăm sóc (C8)</span>
                </div>
              </div>

              <button
                type="button"
                className="inline-flex items-center gap-1 px-2.5 py-1 text-label-xs rounded-lg border border-dashed border-gray-300 text-gray-600 hover:bg-gray-50 hover:border-brand-500 hover:text-brand-500 transition-colors"
              >
                <span className="material-symbols-outlined text-[14px]">group_add</span>
                <span>+ Thêm người</span>
              </button>
            </div>
          </div>
        </section>

        {/* Tab Switcher Navigation */}
        <section className="bg-gray-100 p-1 rounded-xl flex items-center justify-between border border-gray-200">
          <button
            type="button"
            onClick={() => setActiveSubTab('info')}
            className={`flex-1 py-1.5 text-center text-xs font-semibold rounded-lg transition-all ${
              activeSubTab === 'info'
                ? 'bg-white text-brand-600 shadow-theme-xs'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            Thông tin KH
          </button>
          <button
            type="button"
            onClick={() => setActiveSubTab('progress')}
            className={`flex-1 py-1.5 text-center text-xs font-semibold rounded-lg transition-all ${
              activeSubTab === 'progress'
                ? 'bg-white text-brand-600 shadow-theme-xs'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            Tiến độ
          </button>
          <button
            type="button"
            onClick={() => setActiveSubTab('timeline')}
            className={`flex-1 py-1.5 text-center text-xs font-semibold rounded-lg transition-all ${
              activeSubTab === 'timeline'
                ? 'bg-white text-brand-600 shadow-theme-xs'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            Nhật ký
          </button>
        </section>

        {/* 3. Chân Dung Khách Hàng (Customer Persona) */}
        {(activeSubTab === 'info' || activeSubTab === 'progress') && (
          <section className="bg-white rounded-2xl p-4 border border-gray-200 shadow-theme-xs space-y-3">
            <div className="flex items-center justify-between border-b border-gray-100 pb-2.5">
              <div className="flex items-center gap-1.5">
                <span className="material-symbols-outlined text-purple-800 text-[20px]">
                  psychology
                </span>
                <h3 className="text-title-md font-bold text-gray-900">
                  Chân dung khách hàng (C10)
                </h3>
              </div>
              <button
                type="button"
                onClick={() => onEditPersona(customer)}
                className="text-brand-500 font-label-xs hover:underline flex items-center gap-0.5 text-xs font-medium"
              >
                <span className="material-symbols-outlined text-[14px]">edit</span>
                <span>Sửa</span>
              </button>
            </div>

            <div className="space-y-3 pt-1 text-body-md">
              {/* Nhóm 1: Cá nhân & Dịp đặc biệt */}
              <div className="p-2.5 rounded-xl bg-gray-50/70 border border-gray-100 space-y-1.5">
                <div className="text-[11px] uppercase tracking-wider font-bold text-gray-500 flex items-center gap-1">
                  <span className="material-symbols-outlined text-[13px]">cake</span>
                  <span>Cá nhân & Dịp đặc biệt</span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-[13px]">
                  <div>
                    <span className="text-gray-400 block text-[11px]">Sinh nhật:</span>
                    <span className="font-medium text-gray-900">{customer.birthday || '15/11'}</span>
                  </div>
                  <div>
                    <span className="text-gray-400 block text-[11px]">Quê quán:</span>
                    <span className="font-medium text-gray-900">{customer.hometown || 'Hà Nội'}</span>
                  </div>
                  <div className="col-span-2">
                    <span className="text-gray-400 block text-[11px]">Nơi ở hiện tại:</span>
                    <span className="font-medium text-gray-900">{customer.currentResidence || 'Quận 7, TP.HCM'}</span>
                  </div>
                </div>

                <div className="mt-2 pt-2 border-t border-gray-200/60 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-lg bg-gray-100 flex items-center justify-center text-gray-500">
                      <span className="material-symbols-outlined text-[16px]">badge</span>
                    </div>
                    <div>
                      <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider block">
                        CCCD / Định danh
                      </span>
                      <span className="font-mono text-body-md font-bold text-gray-800">
                        {showFullCccd ? customer.idNumber || '001084001234' : '•••• 1234'}
                      </span>
                      <span className="text-label-xs text-gray-400 font-normal ml-1">
                        {showFullCccd ? '(Đầy đủ)' : '(4 số cuối)'}
                      </span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowFullCccd(!showFullCccd)}
                    className="inline-flex items-center gap-1 px-2.5 py-1 bg-white border border-gray-200 rounded-lg text-label-xs font-medium text-gray-700 hover:bg-gray-50 shadow-theme-xs active:scale-95 transition-all text-xs"
                  >
                    <span className="material-symbols-outlined text-[14px] text-gray-500">
                      {showFullCccd ? 'visibility_off' : 'visibility'}
                    </span>
                    <span>{showFullCccd ? 'Ẩn' : 'Hiện'}</span>
                  </button>
                </div>
              </div>

              {/* Nhóm 2: Nghề nghiệp & Gia đình */}
              <div className="p-2.5 rounded-xl bg-gray-50/70 border border-gray-100 space-y-1.5">
                <div className="text-[11px] uppercase tracking-wider font-bold text-gray-500 flex items-center gap-1">
                  <span className="material-symbols-outlined text-[13px]">work</span>
                  <span>Nghề nghiệp & Gia đình</span>
                </div>
                <div className="space-y-1 text-[13px]">
                  <div>
                    <span className="text-gray-400 text-[11px] block">Nghề nghiệp:</span>
                    <span className="font-medium text-gray-900">
                      {customer.career || 'Doanh nhân / Giám đốc công ty XNK Logistics'}
                    </span>
                  </div>
                  <div>
                    <span className="text-gray-400 text-[11px] block">Người quyết định & Gia cảnh:</span>
                    <span className="font-medium text-gray-900">
                      {customer.decisionMaker === 'both' ? 'Vợ chồng cùng duyệt' : 'Khách tự quyết'}; {customer.childrenCount || 'Có 2 con nhỏ'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Nhóm 3: Thẻ Tags sở thích & Lối sống (C11) */}
              <div>
                <span className="text-[11px] uppercase tracking-wider font-bold text-gray-500 block mb-1.5">
                  Sở thích & Lối sống (C11)
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {(customer.lifestyleTags || ['Căn hộ view sông', 'Golf', 'Thích tầng cao', 'Thanh toán linh hoạt']).map(
                    (tag) => (
                      <span
                        key={tag}
                        className="px-2.5 py-1 bg-brand-50 text-brand-700 rounded-lg text-label-xs font-semibold border border-brand-100"
                      >
                        #{tag}
                      </span>
                    )
                  )}
                </div>
              </div>

              {/* Nhóm 4: Cách thức liên hệ thuận tiện */}
              <div className="p-2.5 rounded-xl bg-brand-50/40 border border-brand-100 text-[13px] flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-brand-500 text-[18px]">
                    schedule
                  </span>
                  <span className="text-gray-600">Khung giờ rảnh:</span>
                </div>
                <span className="font-semibold text-brand-900">
                  {customer.freeTimeSlot || '19:00 - 20:30 (Ưu tiên Zalo)'}
                </span>
              </div>
            </div>
          </section>
        )}

        {/* 2. Thông Tin Đầu Tư */}
        {(activeSubTab === 'info' || activeSubTab === 'progress') && (
          <section className="bg-white rounded-2xl p-4 border border-gray-200 shadow-theme-xs space-y-3">
            <div className="flex items-center justify-between border-b border-gray-100 pb-2.5">
              <div className="flex items-center gap-1.5">
                <span className="material-symbols-outlined text-brand-500 text-[20px]">
                  trending_up
                </span>
                <h3 className="text-title-md font-bold text-gray-900">Thông tin đầu tư</h3>
              </div>
              <button
                type="button"
                onClick={() => onEditInvestment(customer)}
                className="text-brand-500 font-label-xs hover:underline flex items-center gap-0.5 text-xs font-medium"
              >
                <span className="material-symbols-outlined text-[16px]">edit</span>
                <span>Sửa</span>
              </button>
            </div>

            <div className="space-y-3 text-body-md">
              {/* Nhóm 1: Dự án quan tâm */}
              <div className="p-2.5 rounded-xl bg-gray-50/70 border border-gray-100 space-y-1.5">
                <div className="text-[11px] uppercase tracking-wider font-bold text-gray-500 flex items-center gap-1">
                  <span className="material-symbols-outlined text-[13px]">apartment</span>
                  <span>Dự án quan tâm</span>
                </div>
                <div className="flex flex-wrap gap-1.5 pt-0.5">
                  {(customer.investmentInfo?.projects || ["Q'Terra", 'The Privia']).map((p) => (
                    <span
                      key={p}
                      className="inline-flex items-center px-2 py-0.5 rounded-full text-label-xs bg-brand-50 text-brand-700 font-medium border border-brand-100"
                    >
                      {p}
                    </span>
                  ))}
                </div>
              </div>

              {/* Nhóm 2: Tài chính & Ngân sách */}
              <div className="p-2.5 rounded-xl bg-gray-50/70 border border-gray-100 space-y-2">
                <div className="text-[11px] uppercase tracking-wider font-bold text-gray-500 flex items-center gap-1">
                  <span className="material-symbols-outlined text-[13px]">account_balance_wallet</span>
                  <span>Tài chính & Ngân sách</span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-[13px]">
                  <div>
                    <span className="text-gray-400 block text-[11px]">Ngân sách dự kiến:</span>
                    <span className="font-semibold text-brand-700">
                      {customer.investmentInfo?.budgetMin || '5'} – {customer.investmentInfo?.budgetMax || '7 tỷ'}
                    </span>
                  </div>
                  <div>
                    <span className="text-gray-400 block text-[11px]">Vốn tự có:</span>
                    <span className="font-medium text-gray-900">
                      {customer.investmentInfo?.ownCapitalRatio || '60% (Vay 40%)'}
                    </span>
                  </div>
                  <div className="col-span-2 pt-0.5">
                    <div className="inline-flex items-center gap-1 px-2 py-1 bg-brand-50 text-brand-700 rounded-lg text-label-xs border border-brand-100">
                      <span className="material-symbols-outlined text-[14px]">info</span>
                      <span>Cần gói hỗ trợ lãi suất & ân hạn nợ gốc</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Nhóm 3: Nhu cầu & Tiêu chí BĐS */}
              <div className="p-2.5 rounded-xl bg-gray-50/70 border border-gray-100 space-y-2">
                <div className="text-[11px] uppercase tracking-wider font-bold text-gray-500 flex items-center gap-1">
                  <span className="material-symbols-outlined text-[13px]">home_work</span>
                  <span>Nhu cầu & Tiêu chí BĐS</span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-[13px]">
                  <div>
                    <span className="text-gray-400 block text-[11px]">Loại hình BĐS:</span>
                    <span className="font-medium text-gray-900">
                      {customer.investmentInfo?.propertyType || 'Căn hộ chung cư'}
                    </span>
                  </div>
                  <div>
                    <span className="text-gray-400 block text-[11px]">Cơ cấu phòng:</span>
                    <span className="font-medium text-gray-900">
                      {customer.investmentInfo?.bedrooms || '3 Phòng ngủ (3PN)'}
                    </span>
                  </div>
                  <div className="col-span-2 space-y-1.5 pt-0.5">
                    <div>
                      <span className="text-gray-400 block text-[11px] mb-1">Mục đích mua:</span>
                      <div className="flex flex-wrap gap-1.5">
                        <span className="px-2 py-0.5 bg-brand-50 text-brand-700 rounded-lg text-label-xs font-medium border border-brand-100">
                          #Đầu tư lâu dài & Cho thuê
                        </span>
                        <span className="px-2 py-0.5 bg-brand-50 text-brand-700 rounded-lg text-label-xs font-medium border border-brand-100">
                          #Tích sản cho con
                        </span>
                      </div>
                    </div>
                    <div>
                      <span className="text-gray-400 block text-[11px] mb-1">Tiêu chí ưu tiên:</span>
                      <div className="flex flex-wrap gap-1.5">
                        <span className="px-2 py-0.5 bg-success-50 text-success-700 rounded-lg text-label-xs font-semibold border border-success-100">
                          View sông / Công viên
                        </span>
                        <span className="px-2 py-0.5 bg-gray-100 text-gray-700 rounded-lg text-label-xs font-medium border border-gray-200">
                          Tầng cao thoáng
                        </span>
                        <span className="px-2 py-0.5 bg-gray-100 text-gray-700 rounded-lg text-label-xs font-medium border border-gray-200">
                          Gần trường quốc tế
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Nhóm 4: Khu vực & Địa bàn tìm kiếm */}
              <div className="p-2.5 rounded-xl bg-gray-50/70 border border-gray-100 space-y-1.5">
                <div className="text-[11px] uppercase tracking-wider font-bold text-gray-500 flex items-center gap-1">
                  <span className="material-symbols-outlined text-[13px]">pin_drop</span>
                  <span>Khu vực & Địa bàn tìm kiếm</span>
                </div>
                <div className="space-y-1 text-[13px]">
                  <div>
                    <span className="text-gray-400 text-[11px] block">Khu vực tìm kiếm:</span>
                    <span className="font-medium text-gray-900">
                      {customer.investmentInfo?.searchArea || 'Quận 7, TP.HCM'}
                    </span>
                  </div>
                  <div>
                    <span className="text-gray-400 text-[11px] block">Vị trí cụ thể:</span>
                    <span className="font-medium text-gray-900">
                      {customer.investmentInfo?.specificLocation || 'Khu vực Phú Mỹ Hưng, ven sông Nam Sài Gòn'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Nhóm 5: Nguồn khách & Kế hoạch */}
              <div className="p-2.5 rounded-xl bg-brand-50/40 border border-brand-100 space-y-1.5">
                <div className="text-[11px] uppercase tracking-wider font-bold text-brand-900 flex items-center gap-1">
                  <span className="material-symbols-outlined text-[13px] text-brand-500">
                    event_available
                  </span>
                  <span>Nguồn khách & Kế hoạch</span>
                </div>
                <div className="grid grid-cols-1 gap-1 text-[13px]">
                  <div className="flex justify-between items-start">
                    <span className="text-gray-500 text-[11px]">Nguồn khách:</span>
                    <span className="font-medium text-gray-900 text-right">
                      {customer.investmentInfo?.source || "Facebook Ads - Chiến dịch Q'Terra"}
                    </span>
                  </div>
                  <div className="flex justify-between items-start pt-0.5">
                    <span className="text-gray-500 text-[11px]">Dự kiến mua / chốt:</span>
                    <span className="font-semibold text-brand-700 text-right">
                      {customer.investmentInfo?.targetTimeline || 'Quý 4/2026 (Khi ra hàng đợt 2)'}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* 4 Tiêu chí chốt Deal (C4) */}
        {(activeSubTab === 'info' || activeSubTab === 'progress') && (
          <section className="bg-white rounded-2xl p-4 border border-gray-200 shadow-theme-xs space-y-3">
            <div className="flex items-center justify-between border-b border-gray-100 pb-2.5">
              <div className="flex items-center gap-1.5">
                <span className="material-symbols-outlined text-brand-500 text-[20px]">
                  checklist_rtl
                </span>
                <h3 className="text-title-md font-bold text-gray-900">
                  4 Tiêu chí chốt Deal (C4)
                </h3>
              </div>
              <span className="text-xs font-semibold text-brand-600 bg-brand-50 px-2 py-0.5 rounded-md">
                {progressPercent}% hoàn thành
              </span>
            </div>

            {/* Dynamic Progress Bar */}
            <div className="w-full bg-gray-100 h-2 rounded-full overflow-hidden flex">
              <div
                className="bg-brand-500 h-full transition-all duration-500"
                style={{ width: `${progressPercent}%` }}
              />
              <div
                className="bg-gray-200 h-full transition-all duration-500"
                style={{ width: `${100 - progressPercent}%` }}
              />
            </div>

            {/* 4 Tiêu chí chi tiết */}
            <div className="space-y-2 pt-1 font-body-md">
              {/* Tiêu chí 1: Nhu cầu */}
              <div
                onClick={() => setCriteria({ ...criteria, demand: !criteria.demand })}
                className={`p-2.5 rounded-xl border flex items-start justify-between gap-2 cursor-pointer transition-colors ${
                  criteria.demand
                    ? 'border-success-100 bg-success-50/50'
                    : 'border-gray-200 bg-gray-50/60'
                }`}
              >
                <div className="flex items-start gap-2.5">
                  <span
                    className={`material-symbols-outlined text-[20px] shrink-0 mt-0.5 ${
                      criteria.demand ? 'text-success-700' : 'text-gray-400'
                    }`}
                  >
                    {criteria.demand ? 'check_circle' : 'radio_button_unchecked'}
                  </span>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-gray-900 text-xs">1. Nhu cầu</span>
                      <span
                        className={`text-[11px] font-semibold px-1.5 py-0.2 rounded border ${
                          criteria.demand
                            ? 'text-success-700 bg-white border-success-100'
                            : 'text-gray-500 bg-white border-gray-200'
                        }`}
                      >
                        {criteria.demand ? '25% · Đạt' : 'Chưa đạt'}
                      </span>
                    </div>
                    <p className="text-gray-700 text-xs mt-0.5">
                      Căn hộ 3PN cao cấp, view sông, mục đích ở & đầu tư lâu dài.
                    </p>
                  </div>
                </div>
                <span className="material-symbols-outlined text-[16px] text-gray-400 mt-1">edit</span>
              </div>

              {/* Tiêu chí 2: Động cơ */}
              <div
                onClick={() => setCriteria({ ...criteria, motivation: !criteria.motivation })}
                className={`p-2.5 rounded-xl border flex items-start justify-between gap-2 cursor-pointer transition-colors ${
                  criteria.motivation
                    ? 'border-success-100 bg-success-50/50'
                    : 'border-gray-200 bg-gray-50/60'
                }`}
              >
                <div className="flex items-start gap-2.5">
                  <span
                    className={`material-symbols-outlined text-[20px] shrink-0 mt-0.5 ${
                      criteria.motivation ? 'text-success-700' : 'text-gray-400'
                    }`}
                  >
                    {criteria.motivation ? 'check_circle' : 'radio_button_unchecked'}
                  </span>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-gray-900 text-xs">2. Động cơ</span>
                      <span
                        className={`text-[11px] font-semibold px-1.5 py-0.2 rounded border ${
                          criteria.motivation
                            ? 'text-success-700 bg-white border-success-100'
                            : 'text-gray-500 bg-white border-gray-200'
                        }`}
                      >
                        {criteria.motivation ? '25% · Đạt' : 'Chưa đạt'}
                      </span>
                    </div>
                    <p className="text-gray-600 text-xs mt-0.5">
                      Lý do đổi nhà / chuyển về gần trường quốc tế cho con học kỳ tới.
                    </p>
                  </div>
                </div>
                <span className="material-symbols-outlined text-[16px] text-gray-400 mt-1">edit</span>
              </div>

              {/* Tiêu chí 3: Tài chính */}
              <div
                onClick={() => setCriteria({ ...criteria, finance: !criteria.finance })}
                className={`p-2.5 rounded-xl border flex items-start justify-between gap-2 cursor-pointer transition-colors ${
                  criteria.finance
                    ? 'border-success-100 bg-success-50/50'
                    : 'border-gray-200 bg-gray-50/60'
                }`}
              >
                <div className="flex items-start gap-2.5">
                  <span
                    className={`material-symbols-outlined text-[20px] shrink-0 mt-0.5 ${
                      criteria.finance ? 'text-success-700' : 'text-gray-400'
                    }`}
                  >
                    {criteria.finance ? 'check_circle' : 'radio_button_unchecked'}
                  </span>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-gray-900 text-xs">3. Tài chính</span>
                      <span
                        className={`text-[11px] font-semibold px-1.5 py-0.2 rounded border ${
                          criteria.finance
                            ? 'text-success-700 bg-white border-success-100'
                            : 'text-gray-500 bg-white border-gray-200'
                        }`}
                      >
                        {criteria.finance ? '25% · Đạt' : 'Chưa đạt'}
                      </span>
                    </div>
                    <p className="text-gray-700 text-xs mt-0.5">
                      Ngân sách 5 - 7 tỷ, sẵn vốn tự có 60%, cần hỗ trợ vay 40% ân hạn nợ gốc.
                    </p>
                  </div>
                </div>
                <span className="material-symbols-outlined text-[16px] text-gray-400 mt-1">edit</span>
              </div>

              {/* Tiêu chí 4: Thời gian chốt */}
              <div
                onClick={() => setCriteria({ ...criteria, timeline: !criteria.timeline })}
                className={`p-2.5 rounded-xl border flex items-start justify-between gap-2 cursor-pointer transition-colors ${
                  criteria.timeline
                    ? 'border-success-100 bg-success-50/50'
                    : 'border-gray-200 bg-gray-50/60'
                }`}
              >
                <div className="flex items-start gap-2.5">
                  <span
                    className={`material-symbols-outlined text-[20px] shrink-0 mt-0.5 ${
                      criteria.timeline ? 'text-success-700' : 'text-gray-400'
                    }`}
                  >
                    {criteria.timeline ? 'check_circle' : 'radio_button_unchecked'}
                  </span>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-gray-900 text-xs">4. Thời gian chốt</span>
                      <span
                        className={`text-[11px] font-semibold px-1.5 py-0.2 rounded border ${
                          criteria.timeline
                            ? 'text-success-700 bg-white border-success-100'
                            : 'text-gray-500 bg-white border-gray-200'
                        }`}
                      >
                        {criteria.timeline ? '25% · Đạt' : 'Chưa đạt'}
                      </span>
                    </div>
                    <p className="text-gray-600 text-xs mt-0.5">
                      Dự kiến chốt trong Quý 4/2026 khi ra hàng đợt 2.
                    </p>
                  </div>
                </div>
                <span className="material-symbols-outlined text-[16px] text-gray-400 mt-1">edit</span>
              </div>
            </div>
          </section>
        )}

        {/* 4. Nhật Ký Chăm Sóc */}
        {(activeSubTab === 'info' || activeSubTab === 'timeline') && (
          <section className="bg-white rounded-2xl p-4 border border-gray-200 shadow-theme-xs space-y-4">
            <div className="flex items-center justify-between border-b border-gray-100 pb-3">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-brand-500 text-[20px]">
                  history_edu
                </span>
                <h3 className="text-title-md font-bold text-gray-900">Nhật ký chăm sóc</h3>
                <span className="px-2 py-0.5 rounded-full bg-brand-50 text-brand-700 text-label-xs font-semibold">
                  {customer.timelineLogs?.length || 8}
                </span>
              </div>
            </div>

            {/* Form Thêm nhật ký tương tác & Ghi chú nhanh */}
            <div className="p-3.5 rounded-xl bg-gray-50/70 border border-gray-200 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-gray-800 text-label-xs font-semibold uppercase tracking-wider">
                  <span className="material-symbols-outlined text-brand-500 text-[16px]">
                    edit_note
                  </span>
                  <span>Thêm nhật ký chăm sóc</span>
                </div>
              </div>

              <div className="space-y-2.5">
                <textarea
                  value={newLogNote}
                  onChange={(e) => setNewLogNote(e.target.value)}
                  placeholder="Ghi chú nhanh nội dung trao đổi, kết quả cuộc gọi..."
                  rows={2}
                  className="w-full text-body-md border border-gray-200 bg-white rounded-lg p-2.5 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/10 placeholder:text-gray-400 resize-none outline-none transition-all"
                />

                <div className="grid grid-cols-1 gap-2">
                  <div className="relative">
                    <select className="w-full appearance-none bg-white border border-gray-200 text-gray-700 font-body-md rounded-lg px-3 py-2 pr-8 text-xs focus:border-brand-500 outline-none">
                      <option>Khách quan tâm giá / Cần gửi bảng tính</option>
                      <option>Đang so sánh dự án khác</option>
                      <option>Hẹn tham quan nhà mẫu</option>
                      <option>Khách từ chối / Không đúng nhu cầu</option>
                    </select>
                    <span className="material-symbols-outlined absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none text-[18px]">
                      arrow_drop_down
                    </span>
                  </div>

                  <div className="relative">
                    <select className="w-full appearance-none bg-white border border-gray-200 text-gray-700 font-body-md rounded-lg px-3 py-2 pr-8 text-xs focus:border-brand-500 outline-none">
                      <option>Hẹn gọi lại sau 2 ngày (07/10)</option>
                      <option>Hẹn chiều mai (15:00)</option>
                      <option>Nhắc gửi brochure vào sáng thứ Hai</option>
                      <option>Tùy chỉnh lịch nhắc...</option>
                    </select>
                    <span className="material-symbols-outlined absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none text-[18px]">
                      calendar_today
                    </span>
                  </div>
                </div>

                {/* Photo attachment upload row */}
                <div className="space-y-2 pt-0.5">
                  <div className="flex items-center justify-between">
                    <label className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-dashed border-brand-300 bg-brand-50/50 hover:bg-brand-50 text-brand-700 text-label-xs font-semibold cursor-pointer active:scale-95 transition-all">
                      <span className="material-symbols-outlined text-[18px] text-brand-600">
                        add_photo_alternate
                      </span>
                      <span>Đính kèm ảnh</span>
                      <input
                        type="file"
                        accept="image/*"
                        multiple
                        className="hidden"
                        onChange={handleAddPhotos}
                      />
                    </label>
                    <div className="flex items-center gap-1 text-[11px] text-gray-500">
                      <span className="material-symbols-outlined text-[14px] text-success-700">
                        check_circle
                      </span>
                      <span className="font-medium text-gray-700">
                        Đã chọn {selectedPhotos.length} ảnh
                      </span>
                    </div>
                  </div>

                  {/* Photo previews scroll strip */}
                  <div className="flex items-center gap-1.5 overflow-x-auto py-1 no-scrollbar">
                    {selectedPhotos.map((photo, i) => (
                      <div
                        key={i}
                        className="relative w-12 h-12 rounded-lg overflow-hidden shrink-0 border border-gray-200 group"
                      >
                        <img
                          src={photo}
                          className="w-full h-full object-cover"
                          alt={`Preview ${i + 1}`}
                        />
                        <button
                          type="button"
                          onClick={() => removePhoto(i)}
                          className="absolute top-0.5 right-0.5 w-4 h-4 bg-gray-900/70 hover:bg-red-500 rounded-full text-white flex items-center justify-center text-[10px] transition-colors"
                        >
                          <span className="material-symbols-outlined text-[10px]">close</span>
                        </button>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="flex justify-end pt-0.5">
                  <button
                    type="button"
                    onClick={handleSaveLog}
                    className="w-full h-9 rounded-lg bg-brand-500 text-white font-medium text-xs flex items-center justify-center gap-1.5 hover:bg-brand-600 active:scale-95 transition-all shadow-theme-xs"
                  >
                    <span className="material-symbols-outlined text-[18px]">save</span>
                    <span>Lưu nhật ký chăm sóc</span>
                  </button>
                </div>
              </div>
            </div>

            {/* STND AI Suggestion Box */}
            <div className="rounded-xl p-3 bg-brand-50/70 border border-brand-200 flex items-start gap-2.5 shadow-theme-xs">
              <div className="w-7 h-7 rounded-full bg-white flex items-center justify-center text-amber-500 shadow-theme-xs shrink-0 mt-0.5">
                <span className="material-symbols-outlined text-[18px]">lightbulb</span>
              </div>
              <div className="space-y-0.5">
                <div className="flex items-center gap-1.5">
                  <span className="text-[13px] font-bold text-brand-900">
                    Gợi ý bước tiếp theo
                  </span>
                  <span className="text-[10px] bg-purple-100 text-purple-800 px-1.5 py-0.2 rounded font-semibold">
                    STND AI
                  </span>
                </div>
                <p className="text-[13px] text-gray-800 leading-relaxed">
                  Gửi cập nhật tiến độ pháp lý đợt 2, thử gọi lại sau 19h (khung giờ rảnh).
                </p>
              </div>
            </div>

            {/* Dòng thời gian lịch sử chăm sóc */}
            <div className="space-y-2 pt-1">
              <div className="flex items-center justify-between">
                <span className="text-[11px] uppercase tracking-wider font-bold text-gray-500">
                  Dòng thời gian tương tác
                </span>
                <span className="text-[11px] text-gray-400 font-medium flex items-center gap-0.5">
                  <span className="material-symbols-outlined text-[13px]">unfold_more</span>
                  Cuộn để xem tiếp
                </span>
              </div>

              <div className="max-h-[360px] overflow-y-auto pr-1 relative pl-5 space-y-4 pt-1 before:content-[''] before:absolute before:left-2 before:top-2 before:bottom-2 before:w-[2px] before:bg-gray-200">
                {/* Item 1: Latest with Photo Gallery */}
                <div className="relative flex items-start justify-between group">
                  <div className="absolute -left-[17px] top-1 w-2.5 h-2.5 rounded-full bg-brand-500 border-2 border-white ring-2 ring-brand-100"></div>
                  <div className="flex-1 pr-2">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="font-semibold text-gray-900 text-xs">06/10 14:15</span>
                      <span className="text-[10px] font-semibold text-brand-600 bg-brand-50 px-1.5 py-0.2 rounded border border-brand-100">
                        Mới nhất
                      </span>
                      <span className="text-gray-400 text-xs">·</span>
                      <span className="text-[10px] bg-brand-50 text-brand-700 px-1.5 py-0.2 rounded font-medium">
                        ★ Hạnh (Chính)
                      </span>
                    </div>
                    <p className="text-gray-700 text-xs mt-1 leading-normal">
                      Khách gọi hỏi thêm thông tin chính sách vay và tiến độ đóng đợt 2 của dự án Q'Terra, hẹn tuần tới đi xem thực tế sa bàn và nhà mẫu.
                    </p>

                    {/* Interactive Photos Grid */}
                    <div className="mt-2">
                      <div className="flex items-center gap-1 text-[11px] text-gray-500 mb-1">
                        <span className="material-symbols-outlined text-[14px] text-brand-500">
                          photo_library
                        </span>
                        <span className="font-medium text-gray-700">
                          Ảnh thực tế sa bàn & bản vẽ căn hộ (6 ảnh)
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-1.5 rounded-xl overflow-hidden">
                        <div
                          onClick={() => onOpenLightbox(galleryImages, 0)}
                          className="relative h-20 rounded-lg overflow-hidden cursor-pointer group"
                        >
                          <img
                            src="https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?auto=format&fit=crop&w=600&q=80"
                            alt="Sa bàn dự án"
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                          />
                          <div className="absolute bottom-1 left-1 px-1.5 py-0.2 rounded bg-black/60 text-[10px] text-white backdrop-blur-sm">
                            Sa bàn Q'Terra
                          </div>
                        </div>

                        <div
                          onClick={() => onOpenLightbox(galleryImages, 1)}
                          className="relative h-20 rounded-lg overflow-hidden cursor-pointer group"
                        >
                          <img
                            src="https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=600&q=80"
                            alt="Phòng khách căn mẫu"
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                          />
                          <div className="absolute bottom-1 left-1 px-1.5 py-0.2 rounded bg-black/60 text-[10px] text-white backdrop-blur-sm">
                            Phòng khách 3PN
                          </div>
                        </div>

                        <div
                          onClick={() => onOpenLightbox(galleryImages, 2)}
                          className="relative h-20 rounded-lg overflow-hidden cursor-pointer group"
                        >
                          <img
                            src="https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?auto=format&fit=crop&w=600&q=80"
                            alt="Ban công view sông"
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                          />
                          <div className="absolute bottom-1 left-1 px-1.5 py-0.2 rounded bg-black/60 text-[10px] text-white backdrop-blur-sm">
                            Ban công view sông
                          </div>
                        </div>

                        <div
                          onClick={() => onOpenLightbox(galleryImages, 3)}
                          className="relative h-20 rounded-lg overflow-hidden cursor-pointer group"
                        >
                          <img
                            src="https://images.unsplash.com/photo-1512917774080-9991f1c4c750?auto=format&fit=crop&w=600&q=80"
                            alt="Mặt bằng tổng thể"
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                          />
                          <div className="absolute inset-0 bg-gray-950/65 flex flex-col items-center justify-center text-white backdrop-blur-[1px] hover:bg-gray-950/75 transition-colors">
                            <span className="text-title-md font-bold text-white">+2</span>
                            <span className="text-[10px] text-gray-200 font-medium">Xem tất cả</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Additional Timeline entries */}
                <div className="relative flex items-start justify-between">
                  <div className="absolute -left-[17px] top-1 w-2.5 h-2.5 rounded-full bg-brand-500 border-2 border-white"></div>
                  <div className="flex-1 pr-2">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-gray-900 text-xs">05/10 15:30</span>
                      <span className="text-gray-400 text-xs">·</span>
                      <span className="text-[10px] bg-brand-50 text-brand-700 px-1.5 py-0.2 rounded font-medium">
                        ★ Hạnh (Chính)
                      </span>
                    </div>
                    <p className="text-gray-700 text-xs mt-1 leading-normal">
                      Gọi điện, khách đang bận việc công ty, hẹn gọi lại sau 19h tối.
                    </p>
                  </div>
                </div>

                <div className="relative flex items-start justify-between">
                  <div className="absolute -left-[17px] top-1 w-2.5 h-2.5 rounded-full bg-gray-400 border-2 border-white"></div>
                  <div className="flex-1 pr-2">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-gray-900 text-xs">03/10 09:10</span>
                      <span className="text-gray-400 text-xs">·</span>
                      <span className="text-[10px] bg-gray-100 text-gray-600 px-1.5 py-0.2 rounded font-medium">
                        Thảo
                      </span>
                    </div>
                    <p className="text-gray-600 text-xs mt-1 leading-normal">
                      Đã nhắn Zalo gửi brochure tiến độ đợt 2 Q'Terra, khách đã xem.
                    </p>
                  </div>
                </div>

                <div className="relative flex items-start justify-between">
                  <div className="absolute -left-[17px] top-1 w-2.5 h-2.5 rounded-full bg-brand-500 border-2 border-white"></div>
                  <div className="flex-1 pr-2">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-gray-900 text-xs">01/10 17:00</span>
                      <span className="text-gray-400 text-xs">·</span>
                      <span className="text-[10px] bg-brand-50 text-brand-700 px-1.5 py-0.2 rounded font-medium">
                        ★ Hạnh (Chính)
                      </span>
                    </div>
                    <p className="text-gray-700 text-xs mt-1 leading-normal">
                      Gặp trực tiếp tại VP STND, tư vấn phương án vay 40% ngân hàng đối tác.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </section>
        )}
      </main>

      {/* Fixed Dual CTA Mobile Footer Bar */}
      <footer className="fixed bottom-0 left-0 right-0 max-w-[425px] mx-auto bg-white/95 backdrop-blur-md border-t border-gray-200 p-3 z-50 flex items-center gap-3 shadow-theme-lg">
        <button
          type="button"
          onClick={() => onCall(customer.phone, customer.name)}
          className="flex-1 h-12 bg-brand-500 hover:bg-brand-600 active:scale-[0.98] text-white rounded-xl flex items-center justify-center gap-2 font-semibold text-sm shadow-theme-sm transition-all"
        >
          <span className="material-symbols-outlined text-[22px]">phone</span>
          <span>Gọi điện</span>
        </button>
        <button
          type="button"
          onClick={() => onZalo(customer.phone, customer.name)}
          className="flex-1 h-12 bg-success-500 hover:bg-success-700 active:scale-[0.98] text-white rounded-xl flex items-center justify-center gap-2 font-semibold text-sm shadow-theme-sm transition-all"
        >
          <span className="material-symbols-outlined text-[22px]">chat</span>
          <span>Nhắn Zalo</span>
        </button>
      </footer>
    </div>
  );
};
