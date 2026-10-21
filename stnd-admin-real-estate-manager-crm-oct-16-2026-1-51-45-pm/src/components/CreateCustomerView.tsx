import React, { useState } from 'react';
import { Customer } from '../types/crm';

interface CreateCustomerViewProps {
  onAddCustomer: (newCust: Customer) => void;
  onCancel: () => void;
  existingPhones: string[];
}

export const CreateCustomerView: React.FC<CreateCustomerViewProps> = ({
  onAddCustomer,
  onCancel,
  existingPhones
}) => {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('0912 345 678');
  const [email, setEmail] = useState('');
  const [idNumber, setIdNumber] = useState('');
  const [residence, setResidence] = useState('Quận 7, TP.HCM');

  const [projects, setProjects] = useState<string[]>(["Q'Terra Diamond", 'The Privia']);
  const [status, setStatus] = useState<Customer['status']>('Có quan tâm');
  const [source, setSource] = useState('Website STND');
  const [budgetMin, setBudgetMin] = useState(3);
  const [budgetMax, setBudgetMax] = useState(5);

  const [staffLead, setStaffLead] = useState('Hạnh ★ (Bạn - Tư vấn viên chính)');
  const [staffSupport, setStaffSupport] = useState('-- Chọn cộng sự chăm sóc chéo --');

  // Phone duplicate check
  const isDuplicate = existingPhones.includes(phone.trim());

  const handleToggleProject = (proj: string) => {
    if (projects.includes(proj)) {
      setProjects(projects.filter((p) => p !== proj));
    } else {
      setProjects([...projects, proj]);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      alert('Vui lòng nhập họ và tên khách hàng.');
      return;
    }
    if (!phone.trim()) {
      alert('Vui lòng nhập số điện thoại khách hàng.');
      return;
    }

    const newCustomer: Customer = {
      id: `CUST-${Date.now().toString().slice(-4)}`,
      name: name.trim(),
      phone: phone.trim(),
      email: email.trim() || 'khachhang@stnd.vn',
      idNumber: idNumber.trim() || '0790 9200 8888',
      isVip: status === 'Khách net',
      vipTier: status === 'Khách net' ? 'VIP' : undefined,
      status,
      progressPercentage: 25,
      progressStep: 'Mới tiếp nhận hồ sơ',
      currentResidence: residence,
      hometown: 'Chưa cập nhật',
      birthDate: '15/11/1990',
      maritalStatus: 'Đã kết hôn',
      children: 'Chưa cập nhật',
      occupation: 'Kinh doanh tự do',
      businessField: 'Thương mại dịch vụ',
      decisionMaker: 'Vợ chồng cùng duyệt',
      lifestyleTags: ['#Căn hộ cao cấp', '#Thanh toán linh hoạt'],
      freeTimeSlot: '18:00 - 20:00',
      preferredContactMethod: 'Zalo',
      preferredSalutation: `Anh/Chị ${name.split(' ').slice(-1)[0]}`,
      staffLead: staffLead.split(' ')[0],
      staffSupport: staffSupport.includes('--') ? [] : [staffSupport.split(' ')[0]],
      teamGroup: 'Nhóm C8',
      interestedProjects: projects.length > 0 ? projects : ["Q'Terra"],
      budgetMin,
      budgetMax,
      equityRatio: '60% (Cần vay 40%)',
      loanIncentive: true,
      propertyType: 'Căn hộ chung cư',
      bedroomType: '2PN (65-78m²)',
      purchasePurposes: ['Đầu tư', 'Ở thực'],
      criteriaPriorities: ['Vị trí đắc địa', 'Pháp lý minh bạch'],
      searchArea: residence,
      specificLocation: 'Khu vực trung tâm',
      leadSource: source,
      targetPurchaseTime: 'Quý 4/2026',
      notes: 'Khách hàng mới tiếp nhận từ hệ thống.',
      c4Criteria: {
        demand: { achieved: true, percent: 25, text: 'Nhu cầu căn hộ cao cấp.' },
        motivation: { achieved: false, percent: 25, text: 'Chờ tư vấn thêm động cơ.' },
        finance: { achieved: false, percent: 25, text: 'Chưa đối soát tài chính.' },
        timing: { achieved: false, percent: 25, text: 'Chưa xác định thời gian chốt.' }
      }
    };

    onAddCustomer(newCustomer);
    alert('Đã thêm khách hàng mới vào hệ thống CRM!');
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6 animate-in fade-in duration-200">
      {/* 1. Header Toolbar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs text-gray-500 mb-1">
            <button
              type="button"
              onClick={onCancel}
              className="hover:text-brand-500 transition-colors"
            >
              Quản lý khách hàng
            </button>
            <span className="material-symbols-outlined text-xs">chevron_right</span>
            <span className="text-brand-500 font-semibold">Thêm khách hàng mới</span>
          </div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Thêm khách hàng mới</h1>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 bg-white border border-gray-200 hover:bg-gray-100 text-gray-700 font-medium text-xs rounded-lg shadow-theme-xs transition-colors"
          >
            Hủy bỏ
          </button>
          <button
            type="submit"
            className="px-5 py-2 bg-brand-500 hover:bg-brand-600 text-white font-semibold text-xs rounded-lg shadow-theme-xs flex items-center gap-2 transition-all"
          >
            <span className="material-symbols-outlined text-sm">save</span>
            <span>Lưu khách hàng</span>
          </button>
        </div>
      </div>

      {/* 2. Main Form Grid (65% / 35%) */}
      <div className="grid grid-cols-12 gap-6 pb-6">
        {/* Left Column (8 cols) */}
        <div className="col-span-12 lg:col-span-8 space-y-6">
          {/* Phone Duplication Check Banner */}
          <div className="bg-brand-50 border border-brand-200 rounded-xl p-4 flex items-start gap-3.5 shadow-theme-xs">
            <div className="w-9 h-9 rounded-lg bg-brand-100 border border-brand-200 text-brand-600 flex items-center justify-center shrink-0">
              <span className="material-symbols-outlined">verified_user</span>
            </div>
            <div className="flex-1">
              <h4 className="font-bold text-brand-900 text-sm">Kiểm tra trùng số điện thoại</h4>
              <p className="text-xs text-brand-700 mt-0.5 leading-relaxed">
                Khi nhập SĐT, hệ thống sẽ tự động đối soát tránh trùng lặp giữa các chuyên viên tư vấn và bảo vệ quyền lợi chia hoa hồng.
              </p>
            </div>
          </div>

          {/* Section 1: Thông tin cơ bản */}
          <div className="bg-surface-container-lowest rounded-2xl border border-gray-200 p-6 shadow-theme-xs space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-gray-100">
              <div className="flex items-center gap-2.5">
                <div className="w-1.5 h-5 bg-brand-500 rounded-full"></div>
                <h3 className="font-bold text-base text-gray-900">1. THÔNG TIN CƠ BẢN</h3>
              </div>
              <span className="text-gray-400 font-bold tracking-wider text-xs uppercase">
                BẮT BUỘC NHẬP
              </span>
            </div>

            <div className="space-y-4 text-xs">
              <div>
                <label className="block uppercase text-gray-500 mb-1.5 font-bold">
                  HỌ VÀ TÊN KHÁCH HÀNG <span className="text-brand-500">*</span>
                </label>
                <div className="relative">
                  <span className="material-symbols-outlined absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400">
                    person
                  </span>
                  <input
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Ví dụ: Nguyễn Văn A"
                    className="w-full h-11 pl-11 pr-4 bg-white border border-gray-200 rounded-lg text-sm text-gray-900 placeholder:text-gray-400 focus:border-brand-500 outline-none transition-colors"
                  />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="uppercase text-gray-500 font-bold">
                    SỐ ĐIỆN THOẠI <span className="text-brand-500">*</span>
                  </label>
                  {isDuplicate ? (
                    <span className="flex items-center gap-1 text-rose-700 bg-rose-50 border border-rose-200 px-2 py-0.5 rounded-full font-bold">
                      <span className="material-symbols-outlined text-xs">error</span>
                      Đã có trên hệ thống!
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-emerald-700 bg-emerald-50 border border-emerald-100 px-2 py-0.5 rounded-full font-bold">
                      <span className="material-symbols-outlined text-xs">check_circle</span>
                      Sẵn sàng tiếp nhận
                    </span>
                  )}
                </div>
                <div className="relative">
                  <span className="material-symbols-outlined absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400">
                    call
                  </span>
                  <input
                    type="tel"
                    required
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="0912 xxx xxx"
                    className="w-full h-11 pl-11 pr-10 bg-white border border-gray-200 rounded-lg text-sm text-gray-900 focus:border-brand-500 outline-none transition-colors"
                  />
                  <span
                    className={`material-symbols-outlined absolute right-3.5 top-1/2 -translate-y-1/2 ${
                      isDuplicate ? 'text-rose-500' : 'text-emerald-500'
                    }`}
                  >
                    bolt
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block uppercase text-gray-500 mb-1.5 font-bold">
                    EMAIL CÁ NHÂN
                  </label>
                  <div className="relative">
                    <span className="material-symbols-outlined absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400">
                      mail
                    </span>
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="khachhang@stnd.vn (tùy chọn)"
                      className="w-full h-11 pl-11 pr-4 bg-white border border-gray-200 rounded-lg text-sm text-gray-900 placeholder:text-gray-400 focus:border-brand-500 outline-none transition-colors"
                    />
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="uppercase text-gray-500 font-bold">
                      SỐ CCCD / ĐỊNH DANH
                    </label>
                    <span className="text-gray-400 flex items-center gap-0.5">
                      <span className="material-symbols-outlined text-xs">lock</span>
                      Mã hóa bảo mật
                    </span>
                  </div>
                  <div className="relative">
                    <span className="material-symbols-outlined absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400">
                      badge
                    </span>
                    <input
                      type="text"
                      value={idNumber}
                      onChange={(e) => setIdNumber(e.target.value)}
                      placeholder="0010xxxx9876 (Dùng cho hợp đồng cọc)"
                      className="w-full h-11 pl-11 pr-4 bg-white border border-gray-200 rounded-lg text-sm text-gray-900 placeholder:text-gray-400 focus:border-brand-500 outline-none transition-colors"
                    />
                  </div>
                </div>
              </div>

              <div>
                <label className="block uppercase text-gray-500 mb-1.5 font-bold">
                  KHU VỰC NƠI Ở / ĐỊA CHỈ
                </label>
                <div className="relative">
                  <span className="material-symbols-outlined absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400">
                    location_on
                  </span>
                  <select
                    value={residence}
                    onChange={(e) => setResidence(e.target.value)}
                    className="w-full h-11 pl-11 pr-10 bg-white border border-gray-200 rounded-lg text-sm text-gray-900 focus:border-brand-500 outline-none appearance-none transition-colors"
                  >
                    <option value="Quận 7, TP.HCM">Quận 7, TP.HCM</option>
                    <option value="Thành phố Thủ Đức, TP.HCM">Thành phố Thủ Đức, TP.HCM</option>
                    <option value="Quận 1, TP.HCM">Quận 1, TP.HCM</option>
                    <option value="Quận Bình Thạnh, TP.HCM">Quận Bình Thạnh, TP.HCM</option>
                    <option value="Huyện Nhà Bè, TP.HCM">Huyện Nhà Bè, TP.HCM</option>
                    <option value="Hà Nội (Khu vực phía Tây)">Hà Nội (Khu vực phía Tây)</option>
                  </select>
                  <span className="material-symbols-outlined absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none">
                    expand_more
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Section 2: Nhu cầu & Dự án quan tâm */}
          <div className="bg-surface-container-lowest rounded-2xl border border-gray-200 p-6 shadow-theme-xs space-y-5">
            <div className="flex items-center justify-between pb-3 border-b border-gray-100">
              <div className="flex items-center gap-2.5">
                <div className="w-1.5 h-5 bg-orange-400 rounded-full"></div>
                <h3 className="font-bold text-base text-gray-900">
                  2. NHU CẦU &amp; DỰ ÁN QUAN TÂM
                </h3>
              </div>
              <span className="text-gray-400 font-bold tracking-wider text-xs uppercase">
                KHẢO SÁT
              </span>
            </div>

            <div className="space-y-4 text-xs">
              {/* Dự án quan tâm */}
              <div>
                <label className="block uppercase text-gray-500 font-bold mb-2">
                  DỰ ÁN QUAN TÂM
                </label>
                <div className="flex flex-wrap gap-2 pt-1">
                  {[
                    "Q'Terra Diamond",
                    'The Privia',
                    'Ecopark Grand',
                    'Aqua City Waterfront',
                    'Vinhomes Grand Park'
                  ].map((p) => {
                    const isSelected = projects.includes(p);
                    return (
                      <button
                        key={p}
                        type="button"
                        onClick={() => handleToggleProject(p)}
                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full font-semibold text-xs transition-colors shadow-theme-xs ${
                          isSelected
                            ? 'bg-brand-500 text-white'
                            : 'bg-white border border-gray-200 text-gray-700 hover:border-brand-300'
                        }`}
                      >
                        <span className="material-symbols-outlined text-sm">apartment</span>
                        <span>{p}</span>
                        {isSelected && (
                          <span className="material-symbols-outlined text-xs ml-0.5">close</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Tình trạng ban đầu */}
              <div>
                <label className="block uppercase text-gray-500 mb-2 font-bold">
                  TÌNH TRẠNG BAN ĐẦU
                </label>
                <div className="grid grid-cols-3 gap-3">
                  {(
                    [
                      { val: 'Chưa tiếp cận', color: 'bg-gray-400' },
                      { val: 'Có quan tâm', color: 'bg-emerald-500' },
                      { val: 'Khách net', color: 'bg-amber-500' }
                    ] as const
                  ).map((item) => {
                    const isActive = status === item.val;
                    return (
                      <button
                        key={item.val}
                        type="button"
                        onClick={() => setStatus(item.val as Customer['status'])}
                        className={`h-10 rounded-lg text-xs font-semibold flex items-center justify-center gap-2 border transition-all ${
                          isActive
                            ? 'bg-brand-500 text-white border-brand-500 shadow-theme-xs'
                            : 'border-gray-200 bg-white hover:bg-gray-50 text-gray-700'
                        }`}
                      >
                        <span
                          className={`w-2 h-2 rounded-full ${
                            isActive ? 'bg-white' : item.color
                          }`}
                        ></span>
                        <span>{item.val}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Nguồn khách & Ngân sách */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block uppercase text-gray-500 mb-1.5 font-bold">
                    NGUỒN KHÁCH
                  </label>
                  <select
                    value={source}
                    onChange={(e) => setSource(e.target.value)}
                    className="w-full h-11 px-3 bg-white border border-gray-200 rounded-lg text-sm text-gray-900 focus:border-brand-500 outline-none"
                  >
                    <option value="Website STND">Website STND</option>
                    <option value="Facebook Ads Campaign">Facebook Ads Campaign</option>
                    <option value="Giới thiệu từ khách hàng cũ">Giới thiệu từ khách hàng cũ</option>
                    <option value="Telesales data nội bộ">Telesales data nội bộ</option>
                    <option value="Sự kiện mở bán dự án">Sự kiện mở bán dự án</option>
                  </select>
                </div>

                <div>
                  <label className="block uppercase text-gray-500 mb-1.5 font-bold">
                    NGÂN SÁCH DỰ KIẾN (TỶ VNĐ)
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      step="0.5"
                      value={budgetMin}
                      onChange={(e) => setBudgetMin(Number(e.target.value))}
                      className="w-full h-11 px-3 bg-white border border-gray-200 rounded-lg text-sm text-gray-900 focus:border-brand-500 outline-none"
                    />
                    <span className="text-gray-400 font-bold">-</span>
                    <input
                      type="number"
                      step="0.5"
                      value={budgetMax}
                      onChange={(e) => setBudgetMax(Number(e.target.value))}
                      className="w-full h-11 px-3 bg-white border border-gray-200 rounded-lg text-sm text-gray-900 focus:border-brand-500 outline-none"
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column (4 cols) */}
        <div className="col-span-12 lg:col-span-4 space-y-6">
          {/* Section 3: Phân bổ nhân sự */}
          <div className="bg-surface-container-lowest rounded-2xl border border-gray-200 p-6 shadow-theme-xs space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-gray-100">
              <div className="flex items-center gap-2.5">
                <div className="w-1.5 h-5 bg-purple-700 rounded-full"></div>
                <h3 className="font-bold text-base text-gray-900">3. PHÂN BỔ NHÂN SỰ</h3>
              </div>
              <span className="text-gray-400 font-bold tracking-wider text-xs uppercase">
                VẬN HÀNH
              </span>
            </div>

            <div className="space-y-4 text-xs">
              <div>
                <label className="block uppercase text-gray-500 mb-1.5 font-bold">
                  NHÂN VIÊN PHỤ TRÁCH CHÍNH <span className="text-brand-500">*</span>
                </label>
                <div className="relative">
                  <span className="material-symbols-outlined absolute left-3.5 top-1/2 -translate-y-1/2 text-brand-500">
                    account_circle
                  </span>
                  <select
                    value={staffLead}
                    onChange={(e) => setStaffLead(e.target.value)}
                    className="w-full h-11 pl-11 pr-10 bg-white border border-gray-200 rounded-lg text-sm text-gray-900 font-semibold focus:border-brand-500 outline-none"
                  >
                    <option value="Hạnh ★ (Bạn - Tư vấn viên chính)">
                      Hạnh ★ (Bạn - Tư vấn viên chính)
                    </option>
                    <option value="Trần Mỹ Hạnh (Chuyên viên Senior 1)">
                      Trần Mỹ Hạnh (Chuyên viên Senior 1)
                    </option>
                    <option value="Nguyễn Quốc Bảo (Team Leader)">
                      Nguyễn Quốc Bảo (Team Leader)
                    </option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block uppercase text-gray-500 mb-1.5 font-bold">
                  NHÂN VIÊN HỖ TRỢ (TÙY CHỌN)
                </label>
                <div className="relative">
                  <span className="material-symbols-outlined absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400">
                    group_add
                  </span>
                  <select
                    value={staffSupport}
                    onChange={(e) => setStaffSupport(e.target.value)}
                    className="w-full h-11 pl-11 pr-10 bg-white border border-gray-200 rounded-lg text-sm text-gray-900 focus:border-brand-500 outline-none"
                  >
                    <option value="-- Chọn cộng sự chăm sóc chéo --">
                      -- Chọn cộng sự chăm sóc chéo --
                    </option>
                    <option value="Nguyễn Quốc Bảo (Team Leader)">
                      Nguyễn Quốc Bảo (Team Leader)
                    </option>
                    <option value="Phạm Thu Thảo (Telesales)">Phạm Thu Thảo (Telesales)</option>
                    <option value="Lê Hoàng Quân (Chuyên viên DA)">
                      Lê Hoàng Quân (Chuyên viên DA)
                    </option>
                  </select>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 3. Sticky Bottom Action Bar */}
      <div className="sticky bottom-0 bg-surface-container-lowest/95 backdrop-blur-md border border-gray-200 rounded-2xl px-6 py-4 flex items-center justify-between shadow-theme-md">
        <div className="flex items-center gap-2 text-gray-500 text-xs font-medium">
          <span className="material-symbols-outlined text-sm text-emerald-500">cloud_done</span>
          <span>Bản nháp tự động lưu lúc 09:42 AM</span>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="px-5 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold text-xs rounded-lg transition-colors flex items-center gap-1.5"
          >
            <span className="material-symbols-outlined text-base">close</span>
            Hủy
          </button>
          <button
            type="submit"
            className="px-6 py-2.5 bg-brand-500 hover:bg-brand-600 text-white font-semibold text-xs rounded-lg shadow-theme-xs flex items-center gap-2 transition-all active:scale-95"
          >
            <span className="material-symbols-outlined text-base">check_circle</span>
            <span>Lưu khách hàng</span>
          </button>
        </div>
      </div>
    </form>
  );
};
