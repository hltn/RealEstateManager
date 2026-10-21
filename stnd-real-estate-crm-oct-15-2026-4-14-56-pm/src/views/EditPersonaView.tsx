import React, { useState } from 'react';
import { Customer } from '../types';

interface EditPersonaViewProps {
  customer: Customer;
  onBack: () => void;
  onSave: (updatedCustomer: Partial<Customer>) => void;
}

export const EditPersonaView: React.FC<EditPersonaViewProps> = ({
  customer,
  onBack,
  onSave,
}) => {
  const [name, setName] = useState(customer.name);
  const [phone, setPhone] = useState(customer.phone);
  const [email, setEmail] = useState(customer.email || 'nguyen.vana@example.com');
  const [idNumber, setIdNumber] = useState(customer.idNumber || '001084001234');
  const [birthday, setBirthday] = useState(customer.birthday || '15/11/1984');
  const [remindBirthday, setRemindBirthday] = useState(customer.remindBirthday ?? true);
  const [hometown, setHometown] = useState(customer.hometown || 'Hà Nội');
  const [maritalStatus, setMaritalStatus] = useState(customer.maritalStatus || 'married');
  const [childrenCount, setChildrenCount] = useState(customer.childrenCount || '2 con nhỏ, học trường quốc tế');
  
  const [career, setCareer] = useState(customer.career || 'Doanh nhân / Giám đốc công ty XNK Logistics');
  const [industry, setIndustry] = useState(customer.industry || 'Xuất nhập khẩu & Vận tải');
  const [decisionMaker, setDecisionMaker] = useState<'both' | 'self' | 'family'>(customer.decisionMaker || 'both');

  const [tags, setTags] = useState<string[]>(
    customer.lifestyleTags || ['Căn hộ view sông', 'Golf', 'Thích tầng cao', 'Thanh toán linh hoạt']
  );
  const [newTagInput, setNewTagInput] = useState('');
  const [isVip, setIsVip] = useState(customer.isVip ?? true);

  const [preferredChannel, setPreferredChannel] = useState<'zalo' | 'phone' | 'meeting'>(
    customer.preferredChannel || 'zalo'
  );
  const [freeTimeSlot, setFreeTimeSlot] = useState(customer.freeTimeSlot || '19:00 - 20:30 Tối (Sau giờ làm)');
  const [salutation, setSalutation] = useState(customer.preferredSalutation || 'Anh A');
  const [notes, setNotes] = useState(
    customer.additionalNotes ||
      'Khách hàng muốn nhận thông tin dự án qua Zalo trước 20:00. Ưu tiên hướng Đông Nam và tầng trên 15.'
  );

  const addTag = (tagText: string) => {
    const clean = tagText.replace(/^#/, '').trim();
    if (clean && !tags.includes(clean)) {
      setTags([...tags, clean]);
      setNewTagInput('');
    }
  };

  const removeTag = (index: number) => {
    setTags(tags.filter((_, i) => i !== index));
  };

  const handleSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    onSave({
      name,
      phone,
      email,
      idNumber,
      birthday,
      remindBirthday,
      hometown,
      maritalStatus,
      childrenCount,
      career,
      industry,
      decisionMaker,
      lifestyleTags: tags,
      isVip,
      preferredChannel,
      freeTimeSlot,
      preferredSalutation: salutation,
      additionalNotes: notes,
    });
  };

  return (
    <div className="w-full max-w-[430px] min-h-screen bg-gray-50 flex flex-col relative pb-32 mx-auto animate-in fade-in duration-200">
      {/* TOP APP BAR */}
      <header className="sticky top-0 z-50 bg-white border-b border-gray-200 px-4 py-3 shadow-theme-xs">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              aria-label="Quay lại"
              onClick={onBack}
              className="w-9 h-9 rounded-lg flex items-center justify-center text-gray-600 hover:bg-gray-100 active:scale-95 transition-transform"
            >
              <span className="material-symbols-outlined text-[22px]">arrow_back</span>
            </button>
            <div className="min-w-0">
              <h1 className="text-title-md font-bold text-gray-900 truncate tracking-tight">
                Cập nhật Chân dung
              </h1>
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className="text-label-xs text-gray-500 truncate">{name}</span>
                {isVip && (
                  <span className="inline-flex items-center px-1.5 py-0.5 rounded-full bg-warning-50 text-warning-700 text-label-xs font-semibold border border-warning-500/20">
                    VIP
                  </span>
                )}
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={() => handleSubmit()}
            className="h-9 px-3.5 rounded-lg bg-brand-500 hover:bg-brand-600 active:scale-95 text-white font-medium text-xs flex items-center gap-1.5 shadow-theme-xs transition-colors shrink-0"
          >
            <span className="material-symbols-outlined text-[18px]">check</span>
            <span>Lưu</span>
          </button>
        </div>
      </header>

      {/* MAIN SCROLLABLE CONTENT */}
      <main className="flex-1 px-4 pt-4 space-y-4">
        {/* 1. Thông tin cá nhân & Gia cảnh */}
        <section className="bg-white rounded-2xl border border-gray-200 p-4 shadow-theme-xs space-y-3.5">
          <div className="flex items-center gap-2 pb-2.5 border-b border-gray-100">
            <div className="w-6 h-6 rounded-md bg-brand-50 flex items-center justify-center text-brand-500">
              <span className="material-symbols-outlined text-[16px]">person</span>
            </div>
            <h2 className="text-title-md font-bold text-gray-900">
              Thông tin cá nhân & Gia cảnh
            </h2>
          </div>

          <div>
            <label className="block text-label-xs uppercase text-gray-500 mb-1.5">
              HỌ VÀ TÊN <span className="text-brand-500">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full h-10 px-3 text-body-md text-gray-900 bg-white border border-gray-200 rounded-lg focus:border-brand-500 focus:ring-2 focus:ring-brand-500/10 outline-none"
            />
          </div>

          <div>
            <label className="block text-label-xs uppercase text-gray-500 mb-1.5">
              SỐ ĐIỆN THOẠI <span className="text-brand-500">*</span>
            </label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="w-full h-10 px-3 text-body-md text-gray-900 bg-white border border-gray-200 rounded-lg focus:border-brand-500 focus:ring-2 focus:ring-brand-500/10 outline-none"
            />
          </div>

          <div>
            <label className="block text-label-xs uppercase text-gray-500 mb-1.5">EMAIL</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full h-10 px-3 text-body-md text-gray-900 bg-white border border-gray-200 rounded-lg focus:border-brand-500 focus:ring-2 focus:ring-brand-500/10 outline-none"
            />
          </div>

          <div>
            <label className="block text-label-xs uppercase text-gray-500 mb-1.5">SỐ CCCD / ĐỊNH DANH</label>
            <input
              type="text"
              value={idNumber}
              onChange={(e) => setIdNumber(e.target.value)}
              className="w-full h-10 px-3 text-body-md text-gray-900 bg-white border border-gray-200 rounded-lg focus:border-brand-500 focus:ring-2 focus:ring-brand-500/10 outline-none font-mono"
            />
          </div>

          <div>
            <label className="block text-label-xs uppercase text-gray-500 mb-1.5">
              NGÀY SINH <span className="text-brand-500">*</span>
            </label>
            <input
              type="text"
              value={birthday}
              onChange={(e) => setBirthday(e.target.value)}
              placeholder="dd/mm/yyyy"
              className="w-full h-10 px-3 text-body-md text-gray-900 bg-white border border-gray-200 rounded-lg focus:border-brand-500 focus:ring-2 focus:ring-brand-500/10 outline-none"
            />
            <label className="flex items-center gap-2 mt-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={remindBirthday}
                onChange={(e) => setRemindBirthday(e.target.checked)}
                className="w-4 h-4 text-brand-500 rounded border-gray-300 focus:ring-brand-500/20"
              />
              <span className="text-label-xs text-gray-700">
                Nhắc trước sinh nhật 3 ngày (tự động tạo task)
              </span>
            </label>
          </div>

          <div>
            <label className="block text-label-xs uppercase text-gray-500 mb-1.5">QUÊ QUÁN</label>
            <input
              type="text"
              value={hometown}
              onChange={(e) => setHometown(e.target.value)}
              className="w-full h-10 px-3 text-body-md text-gray-900 bg-white border border-gray-200 rounded-lg focus:border-brand-500 focus:ring-2 focus:ring-brand-500/10 outline-none"
            />
          </div>

          <div>
            <label className="block text-label-xs uppercase text-gray-500 mb-1.5">TÌNH TRẠNG HÔN NHÂN</label>
            <select
              value={maritalStatus}
              onChange={(e) => setMaritalStatus(e.target.value)}
              className="w-full h-10 px-3 text-body-md text-gray-900 bg-white border border-gray-200 rounded-lg focus:border-brand-500 focus:ring-2 focus:ring-brand-500/10 outline-none"
            >
              <option value="married">Đã kết hôn</option>
              <option value="single">Độc thân</option>
              <option value="other">Khác</option>
            </select>
          </div>

          <div>
            <label className="block text-label-xs uppercase text-gray-500 mb-1.5">SỐ NGƯỜI CON / GIA CẢNH</label>
            <input
              type="text"
              value={childrenCount}
              onChange={(e) => setChildrenCount(e.target.value)}
              className="w-full h-10 px-3 text-body-md text-gray-900 bg-white border border-gray-200 rounded-lg focus:border-brand-500 focus:ring-2 focus:ring-brand-500/10 outline-none"
            />
          </div>
        </section>

        {/* 2. Nghề nghiệp & Vị thế */}
        <section className="bg-white rounded-2xl border border-gray-200 p-4 shadow-theme-xs space-y-3.5">
          <div className="flex items-center gap-2 pb-2.5 border-b border-gray-100">
            <div className="w-6 h-6 rounded-md bg-brand-50 flex items-center justify-center text-brand-500">
              <span className="material-symbols-outlined text-[16px]">work</span>
            </div>
            <h2 className="text-title-md font-bold text-gray-900">Nghề nghiệp & Vị thế</h2>
          </div>

          <div>
            <label className="block text-label-xs uppercase text-gray-500 mb-1.5">
              NGHỀ NGHIỆP / CHỨC VỤ <span className="text-brand-500">*</span>
            </label>
            <input
              type="text"
              value={career}
              onChange={(e) => setCareer(e.target.value)}
              className="w-full h-10 px-3 text-body-md text-gray-900 bg-white border border-gray-200 rounded-lg focus:border-brand-500 focus:ring-2 focus:ring-brand-500/10 outline-none"
            />
          </div>

          <div>
            <label className="block text-label-xs uppercase text-gray-500 mb-1.5">LĨNH VỰC KINH DOANH</label>
            <input
              type="text"
              value={industry}
              onChange={(e) => setIndustry(e.target.value)}
              className="w-full h-10 px-3 text-body-md text-gray-900 bg-white border border-gray-200 rounded-lg focus:border-brand-500 focus:ring-2 focus:ring-brand-500/10 outline-none"
            />
          </div>

          <div>
            <label className="block text-label-xs uppercase text-gray-500 mb-2">NGƯỜI RA QUYẾT ĐỊNH CHÍNH</label>
            <div className="grid grid-cols-1 gap-2">
              {[
                { id: 'both', label: 'Vợ chồng cùng duyệt', icon: 'diversity_1' },
                { id: 'self', label: 'Khách tự quyết', icon: 'person' },
                { id: 'family', label: 'Tham khảo gia đình', icon: 'family_restroom' },
              ].map((item) => (
                <label
                  key={item.id}
                  onClick={() => setDecisionMaker(item.id as any)}
                  className={`flex items-center justify-between p-2.5 rounded-lg border cursor-pointer transition-colors ${
                    decisionMaker === item.id
                      ? 'border-brand-500 bg-brand-50/40 font-medium'
                      : 'border-gray-200 bg-white hover:bg-gray-50'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="decision_maker"
                      checked={decisionMaker === item.id}
                      onChange={() => setDecisionMaker(item.id as any)}
                      className="w-4 h-4 text-brand-500 border-gray-300"
                    />
                    <span className="text-body-md text-gray-900">{item.label}</span>
                  </div>
                  <span className="material-symbols-outlined text-[18px] text-brand-500">
                    {item.icon}
                  </span>
                </label>
              ))}
            </div>
          </div>
        </section>

        {/* 3. Sở thích & Phong cách sống */}
        <section className="bg-white rounded-2xl border border-gray-200 p-4 shadow-theme-xs space-y-3.5">
          <div className="flex items-center justify-between pb-2.5 border-b border-gray-100">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-md bg-brand-50 flex items-center justify-center text-brand-500">
                <span className="material-symbols-outlined text-[16px]">loyalty</span>
              </div>
              <h2 className="text-title-md font-bold text-gray-900">
                Sở thích & Phong cách sống
              </h2>
            </div>
            <span className="text-label-xs text-brand-500 font-medium">{tags.length} đã chọn</span>
          </div>

          <div>
            <label className="block text-label-xs uppercase text-gray-500 mb-2">TAGS ĐANG ÁP DỤNG</label>
            <div className="flex flex-wrap gap-2">
              {tags.map((tag, idx) => (
                <span
                  key={tag}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-brand-50 border border-brand-200 text-brand-700 text-label-xs font-medium"
                >
                  #{tag}
                  <button
                    type="button"
                    onClick={() => removeTag(idx)}
                    className="w-4 h-4 rounded-full flex items-center justify-center hover:bg-brand-100 text-brand-700 transition-colors"
                  >
                    <span className="material-symbols-outlined text-[13px]">close</span>
                  </button>
                </span>
              ))}
            </div>
          </div>

          {/* Ô nhập thêm tag mới */}
          <div>
            <div className="relative">
              <input
                type="text"
                value={newTagInput}
                onChange={(e) => setNewTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addTag(newTagInput);
                  }
                }}
                placeholder="+ Nhập sở thích mới và nhấn Enter..."
                className="w-full h-10 px-3 pr-10 text-body-md text-gray-900 bg-white border border-dashed border-gray-300 rounded-lg focus:border-brand-500 focus:border-solid outline-none"
              />
              <button
                type="button"
                onClick={() => addTag(newTagInput)}
                className="absolute inset-y-0 right-0 pr-3 flex items-center text-brand-500"
              >
                <span className="material-symbols-outlined text-[20px]">add_circle</span>
              </button>
            </div>
          </div>

          {/* Gợi ý tags */}
          <div>
            <span className="block text-label-xs text-gray-400 mb-2 uppercase">GỢI Ý PHỔ BIẾN:</span>
            <div className="flex flex-wrap gap-1.5">
              {['Du lịch nghỉ dưỡng', 'Nuôi thú cưng', 'Xe sang', 'Đầu tư dài hạn'].map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => addTag(item)}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-gray-100 text-gray-600 hover:bg-gray-200 text-label-xs transition-colors"
                >
                  + #{item}
                </button>
              ))}
            </div>
          </div>
        </section>

        {/* VIP Section */}
        <section className="bg-white rounded-2xl border border-warning-500/20 bg-warning-50/40 p-4 shadow-theme-xs">
          <label className="flex items-start gap-3 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={isVip}
              onChange={(e) => setIsVip(e.target.checked)}
              className="w-[18px] h-[18px] mt-0.5 text-brand-500 rounded border-gray-300 focus:ring-brand-500/20"
            />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-gray-900 text-sm">Đánh dấu là khách hàng VIP</span>
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-warning-50 text-warning-700 text-label-xs font-semibold border border-warning-500/20">
                  <span className="material-symbols-outlined text-[13px]">star</span>
                  <span>VIP</span>
                </span>
              </div>
              <p className="text-label-xs text-gray-500 mt-0.5">
                Kích hoạt huy hiệu ★ VIP và đưa vào danh sách ưu tiên chăm sóc đặc biệt.
              </p>
            </div>
          </label>
        </section>

        {/* 4. Kênh & Khung giờ ưu tiên */}
        <section className="bg-white rounded-2xl border border-gray-200 p-4 shadow-theme-xs space-y-3.5 mb-2">
          <div className="flex items-center gap-2 pb-2.5 border-b border-gray-100">
            <div className="w-6 h-6 rounded-md bg-brand-50 flex items-center justify-center text-brand-500">
              <span className="material-symbols-outlined text-[16px]">schedule</span>
            </div>
            <h2 className="text-title-md font-bold text-gray-900">
              Kênh & Khung giờ ưu tiên
            </h2>
          </div>

          <div>
            <label className="block text-label-xs uppercase text-gray-500 mb-2">
              KÊNH LIÊN HỆ ƯU TIÊN <span className="text-brand-500">*</span>
            </label>
            <div className="grid grid-cols-3 gap-2">
              {[
                { id: 'zalo', label: 'Zalo', icon: 'chat' },
                { id: 'phone', label: 'Điện thoại', icon: 'call' },
                { id: 'meeting', label: 'Gặp mặt', icon: 'handshake' },
              ].map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setPreferredChannel(item.id as any)}
                  className={`h-10 px-2 rounded-lg text-xs font-medium flex items-center justify-center gap-1.5 transition-colors ${
                    preferredChannel === item.id
                      ? 'border-2 border-brand-500 bg-brand-50 text-brand-600 shadow-theme-xs'
                      : 'border border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  <span className="material-symbols-outlined text-[18px]">{item.icon}</span>
                  <span>{item.label}</span>
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-label-xs uppercase text-gray-500 mb-1.5">
              KHUNG GIỜ RẢNH THUẬN TIỆN
            </label>
            <select
              value={freeTimeSlot}
              onChange={(e) => setFreeTimeSlot(e.target.value)}
              className="w-full h-10 px-3 pr-10 text-body-md text-gray-900 bg-white border border-gray-200 rounded-lg focus:border-brand-500 outline-none"
            >
              <option value="19:00 - 20:30 Tối (Sau giờ làm)">19:00 - 20:30 Tối (Sau giờ làm)</option>
              <option value="08:30 - 10:00 Sáng (Đầu giờ làm việc)">08:30 - 10:00 Sáng (Đầu giờ làm việc)</option>
              <option value="12:00 - 13:30 Nghỉ trưa">12:00 - 13:30 Nghỉ trưa</option>
              <option value="Cuối tuần (Thứ 7 - CN)">Cuối tuần (Thứ 7 - CN)</option>
            </select>
          </div>

          <div>
            <label className="block text-label-xs uppercase text-gray-500 mb-1.5">
              CÁCH XƯNG HÔ ƯA THÍCH
            </label>
            <input
              type="text"
              value={salutation}
              onChange={(e) => setSalutation(e.target.value)}
              className="w-full h-10 px-3 text-body-md text-gray-900 bg-white border border-gray-200 rounded-lg focus:border-brand-500 outline-none"
            />
            <p className="text-label-xs text-gray-400 mt-1">
              Hệ thống sẽ dùng danh xưng này khi gửi SMS / Tin nhắn Zalo tự động.
            </p>
          </div>
        </section>

        {/* Ghi chú bổ sung */}
        <section className="bg-white rounded-2xl border border-gray-200 p-4 shadow-theme-xs space-y-3.5 mb-2">
          <div className="flex items-center gap-2 pb-2.5 border-b border-gray-100">
            <div className="w-6 h-6 rounded-md bg-brand-50 flex items-center justify-center text-brand-500">
              <span className="material-symbols-outlined text-[16px]">edit_note</span>
            </div>
            <h2 className="text-title-md font-bold text-gray-900">Ghi chú bổ sung</h2>
          </div>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            className="w-full p-3 text-body-md text-gray-900 bg-white border border-gray-200 rounded-lg focus:border-brand-500 outline-none resize-none leading-relaxed"
          />
        </section>
      </main>

      {/* FIXED BOTTOM ACTION BAR */}
      <footer className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[430px] z-40 bg-white/95 backdrop-blur-md border-t border-gray-200 px-4 py-3 shadow-theme-md">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            className="w-1/3 h-11 px-4 rounded-lg bg-gray-100 hover:bg-gray-200 active:scale-[0.99] border border-gray-200 text-gray-700 font-medium text-xs transition-colors text-center"
          >
            Hủy bỏ
          </button>
          <button
            type="button"
            onClick={() => handleSubmit()}
            className="w-2/3 h-11 px-4 rounded-lg bg-brand-500 hover:bg-brand-600 active:scale-[0.99] text-white font-medium text-xs flex items-center justify-center gap-2 shadow-theme-xs transition-colors"
          >
            <span className="material-symbols-outlined text-[20px]">save</span>
            <span>Lưu thông tin chân dung</span>
          </button>
        </div>
      </footer>
    </div>
  );
};
