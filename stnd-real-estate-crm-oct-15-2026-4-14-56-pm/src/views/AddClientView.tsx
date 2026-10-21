import React, { useState } from 'react';
import { Customer } from '../types';

interface AddClientViewProps {
  onBack: () => void;
  onSaveClient: (newClient: Customer) => void;
  existingCustomers: Customer[];
}

export const AddClientView: React.FC<AddClientViewProps> = ({
  onBack,
  onSaveClient,
  existingCustomers,
}) => {
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [idNumber, setIdNumber] = useState('');
  const [location, setLocation] = useState('Quận 7, TP.HCM');

  const [selectedProjects, setSelectedProjects] = useState<string[]>(["Q'Terra", 'The Privia']);
  const [status, setStatus] = useState<'uncontacted' | 'caring' | 'hot'>('caring');
  const [source, setSource] = useState('web');
  const [budgetMin, setBudgetMin] = useState('3 tỷ');
  const [budgetMax, setBudgetMax] = useState('5 tỷ');
  const [assignee, setAssignee] = useState('Hạnh ★ (Bạn - Tư vấn viên chính)');

  // Phone duplicate verification logic
  const isDuplicate = existingCustomers.some(
    (c) => phone.length >= 9 && c.phone.replace(/\D/g, '') === phone.replace(/\D/g, '')
  );

  const toggleProject = (p: string) => {
    if (selectedProjects.includes(p)) {
      setSelectedProjects(selectedProjects.filter((item) => item !== p));
    } else {
      setSelectedProjects([...selectedProjects, p]);
    }
  };

  const handleSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!fullName.trim() || !phone.trim()) {
      alert('Vui lòng nhập Họ tên và Số điện thoại khách hàng!');
      return;
    }

    const newCust: Customer = {
      id: `kh-${Date.now()}`,
      code: `#${String(existingCustomers.length + 1).padStart(2, '0')}`,
      name: fullName.trim(),
      phone: phone.trim(),
      email: email.trim() || undefined,
      idNumber: idNumber.trim() || undefined,
      status: status === 'hot' ? 'hot' : 'caring',
      statusLabel: status === 'hot' ? 'Khách net' : status === 'uncontacted' ? 'Chưa tiếp cận' : 'Có quan tâm',
      project: selectedProjects[0] || "Q'Terra",
      progressStep: 1,
      progressPercent: 25,
      assignedLead: 'Hạnh ★',
      assignedMembers: [],
      nextAppointmentDate: 'Hôm nay',
      appointmentTime: '10:00',
      isVip: status === 'hot',
      category: 'today',
      notesSummary: `Tiếp nhận từ kênh ${source}, quan tâm dự án ${selectedProjects.join(', ')}`,
      currentResidence: location,
      investmentInfo: {
        projects: selectedProjects,
        budgetMin,
        budgetMax,
        ownCapitalRatio: '60% (Cần vay 40%)',
        needsLoanSupport: true,
        propertyType: 'Căn hộ chung cư',
        bedrooms: '2PN',
        purposes: ['Đầu tư & Cho thuê'],
        priorityCriteria: ['Tầng cao thoáng'],
        searchArea: location,
        specificLocation: location,
        source: source === 'web' ? 'Website STND' : 'Facebook Ads',
        targetTimeline: 'Quý 4/2026',
      },
      dealCriteria: {
        demand: { met: true, text: `Quan tâm căn hộ tại ${selectedProjects[0] || "Q'Terra"}` },
        motivation: { met: false, text: 'Đang khảo sát mức giá và phương thức thanh toán.' },
        finance: { met: true, text: `Ngân sách dự kiến ${budgetMin} - ${budgetMax}.` },
        timeline: { met: false, text: 'Chờ mở bán đợt tiếp theo.' },
      },
    };

    onSaveClient(newCust);
  };

  return (
    <div className="w-full max-w-2xl mx-auto min-h-screen bg-gray-50 flex flex-col justify-between pb-28 animate-in fade-in duration-200">
      {/* TOP APP BAR */}
      <header className="sticky top-0 z-50 bg-white border-b border-gray-200 shadow-theme-xs">
        <div className="max-w-2xl mx-auto px-4 h-[68px] flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              type="button"
              aria-label="Quay lại"
              onClick={onBack}
              className="w-10 h-10 rounded-lg flex items-center justify-center text-gray-600 hover:bg-gray-100 active:scale-95 transition-all"
            >
              <span className="material-symbols-outlined text-gray-700">arrow_back</span>
            </button>
            <div>
              <h1 className="text-title-md font-bold text-gray-900 leading-tight">
                Thêm khách hàng mới
              </h1>
              <p className="text-label-xs text-gray-500">STND Real Estate CRM</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => handleSubmit()}
            className="h-9 px-4 bg-brand-500 hover:bg-brand-600 active:scale-95 text-white rounded-lg font-medium text-xs shadow-theme-xs transition-all flex items-center gap-1.5"
          >
            <span className="material-symbols-outlined text-[18px]">save</span>
            <span>Lưu khách</span>
          </button>
        </div>
      </header>

      {/* MAIN CANVAS */}
      <main className="flex-1 max-w-2xl w-full mx-auto px-4 py-4 space-y-4">
        {/* DUPLICATE CHECK ALERT BANNER */}
        <div className="bg-brand-50 border border-brand-200 rounded-xl p-3.5 flex items-start gap-3 shadow-theme-xs">
          <div className="w-8 h-8 rounded-lg bg-brand-100 text-brand-600 flex items-center justify-center shrink-0 mt-0.5">
            <span className="material-symbols-outlined text-[20px]">verified_user</span>
          </div>
          <div className="flex-1">
            <h4 className="font-semibold text-brand-900 text-xs">Kiểm tra trùng số điện thoại</h4>
            <p className="text-label-xs text-brand-700 mt-0.5 leading-relaxed">
              Khi nhập SĐT, hệ thống sẽ tự động đối soát tránh trùng lặp giữa các chuyên viên tư vấn và bảo vệ quyền lợi chia hoa hồng.
            </p>
          </div>
        </div>

        {/* FORM CONTAINER */}
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* SECTION 1: THÔNG TIN CƠ BẢN */}
          <section className="bg-white border border-gray-200 rounded-2xl p-4 sm:p-5 shadow-theme-xs">
            <div className="flex items-center justify-between border-b border-gray-100 pb-3 mb-4">
              <div className="flex items-center gap-2">
                <span className="w-2 h-4 bg-brand-500 rounded-full inline-block"></span>
                <h2 className="text-body-lg-bold font-bold text-gray-900 tracking-tight">
                  1. THÔNG TIN CƠ BẢN
                </h2>
              </div>
              <span className="text-label-xs text-gray-400 uppercase">Bắt buộc nhập</span>
            </div>

            <div className="space-y-3.5">
              {/* Họ và tên */}
              <div>
                <label className="block text-label-xs uppercase text-gray-500 mb-1.5">
                  Họ và tên khách hàng <span className="text-brand-500">*</span>
                </label>
                <div className="relative">
                  <span className="material-symbols-outlined absolute left-3 top-2.5 text-gray-400 text-[18px]">
                    person
                  </span>
                  <input
                    type="text"
                    required
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="Ví dụ: Nguyễn Văn A"
                    className="w-full h-10 pl-9 pr-3 text-body-md text-gray-900 bg-white border border-gray-200 rounded-lg placeholder-gray-400 focus:border-brand-500 outline-none"
                  />
                </div>
              </div>

              {/* Số điện thoại & Live Check */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-label-xs uppercase text-gray-500">
                    Số điện thoại <span className="text-brand-500">*</span>
                  </label>
                  {isDuplicate ? (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-label-xs bg-error-50 text-error-600 border border-error-100">
                      <span className="material-symbols-outlined text-[13px]">warning</span>
                      Trùng: Chuyên viên Tuấn đang phụ trách
                    </span>
                  ) : phone.length >= 9 ? (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-label-xs bg-success-50 text-success-700 border border-success-100">
                      <span className="material-symbols-outlined text-[13px]">check_circle</span>
                      Sẵn sàng tiếp nhận
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-label-xs bg-brand-50 text-brand-600 border border-brand-100">
                      <span className="material-symbols-outlined text-[13px]">sync</span>
                      Nhập để đối soát...
                    </span>
                  )}
                </div>
                <div className="relative">
                  <span className="material-symbols-outlined absolute left-3 top-2.5 text-gray-400 text-[18px]">
                    call
                  </span>
                  <input
                    type="tel"
                    required
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="0912 xxx xxx"
                    className="w-full h-10 pl-9 pr-10 text-body-md text-gray-900 bg-white border border-gray-200 rounded-lg placeholder-gray-400 focus:border-brand-500 outline-none font-mono"
                  />
                  <span className="material-symbols-outlined absolute right-3 top-2.5 text-success-500 text-[18px]">
                    bolt
                  </span>
                </div>
              </div>

              {/* Email */}
              <div>
                <label className="block text-label-xs uppercase text-gray-500 mb-1.5">
                  Email cá nhân
                </label>
                <div className="relative">
                  <span className="material-symbols-outlined absolute left-3 top-2.5 text-gray-400 text-[18px]">
                    mail
                  </span>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="khachhang@stnd.vn (tùy chọn)"
                    className="w-full h-10 pl-9 pr-3 text-body-md text-gray-900 bg-white border border-gray-200 rounded-lg placeholder-gray-400 focus:border-brand-500 outline-none"
                  />
                </div>
              </div>

              {/* CCCD / Định danh */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-label-xs uppercase text-gray-500">
                    Số CCCD / Định danh
                  </label>
                  <span className="text-[11px] text-gray-400 flex items-center gap-1">
                    <span className="material-symbols-outlined text-[13px]">lock</span>
                    Mã hóa bảo mật
                  </span>
                </div>
                <div className="relative">
                  <span className="material-symbols-outlined absolute left-3 top-2.5 text-gray-400 text-[18px]">
                    badge
                  </span>
                  <input
                    type="text"
                    value={idNumber}
                    onChange={(e) => setIdNumber(e.target.value)}
                    placeholder="0010xxxx9876 (Dùng cho hợp đồng cọc)"
                    className="w-full h-10 pl-9 pr-3 text-body-md text-gray-900 bg-white border border-gray-200 rounded-lg placeholder-gray-400 focus:border-brand-500 outline-none font-mono"
                  />
                </div>
              </div>

              {/* Khu vực nơi ở */}
              <div>
                <label className="block text-label-xs uppercase text-gray-500 mb-1.5">
                  Khu vực nơi ở / Địa chỉ
                </label>
                <div className="relative">
                  <span className="material-symbols-outlined absolute left-3 top-2.5 text-gray-400 text-[18px]">
                    location_on
                  </span>
                  <select
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                    className="w-full h-10 pl-9 pr-8 text-body-md text-gray-700 bg-white border border-gray-200 rounded-lg focus:border-brand-500 outline-none appearance-none"
                  >
                    <option value="Quận 7, TP.HCM">Quận 7, TP.HCM</option>
                    <option value="TP. Thủ Đức, TP.HCM">TP. Thủ Đức, TP.HCM</option>
                    <option value="Quận 1, TP.HCM">Quận 1, TP.HCM</option>
                    <option value="Quận Bình Thạnh, TP.HCM">Quận Bình Thạnh, TP.HCM</option>
                    <option value="Hà Nội (Khu vực trung tâm)">Hà Nội (Khu vực trung tâm)</option>
                  </select>
                  <span className="material-symbols-outlined absolute right-2.5 top-2.5 text-gray-400 pointer-events-none text-[20px]">
                    expand_more
                  </span>
                </div>
              </div>
            </div>
          </section>

          {/* SECTION 2: NHU CẦU & DỰ ÁN QUAN TÂM */}
          <section className="bg-white border border-gray-200 rounded-2xl p-4 sm:p-5 shadow-theme-xs">
            <div className="flex items-center justify-between border-b border-gray-100 pb-3 mb-4">
              <div className="flex items-center gap-2">
                <span className="w-2 h-4 bg-orange-400 rounded-full inline-block"></span>
                <h2 className="text-body-lg-bold font-bold text-gray-900 tracking-tight">
                  2. NHU CẦU & DỰ ÁN QUAN TÂM
                </h2>
              </div>
              <span className="text-label-xs text-gray-400 uppercase">Khảo sát</span>
            </div>

            <div className="space-y-4">
              {/* Dự án quan tâm */}
              <div>
                <label className="block text-label-xs uppercase text-gray-500 mb-2">
                  Dự án quan tâm
                </label>
                <div className="flex flex-wrap gap-2">
                  {[
                    "Q'Terra Diamond",
                    'The Privia',
                    'Ecopark Grand',
                    'Aqua City Waterfront',
                    'Vinhomes Grand Park',
                  ].map((proj) => {
                    const isSelected = selectedProjects.includes(proj);
                    return (
                      <button
                        key={proj}
                        type="button"
                        onClick={() => toggleProject(proj)}
                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-label-xs font-medium border transition-all ${
                          isSelected
                            ? 'border-brand-500 bg-brand-500 text-white shadow-theme-xs'
                            : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
                        }`}
                      >
                        <span className="material-symbols-outlined text-[14px]">
                          apartment
                        </span>
                        {proj}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Tình trạng ban đầu */}
              <div>
                <label className="block text-label-xs uppercase text-gray-500 mb-2">
                  Tình trạng ban đầu
                </label>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => setStatus('uncontacted')}
                    className={`h-10 px-2 rounded-lg border text-xs font-medium transition-all ${
                      status === 'uncontacted'
                        ? 'bg-gray-100 text-gray-900 border-gray-400 font-semibold'
                        : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    Chưa tiếp cận
                  </button>
                  <button
                    type="button"
                    onClick={() => setStatus('caring')}
                    className={`h-10 px-2 rounded-lg border text-xs font-medium transition-all ${
                      status === 'caring'
                        ? 'bg-brand-500 text-white border-brand-500 font-semibold shadow-theme-xs'
                        : 'border-brand-200 bg-brand-50 text-brand-600'
                    }`}
                  >
                    Có quan tâm
                  </button>
                  <button
                    type="button"
                    onClick={() => setStatus('hot')}
                    className={`h-10 px-2 rounded-lg border text-xs font-medium transition-all ${
                      status === 'hot'
                        ? 'bg-warning-500 text-white border-warning-500 font-semibold shadow-theme-xs'
                        : 'border-warning-500/30 bg-warning-50 text-warning-700'
                    }`}
                  >
                    Khách net (nóng)
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                {/* Nguồn khách */}
                <div>
                  <label className="block text-label-xs uppercase text-gray-500 mb-1.5">
                    Nguồn khách
                  </label>
                  <div className="relative">
                    <span className="material-symbols-outlined absolute left-3 top-2.5 text-gray-400 text-[18px]">
                      share
                    </span>
                    <select
                      value={source}
                      onChange={(e) => setSource(e.target.value)}
                      className="w-full h-10 pl-9 pr-8 text-body-md text-gray-700 bg-white border border-gray-200 rounded-lg focus:border-brand-500 outline-none"
                    >
                      <option value="web">Website STND</option>
                      <option value="fb">Facebook Ads</option>
                      <option value="referral">Giới thiệu (Referral)</option>
                      <option value="telesale">Telesale / Offline</option>
                    </select>
                  </div>
                </div>

                {/* Ngân sách */}
                <div>
                  <label className="block text-label-xs uppercase text-gray-500 mb-1.5">
                    Ngân sách dự kiến (VNĐ)
                  </label>
                  <div className="flex items-center gap-2">
                    <div className="relative flex-1">
                      <input
                        type="text"
                        value={budgetMin}
                        onChange={(e) => setBudgetMin(e.target.value)}
                        placeholder="Từ: 3 tỷ"
                        className="w-full h-10 px-3 text-body-md text-gray-900 bg-white border border-gray-200 rounded-lg outline-none focus:border-brand-500 font-mono text-xs"
                      />
                    </div>
                    <span className="text-gray-400">—</span>
                    <div className="relative flex-1">
                      <input
                        type="text"
                        value={budgetMax}
                        onChange={(e) => setBudgetMax(e.target.value)}
                        placeholder="Đến: 5 tỷ"
                        className="w-full h-10 px-3 text-body-md text-gray-900 bg-white border border-gray-200 rounded-lg outline-none focus:border-brand-500 font-mono text-xs"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* SECTION 3: PHÂN BỔ NHÂN SỰ */}
          <section className="bg-white border border-gray-200 rounded-2xl p-4 sm:p-5 shadow-theme-xs">
            <div className="flex items-center justify-between border-b border-gray-100 pb-3 mb-4">
              <div className="flex items-center gap-2">
                <span className="w-2 h-4 bg-purple-500 rounded-full inline-block"></span>
                <h2 className="text-body-lg-bold font-bold text-gray-900 tracking-tight">
                  3. PHÂN BỔ NHÂN SỰ
                </h2>
              </div>
              <span className="text-label-xs text-gray-400 uppercase">Vận hành</span>
            </div>

            <div>
              <label className="block text-label-xs uppercase text-gray-500 mb-1.5">
                Nhân viên phụ trách chính
              </label>
              <div className="relative">
                <span className="material-symbols-outlined absolute left-3 top-2.5 text-gray-400 text-[18px]">
                  support_agent
                </span>
                <select
                  value={assignee}
                  onChange={(e) => setAssignee(e.target.value)}
                  className="w-full h-10 pl-9 pr-8 text-body-md text-gray-800 bg-white border border-gray-200 rounded-lg focus:border-brand-500 outline-none font-medium"
                >
                  <option value="Hạnh ★ (Bạn - Tư vấn viên chính)">Hạnh ★ (Bạn - Tư vấn viên chính)</option>
                  <option value="Thảo - Trưởng nhóm 2">Thảo - Trưởng nhóm 2</option>
                  <option value="Tuấn - Chuyên viên cao cấp">Tuấn - Chuyên viên cao cấp</option>
                  <option value="Minh ★ - Chuyên viên dự án Privia">Minh ★ - Chuyên viên dự án Privia</option>
                </select>
                <span className="material-symbols-outlined absolute right-2.5 top-2.5 text-gray-400 pointer-events-none text-[20px]">
                  expand_more
                </span>
              </div>
            </div>
          </section>
        </form>
      </main>

      {/* BOTTOM STICKY ACTION BAR */}
      <footer className="fixed bottom-0 inset-x-0 bg-white border-t border-gray-200 p-3 sm:p-4 z-40 shadow-theme-md">
        <div className="max-w-2xl mx-auto flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onBack}
            className="w-1/3 sm:w-36 h-11 bg-gray-100 hover:bg-gray-200 border border-gray-200 text-gray-700 rounded-lg font-medium text-xs transition-all active:scale-95 flex items-center justify-center gap-1.5"
          >
            <span className="material-symbols-outlined text-[18px]">close</span>
            <span>Hủy</span>
          </button>
          <button
            type="button"
            onClick={() => handleSubmit()}
            className="flex-1 sm:flex-initial sm:w-56 h-11 bg-brand-500 hover:bg-brand-600 active:scale-[0.99] text-white rounded-lg font-medium text-xs shadow-theme-sm transition-all flex items-center justify-center gap-2"
          >
            <span className="material-symbols-outlined text-[20px]">check_circle</span>
            <span>Lưu khách hàng</span>
          </button>
        </div>
      </footer>
    </div>
  );
};
