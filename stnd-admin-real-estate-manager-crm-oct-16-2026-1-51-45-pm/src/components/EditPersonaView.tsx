import React, { useState } from 'react';
import { Customer } from '../types/crm';

interface EditPersonaViewProps {
  customer: Customer;
  onSave: (updated: Customer) => void;
  onCancel: () => void;
}

export const EditPersonaView: React.FC<EditPersonaViewProps> = ({
  customer,
  onSave,
  onCancel
}) => {
  const [formData, setFormData] = useState<Customer>({ ...customer });
  const [newTagInput, setNewTagInput] = useState('');
  const [birthdayReminder, setBirthdayReminder] = useState(true);

  const handleAddTag = (tagToAdd?: string) => {
    const tag = (tagToAdd || newTagInput).trim();
    if (!tag) return;
    const formattedTag = tag.startsWith('#') ? tag : `#${tag}`;
    if (!formData.lifestyleTags.includes(formattedTag)) {
      setFormData({
        ...formData,
        lifestyleTags: [...formData.lifestyleTags, formattedTag]
      });
    }
    setNewTagInput('');
  };

  const handleRemoveTag = (tagToRemove: string) => {
    setFormData({
      ...formData,
      lifestyleTags: formData.lifestyleTags.filter((t) => t !== tagToRemove)
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(formData);
    alert('Đã cập nhật Chân dung khách hàng thành công!');
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6 animate-in fade-in duration-200">
      {/* 1. Header & Breadcrumb */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 pb-2 border-b border-gray-200">
        <div>
          <nav className="flex items-center gap-2 text-xs text-gray-500 mb-2">
            <button
              type="button"
              onClick={onCancel}
              className="hover:text-brand-600 transition-colors"
            >
              Quản lý khách hàng
            </button>
            <span className="material-symbols-outlined text-xs text-gray-400">chevron_right</span>
            <button
              type="button"
              onClick={onCancel}
              className="hover:text-brand-600 transition-colors"
            >
              Chi tiết khách hàng ({customer.name})
            </button>
            <span className="material-symbols-outlined text-xs text-gray-400">chevron_right</span>
            <span className="text-brand-600 font-semibold">Cập nhật Chân dung</span>
          </nav>

          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold text-gray-900 tracking-tight">
              Cập nhật Chân dung khách hàng
            </h1>
            <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold bg-brand-50 text-brand-600 border border-brand-200">
              {customer.name}
            </span>
            {customer.isVip && (
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-300 shadow-theme-xs">
                <span
                  className="material-symbols-outlined text-[15px]"
                  style={{ fontVariationSettings: "'FILL' 1" }}
                >
                  star
                </span>
                VIP
              </span>
            )}
          </div>
          <p className="text-xs text-gray-500 mt-1 max-w-3xl">
            Thu thập và chuẩn hóa chân dung khách hàng (C10, C11) giúp chuyên viên tư vấn thấu hiểu và phục vụ cá nhân hóa.
          </p>
        </div>

        <div className="flex items-center gap-3 shrink-0 self-start lg:self-center">
          <button
            type="button"
            onClick={onCancel}
            className="px-5 py-2.5 rounded-lg border border-gray-300 bg-white text-gray-700 font-medium text-sm hover:bg-gray-50 active:scale-95 transition-all shadow-theme-xs"
          >
            Hủy bỏ
          </button>
          <button
            type="submit"
            className="px-5 py-2.5 rounded-lg bg-brand-500 text-white font-medium text-sm flex items-center gap-2 hover:bg-brand-600 active:scale-95 transition-all shadow-theme-xs"
          >
            <span className="material-symbols-outlined text-lg">save</span>
            <span>Lưu thông tin chân dung</span>
          </button>
        </div>
      </div>

      {/* 2. 2-Column Layout Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column (7 cols) */}
        <div className="lg:col-span-7 space-y-6">
          {/* Section 1: Thông tin cá nhân & Gia cảnh */}
          <div className="bg-surface-container-lowest rounded-2xl border border-gray-200 shadow-theme-xs p-6 space-y-5">
            <div className="flex items-center justify-between pb-4 border-b border-gray-100">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-lg bg-brand-50 text-brand-500 flex items-center justify-center">
                  <span className="material-symbols-outlined">person</span>
                </div>
                <div>
                  <h2 className="text-base font-bold text-gray-900">
                    Thông tin cá nhân &amp; Gia cảnh
                  </h2>
                  <p className="text-xs text-gray-500">
                    Dữ liệu định danh, liên lạc và cấu trúc hộ gia đình
                  </p>
                </div>
              </div>
              <span className="text-xs text-brand-600 bg-brand-50 px-2.5 py-1 rounded-full font-semibold border border-brand-100">
                Bắt buộc
              </span>
            </div>

            <div className="space-y-4">
              {/* Họ tên & SĐT */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs uppercase font-semibold text-gray-500 mb-1.5">
                    Họ và tên <span className="text-brand-500">*</span>
                  </label>
                  <div className="relative">
                    <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-lg">
                      badge
                    </span>
                    <input
                      type="text"
                      required
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      className="w-full h-10 pl-10 pr-3.5 rounded-lg border border-gray-200 bg-white text-gray-900 text-sm focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10 transition-all outline-none"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs uppercase font-semibold text-gray-500 mb-1.5">
                    Số điện thoại <span className="text-brand-500">*</span>
                  </label>
                  <div className="relative">
                    <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-lg">
                      call
                    </span>
                    <input
                      type="tel"
                      required
                      value={formData.phone}
                      onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                      className="w-full h-10 pl-10 pr-3.5 rounded-lg border border-gray-200 bg-white text-gray-900 text-sm focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10 transition-all outline-none"
                    />
                  </div>
                </div>
              </div>

              {/* Email & CCCD */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs uppercase font-semibold text-gray-500 mb-1.5">
                    Email
                  </label>
                  <div className="relative">
                    <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-lg">
                      mail
                    </span>
                    <input
                      type="email"
                      value={formData.email}
                      onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                      className="w-full h-10 pl-10 pr-3.5 rounded-lg border border-gray-200 bg-white text-gray-900 text-sm focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10 transition-all outline-none"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs uppercase font-semibold text-gray-500 mb-1.5">
                    Số CCCD / Định danh
                  </label>
                  <div className="relative">
                    <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-lg">
                      credit_card
                    </span>
                    <input
                      type="text"
                      value={formData.idNumber}
                      onChange={(e) => setFormData({ ...formData, idNumber: e.target.value })}
                      className="w-full h-10 pl-10 pr-10 rounded-lg border border-gray-200 bg-white text-gray-900 text-sm font-mono focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10 transition-all outline-none"
                    />
                    <span
                      className="material-symbols-outlined absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm cursor-pointer hover:text-gray-600"
                      title="Mã hóa an toàn"
                    >
                      verified_user
                    </span>
                  </div>
                </div>
              </div>

              {/* Ngày sinh + Checkbox nhắc hẹn */}
              <div className="p-3.5 rounded-xl bg-gray-50 border border-gray-200">
                <label className="block text-xs uppercase font-semibold text-gray-500 mb-1.5">
                  Ngày sinh <span className="text-brand-500">*</span>
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-center">
                  <div className="relative">
                    <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-lg">
                      calendar_today
                    </span>
                    <input
                      type="text"
                      value={formData.birthDate}
                      onChange={(e) => setFormData({ ...formData, birthDate: e.target.value })}
                      className="w-full h-10 pl-10 pr-3.5 rounded-lg border border-gray-200 bg-white text-gray-900 text-sm focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10 transition-all outline-none"
                    />
                  </div>
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={birthdayReminder}
                      onChange={(e) => setBirthdayReminder(e.target.checked)}
                      className="w-4 h-4 rounded border-gray-300 text-brand-500 focus:ring-brand-500/20"
                    />
                    <span className="text-xs text-gray-700 font-medium">
                      Nhắc trước sinh nhật 3 ngày (tự động tạo task)
                    </span>
                  </label>
                </div>
              </div>

              {/* Quê quán & Hôn nhân */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs uppercase font-semibold text-gray-500 mb-1.5">
                    Quê quán
                  </label>
                  <div className="relative">
                    <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-lg">
                      location_on
                    </span>
                    <input
                      type="text"
                      value={formData.hometown}
                      onChange={(e) => setFormData({ ...formData, hometown: e.target.value })}
                      className="w-full h-10 pl-10 pr-3.5 rounded-lg border border-gray-200 bg-white text-gray-900 text-sm focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10 transition-all outline-none"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs uppercase font-semibold text-gray-500 mb-1.5">
                    Tình trạng hôn nhân
                  </label>
                  <select
                    value={formData.maritalStatus}
                    onChange={(e) => setFormData({ ...formData, maritalStatus: e.target.value })}
                    className="w-full h-10 px-3.5 rounded-lg border border-gray-200 bg-white text-gray-900 text-sm focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10 transition-all outline-none cursor-pointer"
                  >
                    <option value="Đã kết hôn">Đã kết hôn</option>
                    <option value="Độc thân">Độc thân</option>
                    <option value="Ly hôn / Khác">Ly hôn / Khác</option>
                  </select>
                </div>
              </div>

              {/* Số người con / Gia cảnh */}
              <div>
                <label className="block text-xs uppercase font-semibold text-gray-500 mb-1.5">
                  Số người con / Gia cảnh
                </label>
                <input
                  type="text"
                  value={formData.children}
                  onChange={(e) => setFormData({ ...formData, children: e.target.value })}
                  className="w-full h-10 px-3.5 rounded-lg border border-gray-200 bg-white text-gray-900 text-sm focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10 transition-all outline-none"
                />
              </div>
            </div>
          </div>

          {/* Section 2: Nghề nghiệp & Vị thế */}
          <div className="bg-surface-container-lowest rounded-2xl border border-gray-200 shadow-theme-xs p-6 space-y-5">
            <div className="flex items-center gap-2.5 pb-4 border-b border-gray-100">
              <div className="w-9 h-9 rounded-lg bg-brand-50 text-brand-500 flex items-center justify-center">
                <span className="material-symbols-outlined">work</span>
              </div>
              <div>
                <h2 className="text-base font-bold text-gray-900">Nghề nghiệp &amp; Vị thế</h2>
                <p className="text-xs text-gray-500">
                  Môi trường làm việc và cơ chế ra quyết định tài chính
                </p>
              </div>
            </div>

            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs uppercase font-semibold text-gray-500 mb-1.5">
                    Nghề nghiệp / Chức vụ <span className="text-brand-500">*</span>
                  </label>
                  <div className="relative">
                    <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-lg">
                      business
                    </span>
                    <input
                      type="text"
                      required
                      value={formData.occupation}
                      onChange={(e) => setFormData({ ...formData, occupation: e.target.value })}
                      className="w-full h-10 pl-10 pr-3.5 rounded-lg border border-gray-200 bg-white text-gray-900 text-sm focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10 transition-all outline-none"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs uppercase font-semibold text-gray-500 mb-1.5">
                    Lĩnh vực kinh doanh
                  </label>
                  <input
                    type="text"
                    value={formData.businessField}
                    onChange={(e) => setFormData({ ...formData, businessField: e.target.value })}
                    className="w-full h-10 px-3.5 rounded-lg border border-gray-200 bg-white text-gray-900 text-sm focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10 transition-all outline-none"
                  />
                </div>
              </div>

              {/* Radio Cards: Người ra quyết định chính */}
              <div>
                <label className="block text-xs uppercase font-semibold text-gray-500 mb-2">
                  Người ra quyết định chính
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {(
                    [
                      { title: 'Vợ chồng cùng duyệt', sub: 'Quyết định đồng thuận', icon: 'groups' },
                      { title: 'Khách tự quyết', sub: 'Chủ động dòng tiền', icon: 'person' },
                      { title: 'Tham khảo gia đình', sub: 'Bố mẹ / Cố vấn', icon: 'diversity_3' }
                    ] as const
                  ).map((opt) => {
                    const isChecked = formData.decisionMaker === opt.title;
                    return (
                      <label
                        key={opt.title}
                        onClick={() =>
                          setFormData({ ...formData, decisionMaker: opt.title as Customer['decisionMaker'] })
                        }
                        className={`relative flex flex-col p-3.5 rounded-xl border-2 cursor-pointer shadow-theme-xs transition-all ${
                          isChecked
                            ? 'border-brand-500 bg-brand-50/70'
                            : 'border-gray-200 bg-white hover:bg-gray-50'
                        }`}
                      >
                        <div className="flex items-center justify-between mb-1.5">
                          <span
                            className={`material-symbols-outlined ${
                              isChecked ? 'text-brand-600' : 'text-gray-400'
                            }`}
                          >
                            {opt.icon}
                          </span>
                          <span
                            className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                              isChecked ? 'border-brand-500' : 'border-gray-300'
                            }`}
                          >
                            {isChecked && <span className="w-2 h-2 rounded-full bg-brand-500"></span>}
                          </span>
                        </div>
                        <span
                          className={`text-sm font-semibold ${
                            isChecked ? 'text-brand-900' : 'text-gray-800'
                          }`}
                        >
                          {opt.title}
                        </span>
                        <span
                          className={`text-xs mt-0.5 ${
                            isChecked ? 'text-brand-600' : 'text-gray-500'
                          }`}
                        >
                          {opt.sub}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column (5 cols) */}
        <div className="lg:col-span-5 space-y-6">
          {/* Section 3: Sở thích & Phong cách sống */}
          <div className="bg-surface-container-lowest rounded-2xl border border-gray-200 shadow-theme-xs p-6 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-gray-100">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-lg bg-brand-50 text-brand-500 flex items-center justify-center">
                  <span className="material-symbols-outlined">interests</span>
                </div>
                <div>
                  <h2 className="text-base font-bold text-gray-900">
                    Sở thích &amp; Phong cách sống
                  </h2>
                  <p className="text-xs text-gray-500">
                    Định vị gu sống để gợi ý sản phẩm phù hợp
                  </p>
                </div>
              </div>
              <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-gray-100 text-gray-700">
                {formData.lifestyleTags.length} đã chọn
              </span>
            </div>

            {/* Active Tags */}
            <div>
              <label className="block text-xs uppercase font-semibold text-gray-500 mb-2">
                Tags đang áp dụng
              </label>
              <div className="flex flex-wrap gap-2">
                {formData.lifestyleTags.map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-brand-50 text-brand-700 border border-brand-200"
                  >
                    <span>{tag}</span>
                    <button
                      type="button"
                      onClick={() => handleRemoveTag(tag)}
                      className="text-brand-500 hover:text-brand-800 font-bold"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            </div>

            {/* Input Free-Text Tag */}
            <div className="flex gap-2">
              <input
                type="text"
                value={newTagInput}
                onChange={(e) => setNewTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAddTag();
                  }
                }}
                placeholder="+ Nhập sở thích mới và nhấn Enter..."
                className="w-full h-9 px-3 rounded-lg border border-gray-200 bg-white text-xs placeholder:text-gray-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/10 outline-none"
              />
              <button
                type="button"
                onClick={() => handleAddTag()}
                className="h-9 px-3 rounded-lg bg-brand-500 hover:bg-brand-600 text-white flex items-center justify-center transition-colors shadow-theme-xs"
              >
                <span className="material-symbols-outlined text-base">add</span>
              </button>
            </div>

            {/* Popular Suggestions */}
            <div>
              <span className="block text-xs uppercase font-semibold text-gray-500 mb-2">
                Gợi ý phổ biến
              </span>
              <div className="flex flex-wrap gap-1.5">
                {[
                  '#Du lịch nghỉ dưỡng',
                  '#Nuôi thú cưng',
                  '#Xe sang',
                  '#Đầu tư dài hạn',
                  '#Nhà thông minh'
                ].map((sug) => (
                  <button
                    key={sug}
                    type="button"
                    onClick={() => handleAddTag(sug)}
                    className="px-2.5 py-1 rounded-full text-xs font-medium bg-gray-100 hover:bg-brand-50 hover:text-brand-600 text-gray-600 border border-gray-200 transition-colors"
                  >
                    + {sug}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* VIP Customer card */}
          <div className="bg-surface-container-lowest rounded-2xl border border-gray-200 shadow-theme-xs p-6">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-3">
                <input
                  id="vip_check"
                  type="checkbox"
                  checked={formData.isVip}
                  onChange={(e) => setFormData({ ...formData, isVip: e.target.checked })}
                  className="w-4 h-4 rounded border-gray-300 text-brand-500 focus:ring-brand-500/20 cursor-pointer mt-0.5"
                />
                <div>
                  <label
                    htmlFor="vip_check"
                    className="flex items-center gap-2 cursor-pointer font-bold text-gray-900 text-sm"
                  >
                    <span>Khách hàng VIP</span>
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-300">
                      ★ VIP
                    </span>
                  </label>
                  <p className="text-xs text-gray-500 mt-1 leading-relaxed">
                    Đánh dấu khách hàng VIP để hiển thị huy hiệu và kích hoạt chính sách chăm sóc ưu tiên đặc biệt.
                  </p>
                </div>
              </div>
              <div className="w-9 h-9 rounded-lg bg-amber-50 text-amber-700 flex items-center justify-center shrink-0 border border-amber-200">
                <span className="material-symbols-outlined text-lg">workspace_premium</span>
              </div>
            </div>
          </div>

          {/* Section 4: Kênh & Khung giờ ưu tiên */}
          <div className="bg-surface-container-lowest rounded-2xl border border-gray-200 shadow-theme-xs p-6 space-y-4">
            <div className="flex items-center gap-2.5 pb-3 border-b border-gray-100">
              <div className="w-9 h-9 rounded-lg bg-brand-50 text-brand-500 flex items-center justify-center">
                <span className="material-symbols-outlined">schedule</span>
              </div>
              <div>
                <h2 className="text-base font-bold text-gray-900">Kênh &amp; Khung giờ ưu tiên</h2>
                <p className="text-xs text-gray-500">Tối ưu tỷ lệ tiếp cận và chuyển đổi</p>
              </div>
            </div>

            <div>
              <label className="block text-xs uppercase font-semibold text-gray-500 mb-2">
                Kênh liên hệ ưu tiên <span className="text-brand-500">*</span>
              </label>
              <div className="grid grid-cols-3 gap-2">
                {(['Zalo', 'Điện thoại', 'Gặp mặt'] as const).map((ch) => {
                  const isActive = formData.preferredContactMethod === ch;
                  return (
                    <button
                      key={ch}
                      type="button"
                      onClick={() => setFormData({ ...formData, preferredContactMethod: ch })}
                      className={`flex items-center justify-center gap-1.5 h-10 px-3 rounded-lg text-xs font-semibold border transition-all ${
                        isActive
                          ? 'border-brand-500 bg-brand-50 text-brand-600 shadow-theme-xs'
                          : 'border-gray-200 bg-white hover:bg-gray-50 text-gray-700'
                      }`}
                    >
                      {isActive && (
                        <span className="material-symbols-outlined text-sm font-bold">check</span>
                      )}
                      <span>{ch}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <label className="block text-xs uppercase font-semibold text-gray-500 mb-1.5">
                Khung giờ rảnh thuận tiện
              </label>
              <div className="relative">
                <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-lg">
                  alarm
                </span>
                <input
                  type="text"
                  value={formData.freeTimeSlot}
                  onChange={(e) => setFormData({ ...formData, freeTimeSlot: e.target.value })}
                  className="w-full h-10 pl-10 pr-3.5 rounded-lg border border-gray-200 bg-white text-gray-900 text-sm focus:border-brand-500 outline-none"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs uppercase font-semibold text-gray-500 mb-1.5">
                Cách xưng hô ưa thích
              </label>
              <div className="relative">
                <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-lg">
                  person
                </span>
                <input
                  type="text"
                  value={formData.preferredSalutation}
                  onChange={(e) =>
                    setFormData({ ...formData, preferredSalutation: e.target.value })
                  }
                  className="w-full h-10 pl-10 pr-3.5 rounded-lg border border-gray-200 bg-white text-gray-900 text-sm focus:border-brand-500 outline-none"
                />
              </div>
              <p className="text-[11px] text-gray-400 mt-1 italic">
                Hệ thống sẽ dùng danh xưng này khi gửi SMS / Tin nhắn Zalo tự động.
              </p>
            </div>
          </div>

          {/* Section 5: Ghi chú bổ sung */}
          <div className="bg-surface-container-lowest rounded-2xl border border-gray-200 shadow-theme-xs p-6 space-y-3">
            <div className="flex items-center gap-2.5 pb-3 border-b border-gray-100">
              <div className="w-9 h-9 rounded-lg bg-brand-50 text-brand-500 flex items-center justify-center">
                <span className="material-symbols-outlined">note_add</span>
              </div>
              <div>
                <h2 className="text-base font-bold text-gray-900">Ghi chú bổ sung</h2>
                <p className="text-xs text-gray-500">Lưu ý tinh tế của chuyên viên kinh doanh</p>
              </div>
            </div>

            <textarea
              rows={4}
              value={formData.notes}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              className="w-full p-3.5 rounded-xl border border-gray-200 bg-white text-gray-900 text-xs focus:border-brand-500 outline-none resize-none leading-relaxed"
            />
            <div className="flex items-center justify-between text-xs text-gray-400">
              <span className="flex items-center gap-1">
                <span className="material-symbols-outlined text-sm">lock</span>
                Chỉ hiển thị cho nội bộ kinh doanh
              </span>
              <span>{formData.notes.length} ký tự</span>
            </div>
          </div>
        </div>
      </div>

      {/* 3. Docked Bottom Bar */}
      <div className="bg-surface-container-lowest rounded-2xl border border-gray-200 shadow-theme-xs p-4 flex flex-col sm:flex-row items-center justify-between gap-4 mt-8">
        <div className="flex items-center gap-2 text-gray-500 text-xs">
          <span className="material-symbols-outlined text-brand-500 text-lg">info</span>
          <span>Dữ liệu chân dung được đồng bộ tức thì lên hồ sơ CRM khách hàng C10/C11.</span>
        </div>
        <div className="flex items-center gap-3 w-full sm:w-auto justify-end">
          <button
            type="button"
            onClick={onCancel}
            className="w-full sm:w-auto px-6 py-2.5 rounded-lg border border-gray-300 bg-white text-gray-700 font-medium text-xs hover:bg-gray-50 active:scale-95 transition-all shadow-theme-xs"
          >
            Hủy bỏ
          </button>
          <button
            type="submit"
            className="w-full sm:w-auto px-6 py-2.5 rounded-lg bg-brand-500 text-white font-medium text-xs flex items-center justify-center gap-2 hover:bg-brand-600 active:scale-95 transition-all shadow-theme-xs"
          >
            <span className="material-symbols-outlined text-lg">check_circle</span>
            <span>Lưu thông tin chân dung</span>
          </button>
        </div>
      </div>
    </form>
  );
};
