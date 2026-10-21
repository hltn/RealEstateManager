import React, { useState } from 'react';
import { Customer } from '../types';

interface EditInvestmentViewProps {
  customer: Customer;
  onBack: () => void;
  onSave: (updatedInvestment: any) => void;
}

export const EditInvestmentView: React.FC<EditInvestmentViewProps> = ({
  customer,
  onBack,
  onSave,
}) => {
  const inv = customer.investmentInfo || {
    projects: ["Q'Terra", 'The Privia'],
    budgetMin: '5 tỷ',
    budgetMax: '7 tỷ',
    ownCapitalRatio: '60% (Cần vay 40%)',
    needsLoanSupport: true,
    propertyType: 'Căn hộ chung cư',
    bedrooms: '3PN',
    purposes: ['Đầu tư lâu dài & Cho thuê', 'Tích sản cho con'],
    priorityCriteria: ['View sông / Công viên', 'Tầng cao thoáng', 'Gần trường quốc tế'],
    searchArea: 'Quận 7, TP.HCM',
    specificLocation: 'Khu vực Phú Mỹ Hưng, ven sông Nam Sài Gòn',
    source: "Facebook Ads - Chiến dịch Q'Terra",
    targetTimeline: 'Quý 4/2026 (Khi ra hàng đợt 2)',
  };

  const [projects, setProjects] = useState<string[]>(inv.projects);
  const [budgetMin, setBudgetMin] = useState(inv.budgetMin);
  const [budgetMax, setBudgetMax] = useState(inv.budgetMax);
  const [ownCapitalRatio, setOwnCapitalRatio] = useState(inv.ownCapitalRatio);
  const [needsLoanSupport, setNeedsLoanSupport] = useState(inv.needsLoanSupport);
  const [propertyType, setPropertyType] = useState(inv.propertyType);
  const [bedrooms, setBedrooms] = useState(inv.bedrooms);
  const [purposes, setPurposes] = useState<string[]>(inv.purposes);
  const [priorityCriteria, setPriorityCriteria] = useState<string[]>(inv.priorityCriteria);
  const [searchArea, setSearchArea] = useState(inv.searchArea);
  const [specificLocation, setSpecificLocation] = useState(inv.specificLocation);
  const [source, setSource] = useState(inv.source);
  const [targetTimeline, setTargetTimeline] = useState(inv.targetTimeline);

  const [newPurposeInput, setNewPurposeInput] = useState('');
  const [newCriteriaInput, setNewCriteriaInput] = useState('');

  const addProject = (proj: string) => {
    if (!projects.includes(proj)) {
      setProjects([...projects, proj]);
    }
  };

  const removeProject = (proj: string) => {
    setProjects(projects.filter((p) => p !== proj));
  };

  const addPurpose = () => {
    if (newPurposeInput.trim() && !purposes.includes(newPurposeInput.trim())) {
      setPurposes([...purposes, newPurposeInput.trim()]);
      setNewPurposeInput('');
    }
  };

  const addCriteria = () => {
    if (newCriteriaInput.trim() && !priorityCriteria.includes(newCriteriaInput.trim())) {
      setPriorityCriteria([...priorityCriteria, newCriteriaInput.trim()]);
      setNewCriteriaInput('');
    }
  };

  const handleSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    onSave({
      projects,
      budgetMin,
      budgetMax,
      ownCapitalRatio,
      needsLoanSupport,
      propertyType,
      bedrooms,
      purposes,
      priorityCriteria,
      searchArea,
      specificLocation,
      source,
      targetTimeline,
    });
  };

  return (
    <div className="w-full max-w-[390px] min-h-screen bg-gray-50 flex flex-col relative pb-28 mx-auto animate-in fade-in duration-200">
      {/* Top Sticky Header */}
      <header className="sticky top-0 z-50 bg-white/95 backdrop-blur-md px-4 h-[68px] flex items-center justify-between border-b border-gray-200 shadow-theme-xs">
        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-label="Quay lại"
            onClick={onBack}
            className="w-9 h-9 rounded-lg flex items-center justify-center text-gray-700 hover:bg-gray-100 active:scale-95 transition-transform"
          >
            <span className="material-symbols-outlined text-[22px]">arrow_back</span>
          </button>
          <div className="flex flex-col">
            <h1 className="font-semibold text-gray-900 leading-tight text-sm">
              Cập nhật Thông tin đầu tư
            </h1>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className="text-[11px] text-gray-600">{customer.name}</span>
              {customer.isVip && (
                <span className="inline-flex items-center px-1.5 py-0.2 rounded-full bg-warning-50 text-warning-700 text-[10px] font-semibold border border-warning-700/20">
                  VIP
                </span>
              )}
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={() => handleSubmit()}
          className="h-9 px-3.5 bg-brand-500 text-white font-medium text-xs rounded-lg shadow-theme-xs hover:bg-brand-600 active:scale-95 transition-all flex items-center gap-1"
        >
          <span>Lưu</span>
        </button>
      </header>

      {/* Form Content */}
      <form onSubmit={handleSubmit} className="px-4 py-4 flex flex-col gap-4">
        {/* SECTION 1: Dự án quan tâm */}
        <section className="bg-white rounded-2xl border border-gray-200 p-4 shadow-theme-xs flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <label className="text-label-xs text-gray-500 tracking-wider flex items-center gap-0.5 uppercase">
              DỰ ÁN QUAN TÂM <span className="text-brand-500 font-bold">*</span>
            </label>
            <span className="text-label-xs text-brand-600 font-medium">Đã chọn: {projects.length}</span>
          </div>

          <div className="flex flex-wrap gap-2">
            {projects.map((proj) => (
              <span
                key={proj}
                className="inline-flex items-center gap-1.5 pl-3 pr-2 py-1 bg-brand-50 border border-brand-200 rounded-full text-brand-700 font-medium text-label-xs"
              >
                {proj}
                <button
                  type="button"
                  onClick={() => removeProject(proj)}
                  className="w-4 h-4 rounded-full inline-flex items-center justify-center hover:bg-brand-200/60 text-brand-600"
                >
                  <span className="material-symbols-outlined text-[14px]">close</span>
                </button>
              </span>
            ))}
          </div>

          {/* Quick suggestions */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 pt-0.5 no-scrollbar">
            <span className="text-label-xs text-gray-400 shrink-0">Gợi ý:</span>
            {['Lumiere Riverside', 'Masteri Centre Point', 'Vinhomes Ocean Park'].map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => addProject(item)}
                className="shrink-0 px-2.5 py-0.5 bg-gray-100 hover:bg-gray-200 rounded-full text-gray-700 text-label-xs transition-colors"
              >
                + {item}
              </button>
            ))}
          </div>
        </section>

        {/* SECTION 2: Tài chính & Nguồn vốn */}
        <section className="bg-white rounded-2xl border border-gray-200 p-4 shadow-theme-xs flex flex-col gap-3.5">
          <div className="flex items-center justify-between border-b border-gray-100 pb-2">
            <h2 className="text-title-md font-bold text-gray-900 flex items-center gap-1.5">
              <span className="material-symbols-outlined text-brand-500 text-[20px]">
                account_balance_wallet
              </span>
              Tài chính & Nguồn vốn
            </h2>
            <span className="px-2 py-0.5 rounded-full bg-success-50 text-success-700 text-[11px] font-medium">
              Khách Net
            </span>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-label-xs uppercase text-gray-500 tracking-wider">
              KHOẢNG NGÂN SÁCH DỰ KIẾN <span className="text-brand-500 font-bold">*</span>
            </label>
            <div className="grid grid-cols-2 gap-2">
              <div className="relative">
                <span className="absolute inset-y-0 left-0 pl-2.5 flex items-center text-label-xs text-gray-400 pointer-events-none">
                  Từ
                </span>
                <input
                  type="text"
                  value={budgetMin}
                  onChange={(e) => setBudgetMin(e.target.value)}
                  className="w-full h-10 pl-8 pr-3 text-xs font-semibold text-gray-900 bg-white border border-gray-200 rounded-lg focus:border-brand-500 outline-none"
                />
              </div>
              <div className="relative">
                <span className="absolute inset-y-0 left-0 pl-2.5 flex items-center text-label-xs text-gray-400 pointer-events-none">
                  Đến
                </span>
                <input
                  type="text"
                  value={budgetMax}
                  onChange={(e) => setBudgetMax(e.target.value)}
                  className="w-full h-10 pl-10 pr-3 text-xs font-semibold text-gray-900 bg-white border border-gray-200 rounded-lg focus:border-brand-500 outline-none"
                />
              </div>
            </div>
            <p className="text-label-xs text-gray-500 italic">
              Khung tài chính phổ biến phân khúc căn hộ cao cấp
            </p>
          </div>

          {/* Tỷ lệ vốn tự có */}
          <div className="flex flex-col gap-1.5 pt-1">
            <label className="text-label-xs uppercase text-gray-500 tracking-wider">
              TỶ LỆ VỐN TỰ CÓ
            </label>
            <div className="grid grid-cols-2 gap-2">
              {[
                '100% Tiền mặt',
                '60% (Cần vay 40%)',
                '50% (Cần vay 50%)',
                'Khác...',
              ].map((ratio) => (
                <button
                  key={ratio}
                  type="button"
                  onClick={() => setOwnCapitalRatio(ratio)}
                  className={`h-10 px-3 flex items-center justify-between rounded-lg text-xs transition-colors ${
                    ownCapitalRatio === ratio
                      ? 'border-2 border-brand-500 bg-brand-50/50 text-brand-700 font-semibold shadow-theme-xs'
                      : 'border border-gray-200 text-gray-700 hover:border-gray-300'
                  }`}
                >
                  <span>{ratio}</span>
                  <span
                    className={`w-3.5 h-3.5 rounded-full border ${
                      ownCapitalRatio === ratio
                        ? 'border-4 border-brand-500 bg-white'
                        : 'border-gray-300'
                    }`}
                  />
                </button>
              ))}
            </div>
          </div>

          <div className="pt-1">
            <label className="flex items-center gap-2.5 p-3 rounded-lg border border-brand-100 bg-brand-25 cursor-pointer">
              <input
                type="checkbox"
                checked={needsLoanSupport}
                onChange={(e) => setNeedsLoanSupport(e.target.checked)}
                className="w-4 h-4 text-brand-500 rounded border-gray-300 focus:ring-brand-500/20"
              />
              <div className="flex flex-col">
                <span className="font-semibold text-gray-900 text-xs">
                  Cần gói hỗ trợ lãi suất / ân hạn nợ gốc
                </span>
                <span className="text-label-xs text-brand-700">
                  Ưu tiên ngân hàng đối tác liên kết dự án
                </span>
              </div>
            </label>
          </div>
        </section>

        {/* SECTION 3: Nhu cầu & Loại hình BĐS */}
        <section className="bg-white rounded-2xl border border-gray-200 p-4 shadow-theme-xs flex flex-col gap-3.5">
          <div className="border-b border-gray-100 pb-2">
            <h2 className="text-title-md font-bold text-gray-900 flex items-center gap-1.5">
              <span className="material-symbols-outlined text-brand-500 text-[20px]">apartment</span>
              Nhu cầu & Tiêu chí BĐS
            </h2>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-label-xs uppercase text-gray-500 tracking-wider">
              LOẠI HÌNH BẤT ĐỘNG SẢN
            </label>
            <div className="flex flex-wrap gap-2">
              {['Căn hộ chung cư', 'Nhà phố / Shophouse', 'Biệt thự / Villa', 'Đất nền'].map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => setPropertyType(type)}
                  className={`h-8 px-3 rounded-lg text-xs font-medium transition-colors ${
                    propertyType === type
                      ? 'bg-brand-50 border border-brand-500 text-brand-600'
                      : 'bg-white border border-gray-200 text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  {type}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-label-xs uppercase text-gray-500 tracking-wider">
              SỐ PHÒNG NGỦ / DIỆN TÍCH
            </label>
            <div className="grid grid-cols-4 gap-2">
              {['1PN', '2PN', '3PN', 'Duplex'].map((room) => (
                <button
                  key={room}
                  type="button"
                  onClick={() => setBedrooms(room)}
                  className={`h-9 rounded-lg text-xs transition-colors ${
                    bedrooms === room
                      ? 'border-2 border-brand-500 bg-brand-50 text-brand-600 font-semibold'
                      : 'border border-gray-200 text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  {room}
                </button>
              ))}
            </div>
          </div>

          {/* Mục đích mua */}
          <div className="flex flex-col gap-2">
            <label className="text-label-xs uppercase text-gray-500 tracking-wider">
              MỤC ĐÍCH MUA
            </label>
            <div className="flex flex-wrap gap-2">
              {purposes.map((p, i) => (
                <span
                  key={i}
                  className="inline-flex items-center gap-1.5 pl-3 pr-2 py-1 bg-brand-50 border border-brand-200 rounded-full text-brand-700 font-medium text-label-xs"
                >
                  {p}
                  <button
                    type="button"
                    onClick={() => setPurposes(purposes.filter((_, idx) => idx !== i))}
                    className="w-4 h-4 rounded-full inline-flex items-center justify-center hover:bg-brand-200/60 text-brand-600"
                  >
                    <span className="material-symbols-outlined text-[14px]">close</span>
                  </button>
                </span>
              ))}
            </div>
            <div className="relative">
              <input
                type="text"
                value={newPurposeInput}
                onChange={(e) => setNewPurposeInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addPurpose();
                  }
                }}
                placeholder="+ Nhập mục đích mua và nhấn Enter..."
                className="w-full h-10 pl-3 pr-10 text-body-md text-gray-900 bg-white border border-gray-200 rounded-lg focus:border-brand-500 outline-none"
              />
              <button
                type="button"
                onClick={addPurpose}
                className="absolute inset-y-0 right-0 pr-3 flex items-center text-brand-500"
              >
                <span className="material-symbols-outlined text-[20px]">add</span>
              </button>
            </div>
          </div>

          {/* Tiêu chí ưu tiên */}
          <div className="flex flex-col gap-2 pt-1">
            <label className="text-label-xs uppercase text-gray-500 tracking-wider">
              TIÊU CHÍ ƯU TIÊN
            </label>
            <div className="flex flex-wrap gap-2">
              {priorityCriteria.map((c, i) => (
                <span
                  key={i}
                  className="inline-flex items-center gap-1.5 pl-3 pr-2 py-1 bg-brand-50 border border-brand-200 rounded-full text-brand-700 font-medium text-label-xs"
                >
                  {c}
                  <button
                    type="button"
                    onClick={() =>
                      setPriorityCriteria(priorityCriteria.filter((_, idx) => idx !== i))
                    }
                    className="w-4 h-4 rounded-full inline-flex items-center justify-center hover:bg-brand-200/60 text-brand-600"
                  >
                    <span className="material-symbols-outlined text-[14px]">close</span>
                  </button>
                </span>
              ))}
            </div>
            <div className="relative">
              <input
                type="text"
                value={newCriteriaInput}
                onChange={(e) => setNewCriteriaInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addCriteria();
                  }
                }}
                placeholder="+ Nhập tiêu chí ưu tiên và nhấn Enter..."
                className="w-full h-10 pl-3 pr-10 text-body-md text-gray-900 bg-white border border-gray-200 rounded-lg focus:border-brand-500 outline-none"
              />
              <button
                type="button"
                onClick={addCriteria}
                className="absolute inset-y-0 right-0 pr-3 flex items-center text-brand-500"
              >
                <span className="material-symbols-outlined text-[20px]">add</span>
              </button>
            </div>
          </div>
        </section>

        {/* SECTION 4: Khu vực & Địa bàn tìm kiếm */}
        <section className="bg-white rounded-2xl border border-gray-200 p-4 shadow-theme-xs flex flex-col gap-3">
          <div className="border-b border-gray-100 pb-2">
            <h2 className="text-title-md font-bold text-gray-900 flex items-center gap-1.5">
              <span className="material-symbols-outlined text-brand-500 text-[20px]">
                location_on
              </span>
              Khu vực & Địa bàn tìm kiếm
            </h2>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-label-xs uppercase text-gray-500 tracking-wider">
              KHU VỰC TÌM KIẾM / NƠI Ở HIỆN TẠI
            </label>
            <select
              value={searchArea}
              onChange={(e) => setSearchArea(e.target.value)}
              className="w-full h-10 px-3 pr-8 text-body-md text-gray-900 bg-white border border-gray-200 rounded-lg focus:border-brand-500 outline-none"
            >
              <option value="Quận 7, TP.HCM">Quận 7, TP.HCM</option>
              <option value="TP. Thủ Đức, TP.HCM">TP. Thủ Đức, TP.HCM</option>
              <option value="Nhà Bè, TP.HCM">Nhà Bè, TP.HCM</option>
              <option value="Quận 2 (Cũ), TP.HCM">Quận 2 (Cũ), TP.HCM</option>
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-label-xs uppercase text-gray-500 tracking-wider">
              BÁN KÍNH / VỊ TRÍ CỤ THỂ
            </label>
            <input
              type="text"
              value={specificLocation}
              onChange={(e) => setSpecificLocation(e.target.value)}
              className="w-full h-10 px-3 text-body-md text-gray-900 bg-white border border-gray-200 rounded-lg focus:border-brand-500 outline-none"
            />
          </div>
        </section>

        {/* SECTION 5: Nguồn khách & Kế hoạch */}
        <section className="bg-white rounded-2xl border border-gray-200 p-4 shadow-theme-xs flex flex-col gap-3">
          <div className="border-b border-gray-100 pb-2">
            <h2 className="text-title-md font-bold text-gray-900 flex items-center gap-1.5">
              <span className="material-symbols-outlined text-brand-500 text-[20px]">flag</span>
              Nguồn khách & Kế hoạch
            </h2>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-label-xs uppercase text-gray-500 tracking-wider">
              NGUỒN KHÁCH
            </label>
            <select
              value={source}
              onChange={(e) => setSource(e.target.value)}
              className="w-full h-10 px-3 text-body-md text-gray-900 bg-white border border-gray-200 rounded-lg focus:border-brand-500 outline-none"
            >
              <option value="Facebook Ads - Chiến dịch Q'Terra">Facebook Ads - Chiến dịch Q'Terra</option>
              <option value="Website STND">Website STND</option>
              <option value="Hotline công ty">Hotline công ty</option>
              <option value="Khách giới thiệu (Referral)">Khách giới thiệu (Referral)</option>
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-label-xs uppercase text-gray-500 tracking-wider">
              THỜI ĐIỂM DỰ KIẾN MUA / CHỐT DEAL
            </label>
            <select
              value={targetTimeline}
              onChange={(e) => setTargetTimeline(e.target.value)}
              className="w-full h-10 px-3 text-xs font-semibold text-brand-700 bg-brand-50/40 border border-brand-200 rounded-lg focus:border-brand-500 outline-none"
            >
              <option value="Quý 4/2026 (Khi ra hàng đợt 2)">Quý 4/2026 (Khi ra hàng đợt 2)</option>
              <option value="Trong 1 tháng tới">Trong 1 tháng tới</option>
              <option value="Trong 3 tháng tới">Trong 3 tháng tới</option>
            </select>
          </div>
        </section>
      </form>

      {/* Bottom Action Footer */}
      <div className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[390px] z-40 bg-white border-t border-gray-200 p-4 shadow-theme-md">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            className="w-1/3 h-12 bg-gray-100 hover:bg-gray-200 active:scale-95 text-gray-700 font-medium text-xs rounded-lg transition-all flex items-center justify-center"
          >
            Hủy bỏ
          </button>
          <button
            type="button"
            onClick={() => handleSubmit()}
            className="w-2/3 h-12 bg-brand-500 hover:bg-brand-600 active:scale-95 text-white font-medium text-xs rounded-lg shadow-theme-xs transition-all flex items-center justify-center gap-1.5"
          >
            <span className="material-symbols-outlined text-[20px]">save</span>
            <span>Lưu thông tin đầu tư</span>
          </button>
        </div>
      </div>
    </div>
  );
};
