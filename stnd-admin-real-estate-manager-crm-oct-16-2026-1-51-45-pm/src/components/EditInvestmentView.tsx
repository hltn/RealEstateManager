import React, { useState } from 'react';
import { Customer } from '../types/crm';

interface EditInvestmentViewProps {
  customer: Customer;
  onSave: (updated: Customer) => void;
  onCancel: () => void;
}

export const EditInvestmentView: React.FC<EditInvestmentViewProps> = ({
  customer,
  onSave,
  onCancel
}) => {
  const [formData, setFormData] = useState<Customer>({ ...customer });
  const [projectSearch, setProjectSearch] = useState('');
  const [newPurposeInput, setNewPurposeInput] = useState('');
  const [newPriorityInput, setNewPriorityInput] = useState('');

  const handleAddProject = (projName: string) => {
    if (!projName.trim()) return;
    if (!formData.interestedProjects.includes(projName)) {
      setFormData({
        ...formData,
        interestedProjects: [...formData.interestedProjects, projName]
      });
    }
    setProjectSearch('');
  };

  const handleRemoveProject = (projName: string) => {
    setFormData({
      ...formData,
      interestedProjects: formData.interestedProjects.filter((p) => p !== projName)
    });
  };

  const handleAddPurpose = (purp?: string) => {
    const val = (purp || newPurposeInput).trim();
    if (!val) return;
    if (!formData.purchasePurposes.includes(val)) {
      setFormData({
        ...formData,
        purchasePurposes: [...formData.purchasePurposes, val]
      });
    }
    setNewPurposeInput('');
  };

  const handleRemovePurpose = (val: string) => {
    setFormData({
      ...formData,
      purchasePurposes: formData.purchasePurposes.filter((p) => p !== val)
    });
  };

  const handleAddPriority = (prio?: string) => {
    const val = (prio || newPriorityInput).trim();
    if (!val) return;
    if (!formData.criteriaPriorities.includes(val)) {
      setFormData({
        ...formData,
        criteriaPriorities: [...formData.criteriaPriorities, val]
      });
    }
    setNewPriorityInput('');
  };

  const handleRemovePriority = (val: string) => {
    setFormData({
      ...formData,
      criteriaPriorities: formData.criteriaPriorities.filter((p) => p !== val)
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(formData);
    alert('Đã cập nhật Thông tin đầu tư thành công!');
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6 animate-in fade-in duration-200">
      {/* 1. Header & Breadcrumb */}
      <div className="bg-surface-container-lowest rounded-2xl border border-gray-200 p-6 shadow-theme-xs">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1.5">
            <nav className="flex items-center gap-2 text-xs text-gray-500 mb-2">
              <button
                type="button"
                onClick={onCancel}
                className="hover:text-brand-500 transition-colors"
              >
                Quản lý khách hàng
              </button>
              <span className="text-gray-400">›</span>
              <button
                type="button"
                onClick={onCancel}
                className="hover:text-brand-500 transition-colors"
              >
                Chi tiết khách hàng
              </button>
              <span className="text-gray-400">›</span>
              <span className="text-gray-800 font-semibold">Cập nhật Thông tin đầu tư</span>
            </nav>

            <div className="flex flex-wrap items-center gap-3 pt-1">
              <h1 className="text-2xl font-bold text-gray-900 tracking-tight">
                Cập nhật Thông tin đầu tư
              </h1>
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-gray-100 text-gray-700 text-xs font-semibold border border-gray-200">
                <span className="material-symbols-outlined text-[15px] text-gray-500">person</span>
                <span>{customer.name}</span>
              </div>
              {customer.isVip && (
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-300 shadow-theme-xs">
                  ★ VIP
                </span>
              )}
            </div>
            <p className="text-xs text-gray-500 max-w-3xl">
              Thiết lập các tiêu chí tài chính, loại hình BĐS, mục đích mua và tiến độ giao dịch phục vụ chốt deal.
            </p>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={onCancel}
              className="px-5 py-2.5 rounded-lg border border-gray-200 bg-white text-gray-700 font-medium text-xs hover:bg-gray-50 active:scale-95 transition-all shadow-theme-xs"
            >
              Hủy bỏ
            </button>
            <button
              type="submit"
              className="px-6 py-2.5 rounded-lg bg-brand-500 text-white font-medium text-xs hover:bg-brand-600 active:scale-95 transition-all shadow-theme-xs flex items-center gap-2"
            >
              <span className="material-symbols-outlined text-[18px]">save</span>
              <span>Lưu thông tin đầu tư</span>
            </button>
          </div>
        </div>
      </div>

      {/* 2. Form Workspace - 2 Equal Columns */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 pb-6">
        {/* ==================== CỘT TRÁI (~50%) ==================== */}
        <div className="space-y-6">
          {/* Section 1: Dự án quan tâm */}
          <div className="bg-surface-container-lowest rounded-2xl border border-gray-200 p-6 shadow-theme-xs space-y-5">
            <div className="flex items-center gap-2.5 pb-3 border-b border-gray-100">
              <div className="w-8 h-8 rounded-lg bg-brand-50 text-brand-500 flex items-center justify-center">
                <span className="material-symbols-outlined text-[20px]">domain</span>
              </div>
              <div>
                <h2 className="text-base font-bold text-gray-900 leading-tight">
                  Dự án quan tâm <span className="text-brand-500">*</span>
                </h2>
                <p className="text-xs text-gray-500">
                  Các khu căn hộ &amp; phân khu khách hàng đang theo dõi
                </p>
              </div>
            </div>

            {/* Selected Project Chips */}
            <div className="space-y-2">
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider">
                Dự án ưu tiên hiện tại
              </label>
              <div className="flex flex-wrap gap-2.5">
                {formData.interestedProjects.map((p) => (
                  <span
                    key={p}
                    className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-brand-50 text-brand-600 border border-brand-200 text-xs font-semibold shadow-theme-xs"
                  >
                    <span className="material-symbols-outlined text-[16px] text-brand-500">
                      apartment
                    </span>
                    <span>{p}</span>
                    <button
                      type="button"
                      onClick={() => handleRemoveProject(p)}
                      className="text-brand-400 hover:text-brand-700 transition-colors"
                      title="Xóa"
                    >
                      <span className="material-symbols-outlined text-[16px]">close</span>
                    </button>
                  </span>
                ))}
              </div>
            </div>

            {/* Search and add input */}
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider">
                Tìm kiếm thêm dự án
              </label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-[18px]">
                    search
                  </span>
                  <input
                    type="text"
                    value={projectSearch}
                    onChange={(e) => setProjectSearch(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleAddProject(projectSearch);
                      }
                    }}
                    placeholder="Tìm và thêm dự án (Masteri, Lumiere, The Rivus...)"
                    className="w-full pl-9 pr-4 py-2 text-xs bg-white border border-gray-200 rounded-lg placeholder-gray-400 focus:outline-none focus:border-brand-500 shadow-theme-xs"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => handleAddProject(projectSearch)}
                  className="px-3.5 py-2 bg-brand-500 hover:bg-brand-600 text-white rounded-lg text-xs font-semibold transition-colors"
                >
                  Thêm
                </button>
              </div>
            </div>

            {/* Quick Suggestions */}
            <div className="pt-1 flex items-center gap-2 flex-wrap text-xs">
              <span className="text-gray-400">Gợi ý nhanh:</span>
              {['Lumiere Riverside', 'Masteri Centre Point', 'Ecopark Grand', 'The Rivus'].map(
                (sug) => (
                  <button
                    key={sug}
                    type="button"
                    onClick={() => handleAddProject(sug)}
                    className="bg-gray-50 hover:bg-brand-50 hover:text-brand-600 text-gray-600 px-2.5 py-1 rounded-full border border-gray-200 transition-all flex items-center gap-1"
                  >
                    <span className="material-symbols-outlined text-[14px]">add</span>
                    <span>{sug}</span>
                  </button>
                )
              )}
            </div>
          </div>

          {/* Section 2: Tài chính & Nguồn vốn */}
          <div className="bg-surface-container-lowest rounded-2xl border border-gray-200 p-6 shadow-theme-xs space-y-5">
            <div className="flex items-center gap-2.5 pb-3 border-b border-gray-100">
              <div className="w-8 h-8 rounded-lg bg-brand-50 text-brand-500 flex items-center justify-center">
                <span className="material-symbols-outlined text-[20px]">account_balance_wallet</span>
              </div>
              <div>
                <h2 className="text-base font-bold text-gray-900 leading-tight">
                  Tài chính &amp; Nguồn vốn
                </h2>
                <p className="text-xs text-gray-500">Khung ngân sách và cơ cấu đòn bẩy ngân hàng</p>
              </div>
            </div>

            {/* Budget Range */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <label className="font-semibold text-gray-500 uppercase tracking-wider">
                  Khoảng ngân sách dự kiến (Tỷ VNĐ) <span className="text-brand-500">*</span>
                </label>
                <span className="text-brand-600 font-semibold">
                  Khoảng dao động {(formData.budgetMax - formData.budgetMin).toFixed(1)} tỷ
                </span>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-gray-400">
                    Từ
                  </span>
                  <input
                    type="number"
                    step="0.5"
                    value={formData.budgetMin}
                    onChange={(e) =>
                      setFormData({ ...formData, budgetMin: Number(e.target.value) })
                    }
                    className="w-full pl-9 pr-8 py-2 text-sm font-semibold bg-white border border-gray-200 rounded-lg text-gray-900 focus:border-brand-500 shadow-theme-xs"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400">
                    tỷ
                  </span>
                </div>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-gray-400">
                    Đến
                  </span>
                  <input
                    type="number"
                    step="0.5"
                    value={formData.budgetMax}
                    onChange={(e) =>
                      setFormData({ ...formData, budgetMax: Number(e.target.value) })
                    }
                    className="w-full pl-10 pr-8 py-2 text-sm font-semibold bg-white border border-gray-200 rounded-lg text-gray-900 focus:border-brand-500 shadow-theme-xs"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400">
                    tỷ
                  </span>
                </div>
              </div>
              <p className="text-xs text-gray-500 flex items-center gap-1.5 pt-0.5">
                <span className="material-symbols-outlined text-[15px] text-brand-500">info</span>
                <span>Khung tài chính phổ biến phân khúc căn hộ cao cấp</span>
              </p>
            </div>

            {/* Equity Ratio Radio Cards */}
            <div className="space-y-2.5">
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider">
                Tỷ lệ vốn tự có
              </label>
              <div className="grid grid-cols-2 gap-3 text-xs">
                {[
                  { title: '100% Tiền mặt', sub: '' },
                  { title: '60% (Cần vay 40%)', sub: 'Phương án tối ưu dòng tiền' },
                  { title: '50% (Cần vay 50%)', sub: '' },
                  { title: 'Khác...', sub: '' }
                ].map((item) => {
                  const isChecked = formData.equityRatio.includes(item.title.split(' ')[0]);
                  return (
                    <label
                      key={item.title}
                      onClick={() => setFormData({ ...formData, equityRatio: item.title })}
                      className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-all ${
                        isChecked
                          ? 'border-2 border-brand-500 bg-brand-50 shadow-theme-xs'
                          : 'border-gray-200 bg-white hover:bg-gray-50'
                      }`}
                    >
                      <input
                        type="radio"
                        checked={isChecked}
                        onChange={() => setFormData({ ...formData, equityRatio: item.title })}
                        className="w-4 h-4 text-brand-500 border-gray-300"
                      />
                      <div>
                        <div
                          className={`font-semibold ${
                            isChecked ? 'text-brand-700' : 'text-gray-700'
                          }`}
                        >
                          {item.title}
                        </div>
                        {item.sub && <div className="text-[11px] text-brand-600">{item.sub}</div>}
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>

            {/* Loan Incentive Checkbox */}
            <div className="bg-brand-50/70 border border-brand-200 p-3.5 rounded-xl flex items-start gap-3">
              <input
                id="loan_incentive_check"
                type="checkbox"
                checked={formData.loanIncentive}
                onChange={(e) => setFormData({ ...formData, loanIncentive: e.target.checked })}
                className="mt-0.5 w-4 h-4 text-brand-500 rounded border-brand-300 focus:ring-brand-500"
              />
              <label htmlFor="loan_incentive_check" className="cursor-pointer text-xs">
                <span className="block font-bold text-brand-900">
                  Cần gói hỗ trợ lãi suất / ân hạn nợ gốc
                </span>
                <span className="block text-brand-700 mt-0.5">
                  Ưu tiên ngân hàng đối tác liên kết dự án (Vietcombank, MB, Techcombank)
                </span>
              </label>
            </div>
          </div>
        </div>

        {/* ==================== CỘT PHẢI (~50%) ==================== */}
        <div className="space-y-6">
          {/* Section 3: Nhu cầu & Tiêu chí BĐS */}
          <div className="bg-surface-container-lowest rounded-2xl border border-gray-200 p-6 shadow-theme-xs space-y-5">
            <div className="flex items-center gap-2.5 pb-3 border-b border-gray-100">
              <div className="w-8 h-8 rounded-lg bg-brand-50 text-brand-500 flex items-center justify-center">
                <span className="material-symbols-outlined text-[20px]">home_work</span>
              </div>
              <div>
                <h2 className="text-base font-bold text-gray-900 leading-tight">
                  Nhu cầu &amp; Tiêu chí BĐS
                </h2>
                <p className="text-xs text-gray-500">
                  Mục tiêu sử dụng, công năng và các tiêu chuẩn ưu tiên
                </p>
              </div>
            </div>

            {/* Property Types */}
            <div className="space-y-2">
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider">
                Loại hình bất động sản
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                {['Căn hộ chung cư', 'Nhà phố / Shophouse', 'Biệt thự / Villa', 'Đất nền'].map(
                  (type) => {
                    const isActive = formData.propertyType === type;
                    return (
                      <button
                        key={type}
                        type="button"
                        onClick={() => setFormData({ ...formData, propertyType: type })}
                        className={`py-2 px-2.5 rounded-lg border font-semibold transition-all ${
                          isActive
                            ? 'border-brand-500 bg-brand-50 text-brand-600 shadow-theme-xs'
                            : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
                        }`}
                      >
                        {type}
                      </button>
                    );
                  }
                )}
              </div>
            </div>

            {/* Bedroom / Size */}
            <div className="space-y-2">
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider">
                Số phòng ngủ / Diện tích
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                {['1PN (45-55m²)', '2PN (65-78m²)', '3PN (85-115m²)', 'Duplex / Penthouse'].map(
                  (br) => {
                    const isActive = formData.bedroomType.includes(br.split(' ')[0]);
                    return (
                      <button
                        key={br}
                        type="button"
                        onClick={() => setFormData({ ...formData, bedroomType: br })}
                        className={`py-2 px-2 rounded-lg border font-semibold transition-all ${
                          isActive
                            ? 'border-brand-500 bg-brand-50 text-brand-600 shadow-theme-xs'
                            : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
                        }`}
                      >
                        {br}
                      </button>
                    );
                  }
                )}
              </div>
            </div>

            {/* Mục đích mua */}
            <div className="space-y-2.5 pt-1 border-t border-gray-100">
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider">
                Mục đích mua
              </label>
              <div className="flex flex-wrap gap-2">
                {formData.purchasePurposes.map((m) => (
                  <span
                    key={m}
                    className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-brand-50 text-brand-600 border border-brand-200 text-xs font-semibold"
                  >
                    <span>{m}</span>
                    <button
                      type="button"
                      onClick={() => handleRemovePurpose(m)}
                      className="hover:text-brand-900"
                    >
                      <span className="material-symbols-outlined text-[14px]">close</span>
                    </button>
                  </span>
                ))}
              </div>

              <div className="flex gap-2">
                <input
                  type="text"
                  value={newPurposeInput}
                  onChange={(e) => setNewPurposeInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleAddPurpose();
                    }
                  }}
                  placeholder="+ Nhập mục đích mua và nhấn Enter..."
                  className="flex-1 px-3 py-2 text-xs bg-white border border-gray-200 rounded-lg placeholder-gray-400 focus:outline-none focus:border-brand-500 shadow-theme-xs"
                />
                <button
                  type="button"
                  onClick={() => handleAddPurpose()}
                  className="px-3 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg font-semibold flex items-center justify-center transition-colors"
                >
                  <span className="material-symbols-outlined text-[18px]">add</span>
                </button>
              </div>
            </div>

            {/* Tiêu chí ưu tiên */}
            <div className="space-y-2.5 pt-1 border-t border-gray-100">
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider">
                Tiêu chí ưu tiên
              </label>
              <div className="flex flex-wrap gap-2">
                {formData.criteriaPriorities.map((c) => (
                  <span
                    key={c}
                    className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-brand-50 text-brand-600 border border-brand-200 text-xs font-semibold"
                  >
                    <span>{c}</span>
                    <button
                      type="button"
                      onClick={() => handleRemovePriority(c)}
                      className="hover:text-brand-900"
                    >
                      <span className="material-symbols-outlined text-[14px]">close</span>
                    </button>
                  </span>
                ))}
              </div>

              <div className="flex gap-2">
                <input
                  type="text"
                  value={newPriorityInput}
                  onChange={(e) => setNewPriorityInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleAddPriority();
                    }
                  }}
                  placeholder="+ Nhập tiêu chí ưu tiên và nhấn Enter..."
                  className="flex-1 px-3 py-2 text-xs bg-white border border-gray-200 rounded-lg placeholder-gray-400 focus:outline-none focus:border-brand-500 shadow-theme-xs"
                />
                <button
                  type="button"
                  onClick={() => handleAddPriority()}
                  className="px-3 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg font-semibold flex items-center justify-center transition-colors"
                >
                  <span className="material-symbols-outlined text-[18px]">add</span>
                </button>
              </div>
            </div>
          </div>

          {/* Section 4: Khu vực & Địa bàn tìm kiếm */}
          <div className="bg-surface-container-lowest rounded-2xl border border-gray-200 p-6 shadow-theme-xs space-y-4">
            <div className="flex items-center gap-2.5 pb-3 border-b border-gray-100">
              <div className="w-8 h-8 rounded-lg bg-brand-50 text-brand-500 flex items-center justify-center">
                <span className="material-symbols-outlined text-[20px]">location_on</span>
              </div>
              <div>
                <h2 className="text-base font-bold text-gray-900 leading-tight">
                  Khu vực &amp; Địa bàn tìm kiếm
                </h2>
                <p className="text-xs text-gray-500">Phạm vi địa lý ưu tiên thuận tiện di chuyển</p>
              </div>
            </div>

            <div className="space-y-4 text-xs">
              <div>
                <label className="block font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
                  Khu vực tìm kiếm / Nơi ở hiện tại
                </label>
                <select
                  value={formData.searchArea}
                  onChange={(e) => setFormData({ ...formData, searchArea: e.target.value })}
                  className="w-full px-3.5 py-2 text-xs bg-white border border-gray-200 rounded-lg text-gray-900 focus:border-brand-500 shadow-theme-xs"
                >
                  <option value="Quận 7, TP.HCM">Quận 7, TP.HCM</option>
                  <option value="Thành phố Thủ Đức, TP.HCM">Thành phố Thủ Đức, TP.HCM</option>
                  <option value="Bình Thạnh, TP.HCM">Bình Thạnh, TP.HCM</option>
                  <option value="Nhà Bè, TP.HCM">Nhà Bè, TP.HCM</option>
                  <option value="Hà Nội">Hà Nội</option>
                </select>
              </div>

              <div>
                <label className="block font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
                  Bán kính / Vị trí cụ thể
                </label>
                <input
                  type="text"
                  value={formData.specificLocation}
                  onChange={(e) =>
                    setFormData({ ...formData, specificLocation: e.target.value })
                  }
                  className="w-full px-3.5 py-2 text-xs bg-white border border-gray-200 rounded-lg text-gray-900 focus:border-brand-500 shadow-theme-xs"
                />
              </div>
            </div>
          </div>

          {/* Section 5: Nguồn khách & Kế hoạch */}
          <div className="bg-surface-container-lowest rounded-2xl border border-gray-200 p-6 shadow-theme-xs space-y-4">
            <div className="flex items-center gap-2.5 pb-3 border-b border-gray-100">
              <div className="w-8 h-8 rounded-lg bg-brand-50 text-brand-500 flex items-center justify-center">
                <span className="material-symbols-outlined text-[20px]">campaign</span>
              </div>
              <div>
                <h2 className="text-base font-bold text-gray-900 leading-tight">
                  Nguồn khách &amp; Kế hoạch
                </h2>
                <p className="text-xs text-gray-500">
                  Kênh tiếp cận khách và thời điểm dự kiến giải ngân
                </p>
              </div>
            </div>

            <div className="space-y-4 text-xs">
              <div>
                <label className="block font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
                  Nguồn khách
                </label>
                <select
                  value={formData.leadSource}
                  onChange={(e) => setFormData({ ...formData, leadSource: e.target.value })}
                  className="w-full px-3.5 py-2 text-xs bg-white border border-gray-200 rounded-lg text-gray-900 focus:border-brand-500 shadow-theme-xs"
                >
                  <option value="Facebook Ads - Chiến dịch Q'Terra">
                    Facebook Ads - Chiến dịch Q&apos;Terra
                  </option>
                  <option value="Google Search Ads">Google Search Ads</option>
                  <option value="Giới thiệu từ khách VIP cũ">Giới thiệu từ khách VIP cũ</option>
                  <option value="Sự kiện mở bán đợt 1">Sự kiện mở bán đợt 1</option>
                  <option value="Website STND">Website STND</option>
                </select>
              </div>

              <div>
                <label className="block font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
                  Thời điểm dự kiến mua / chốt deal
                </label>
                <div className="relative">
                  <input
                    type="text"
                    value={formData.targetPurchaseTime}
                    onChange={(e) =>
                      setFormData({ ...formData, targetPurchaseTime: e.target.value })
                    }
                    className="w-full pl-3.5 pr-10 py-2 text-xs bg-white border border-gray-200 rounded-lg text-gray-900 focus:border-brand-500 shadow-theme-xs"
                  />
                  <span className="material-symbols-outlined absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-[18px]">
                    calendar_today
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 3. Bottom Sticky Actions Bar */}
      <div className="bg-surface-container-lowest rounded-2xl border border-gray-200 px-6 py-4 flex flex-col sm:flex-row items-center justify-between gap-4 shadow-theme-sm">
        <div className="flex items-center gap-2 text-xs text-gray-500">
          <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
          <span>Bản nháp tự động lưu lúc 14:32:10</span>
          <span className="text-gray-300">|</span>
          <span className="text-gray-400">Người cập nhật gần nhất: admin@stnd.vn</span>
        </div>

        <div className="flex items-center gap-3 w-full sm:w-auto justify-end">
          <button
            type="button"
            onClick={onCancel}
            className="w-full sm:w-auto px-5 py-2.5 rounded-lg border border-gray-200 bg-white text-gray-700 font-semibold text-xs hover:bg-gray-50 active:scale-95 transition-all shadow-theme-xs"
          >
            Hủy bỏ
          </button>
          <button
            type="submit"
            className="w-full sm:w-auto px-6 py-2.5 rounded-lg bg-brand-500 text-white font-semibold text-xs hover:bg-brand-600 active:scale-95 transition-all shadow-theme-xs flex items-center justify-center gap-2"
          >
            <span className="material-symbols-outlined text-[18px]">save</span>
            <span>Lưu thông tin đầu tư</span>
          </button>
        </div>
      </div>
    </form>
  );
};
