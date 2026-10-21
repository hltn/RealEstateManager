import React, { useState, useMemo } from 'react';
import { Customer } from '../types/crm';

interface CustomerListViewProps {
  customers: Customer[];
  onSelectCustomer: (cust: Customer) => void;
  onOpenCall: (cust: Customer) => void;
  onOpenZalo: (cust: Customer) => void;
  onOpenQuickNote: (cust: Customer) => void;
  onNavigate: (view: string) => void;
}

export const CustomerListView: React.FC<CustomerListViewProps> = ({
  customers,
  onSelectCustomer,
  onOpenCall,
  onOpenZalo,
  onOpenQuickNote,
  onNavigate
}) => {
  const [activeFilterTab, setActiveFilterTab] = useState<'all' | 'care' | 'hot' | 'dropped'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSort, setSelectedSort] = useState('Cập nhật mới nhất');
  const [selectedProject, setSelectedProject] = useState('Dự án: Tất cả');
  const [selectedAssignee, setSelectedAssignee] = useState('Người phụ trách: Tất cả');
  const [rowsPerPage, setRowsPerPage] = useState(20);
  const [currentPage, setCurrentPage] = useState(1);

  // Filter & Search Logic
  const filteredCustomers = useMemo(() => {
    let result = customers.filter((c) => {
      // Status filter
      if (activeFilterTab === 'care' && c.status !== 'Có quan tâm') return false;
      if (activeFilterTab === 'hot' && c.status !== 'Khách net') return false;
      if (activeFilterTab === 'dropped' && c.status !== 'Bỏ / Không nhu cầu') return false;

      // Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchName = c.name.toLowerCase().includes(q);
        const matchPhone = c.phone.includes(q);
        const matchCccd = c.idNumber.toLowerCase().includes(q);
        const matchProject = c.interestedProjects.some((p) => p.toLowerCase().includes(q));
        if (!matchName && !matchPhone && !matchCccd && !matchProject) return false;
      }

      // Project filter
      if (selectedProject !== 'Dự án: Tất cả') {
        const projName = selectedProject.replace("Dự án: ", '').trim();
        const hasProject = c.interestedProjects.some((p) =>
          p.toLowerCase().includes(projName.toLowerCase())
        );
        if (!hasProject) return false;
      }

      // Assignee filter
      if (selectedAssignee !== 'Người phụ trách: Tất cả') {
        const staffName = selectedAssignee.replace('Người phụ trách: ', '').trim();
        if (!c.staffLead.toLowerCase().includes(staffName.toLowerCase())) return false;
      }

      return true;
    });

    // Sorting
    if (selectedSort === 'Tên A-Z') {
      result.sort((a, b) => a.name.localeCompare(b.name, 'vi'));
    } else if (selectedSort === 'Tiến độ chốt (Cao - Thấp)') {
      result.sort((a, b) => b.progressPercentage - a.progressPercentage);
    }

    return result;
  }, [customers, activeFilterTab, searchQuery, selectedProject, selectedAssignee, selectedSort]);

  // Status counts
  const totalCount = 174; // total registered records
  const careCount = customers.filter((c) => c.status === 'Có quan tâm').length || 128;
  const hotCount = customers.filter((c) => c.status === 'Khách net').length || 14;
  const droppedCount = 32;

  return (
    <div className="space-y-6">
      {/* ==================== 2. PAGE HEADER & SUB TABS ==================== */}
      <div className="space-y-4">
        {/* Page Title & Primary Call to Action */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="font-title-md text-headline-sm font-bold text-gray-900 tracking-tight">
              Quản lý khách hàng
            </h1>
            <p className="font-body-md text-body-md text-gray-500 mt-0.5">
              Theo dõi, phân loại và quản lý toàn bộ cơ sở dữ liệu khách hàng bất động sản
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => onNavigate('create_customer')}
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-brand-500 hover:bg-brand-600 active:scale-95 text-white font-body-md-medium text-body-md-medium rounded-lg shadow-theme-xs transition-all"
            >
              <span className="material-symbols-outlined text-[18px]">add</span>
              <span>Thêm khách</span>
            </button>
          </div>
        </div>

        {/* Horizontal Module Tabs */}
        <div className="border-b border-gray-200 flex items-center gap-8">
          <button
            onClick={() => onNavigate('today')}
            className="pb-3 text-body-md font-body-md text-gray-500 hover:text-gray-800 flex items-center gap-2 transition-colors border-b-2 border-transparent"
          >
            <span>Việc hôm nay</span>
            <span className="px-2 py-0.5 rounded-full text-label-xs font-label-xs bg-gray-100 text-gray-600">
              7
            </span>
          </button>

          {/* ACTIVE TAB */}
          <button
            onClick={() => onNavigate('customers')}
            className="pb-3 text-body-md-medium font-body-md-medium text-brand-500 border-b-2 border-brand-500 flex items-center gap-2"
          >
            <span>Khách hàng</span>
            <span className="px-2 py-0.5 rounded-full text-label-xs font-label-xs bg-brand-50 text-brand-600 font-medium">
              128
            </span>
          </button>

          <button
            onClick={() => onNavigate('calendar')}
            className="pb-3 text-body-md font-body-md text-gray-500 hover:text-gray-800 flex items-center gap-2 transition-colors border-b-2 border-transparent"
          >
            <span>Lịch hẹn</span>
            <span className="px-2 py-0.5 rounded-full text-label-xs font-label-xs bg-gray-100 text-gray-600">
              12
            </span>
          </button>

          <button
            onClick={() => onNavigate('reports')}
            className="pb-3 text-body-md font-body-md text-gray-500 hover:text-gray-800 flex items-center gap-2 transition-colors border-b-2 border-transparent"
          >
            <span>Báo cáo</span>
          </button>
        </div>
      </div>

      {/* ==================== 3. FILTER & SEARCH TOOLBAR ==================== */}
      <div className="space-y-4">
        {/* Status Pill Tabs matching Screenshot_41 */}
        <div className="flex items-center gap-2 overflow-x-auto pb-1">
          <button
            onClick={() => setActiveFilterTab('all')}
            className={`px-3.5 py-1.5 rounded-lg font-medium text-sm flex items-center justify-center transition-all ${
              activeFilterTab === 'all'
                ? 'bg-[#465FFF] text-white shadow-theme-xs'
                : 'bg-white text-gray-700 hover:bg-gray-50 border border-gray-200 shadow-theme-xs'
            }`}
          >
            <span>174</span>
          </button>

          <button
            onClick={() => setActiveFilterTab('care')}
            className={`px-3.5 py-1.5 rounded-lg font-medium text-sm flex items-center gap-2 transition-all ${
              activeFilterTab === 'care'
                ? 'bg-[#465FFF] text-white shadow-theme-xs'
                : 'bg-white text-gray-700 hover:bg-gray-50 border border-gray-200 shadow-theme-xs'
            }`}
          >
            <span>Đang chăm sóc</span>
            <span
              className={`px-1.5 py-0.5 rounded text-xs font-semibold ${
                activeFilterTab === 'care'
                  ? 'bg-white/20 text-white'
                  : 'bg-[#EFF4FF] text-[#3538CD]'
              }`}
            >
              128
            </span>
          </button>

          <button
            onClick={() => setActiveFilterTab('hot')}
            className={`px-3.5 py-1.5 rounded-lg font-medium text-sm flex items-center gap-2 transition-all ${
              activeFilterTab === 'hot'
                ? 'bg-[#465FFF] text-white shadow-theme-xs'
                : 'bg-white text-gray-700 hover:bg-gray-50 border border-gray-200 shadow-theme-xs'
            }`}
          >
            <span>Khách net</span>
            <span
              className={`px-1.5 py-0.5 rounded text-xs font-semibold ${
                activeFilterTab === 'hot'
                  ? 'bg-white/20 text-white'
                  : 'bg-[#EFF4FF] text-[#3538CD]'
              }`}
            >
              14
            </span>
          </button>

          <button
            onClick={() => setActiveFilterTab('dropped')}
            className={`px-3.5 py-1.5 rounded-lg font-medium text-sm flex items-center gap-2 transition-all ${
              activeFilterTab === 'dropped'
                ? 'bg-[#465FFF] text-white shadow-theme-xs'
                : 'bg-white text-gray-700 hover:bg-gray-50 border border-gray-200 shadow-theme-xs'
            }`}
          >
            <span>Bỏ</span>
            <span
              className={`px-1.5 py-0.5 rounded text-xs font-semibold ${
                activeFilterTab === 'dropped'
                  ? 'bg-white/20 text-white'
                  : 'bg-[#EFF4FF] text-[#3538CD]'
              }`}
            >
              32
            </span>
          </button>
        </div>

        {/* Search Input and Filter Dropdowns Card */}
        <div className="bg-surface-container-lowest p-4 rounded-2xl border border-gray-200 shadow-theme-xs">
          <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
            {/* Search Input Box */}
            <div className="relative flex-1 max-w-md">
              <span className="material-symbols-outlined absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 text-[18px]">
                search
              </span>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Tìm theo tên, SĐT, CCCD..."
                className="w-full h-10 pl-10 pr-4 bg-white border border-gray-200 rounded-lg text-body-md font-body-md placeholder-gray-400 focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/10 shadow-theme-xs transition-all"
              />
            </div>

            {/* Filter Dropdowns */}
            <div className="flex flex-wrap items-center gap-2.5">
              <select
                value={selectedSort}
                onChange={(e) => setSelectedSort(e.target.value)}
                className="h-10 px-3 bg-white border border-gray-200 rounded-lg text-body-md font-body-md text-gray-700 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/10 shadow-theme-xs cursor-pointer"
              >
                <option value="Cập nhật mới nhất">Cập nhật mới nhất</option>
                <option value="Hẹn gần nhất">Hẹn gần nhất</option>
                <option value="Tiến độ chốt (Cao - Thấp)">Tiến độ chốt (Cao - Thấp)</option>
                <option value="Tên A-Z">Tên A-Z</option>
              </select>

              <select
                value={selectedProject}
                onChange={(e) => setSelectedProject(e.target.value)}
                className="h-10 px-3 bg-white border border-gray-200 rounded-lg text-body-md font-body-md text-gray-700 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/10 shadow-theme-xs cursor-pointer"
              >
                <option value="Dự án: Tất cả">Dự án: Tất cả</option>
                <option value="Q'Terra">Q&apos;Terra</option>
                <option value="The Privia">The Privia</option>
                <option value="Ecopark Grand">Ecopark Grand</option>
                <option value="Vinhomes Ocean Park">Vinhomes Ocean Park</option>
              </select>

              <select
                value={selectedAssignee}
                onChange={(e) => setSelectedAssignee(e.target.value)}
                className="h-10 px-3 bg-white border border-gray-200 rounded-lg text-body-md font-body-md text-gray-700 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/10 shadow-theme-xs cursor-pointer"
              >
                <option value="Người phụ trách: Tất cả">Người phụ trách: Tất cả</option>
                <option value="Hạnh">Hạnh</option>
                <option value="Minh">Minh</option>
                <option value="Tùng">Tùng</option>
                <option value="Quân">Quân</option>
                <option value="Admin">Admin</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* ==================== 4. DATA TABLE ==================== */}
      <div className="bg-surface-container-lowest rounded-2xl border border-gray-200 shadow-theme-xs overflow-hidden flex flex-col">
        {/* Table Status Header */}
        <div className="px-6 py-3.5 border-b border-gray-200 bg-gray-25 flex items-center justify-between">
          <div className="text-body-md font-body-md text-gray-600">
            Hiển thị <span className="font-semibold text-gray-900">1–{filteredCustomers.length}</span> trên{' '}
            <span className="font-semibold text-gray-900">128</span> khách ·{' '}
            <span className="text-gray-500">Trang 1/7</span>
          </div>
        </div>

        {/* Table Responsive Container */}
        <div className="overflow-x-auto custom-scrollbar">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="h-11 bg-transparent border-b border-gray-200 text-label-xs font-label-xs text-gray-500 uppercase tracking-wider font-semibold">
                <th className="px-6 min-w-[180px]">KHÁCH HÀNG</th>
                <th className="px-4 min-w-[130px]">TÌNH TRẠNG</th>
                <th className="px-4 min-w-[150px]">DỰ ÁN QUAN TÂM</th>
                <th className="px-4 min-w-[160px]">TIẾN ĐỘ CHỐT DEAL</th>
                <th className="px-4 min-w-[140px]">NHÓM PHỤ TRÁCH</th>
                <th className="px-4 min-w-[140px]">HẸN TIẾP THEO</th>
                <th className="px-6 text-center min-w-[190px]">THAO TÁC</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 text-body-md font-body-md text-gray-700">
              {filteredCustomers.map((cust) => (
                <tr
                  key={cust.id}
                  onClick={() => onSelectCustomer(cust)}
                  className="hover:bg-gray-50/70 transition-colors cursor-pointer"
                >
                    {/* KHÁCH HÀNG (Tên + Số điện thoại) */}
                    <td className="px-6 py-4">
                      <div className="space-y-0.5">
                        <div className="font-semibold text-gray-900 hover:text-brand-600 transition-colors text-sm">
                          {cust.name}
                        </div>
                        <div className="text-xs text-gray-500 font-normal">
                          {cust.phone}
                        </div>
                      </div>
                    </td>

                    {/* TÌNH TRẠNG (Màu nền và viền chuẩn xác theo mẫu) */}
                    <td className="px-4 py-4">
                      <span
                        className={`inline-flex items-center justify-center px-3 py-1 rounded-full text-xs font-medium border shadow-xs whitespace-nowrap ${
                          cust.status === 'Có quan tâm'
                            ? 'bg-[#ECFDF3] text-[#027A48] border-[#A6F4C5]'
                            : cust.status === 'Khách net'
                            ? 'bg-[#FFF4ED] text-[#B93815] border-[#FFD6AE]'
                            : 'bg-[#F2F4F7] text-[#475467] border-[#D0D5DD]'
                        }`}
                      >
                        {cust.status}
                      </span>
                    </td>

                    {/* DỰ ÁN QUAN TÂM (Màu nền chuẩn theo dự án) */}
                    <td className="px-4 py-4">
                      <span
                        className={`inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-medium border shadow-xs whitespace-nowrap ${
                          cust.interestedProjects[0]?.includes('Privia')
                            ? 'bg-[#F9F5FF] text-[#6941C6] border-[#E9D7FE]'
                            : cust.interestedProjects[0]?.includes('Ocean Park')
                            ? 'bg-[#D1E9FF] text-[#1849A9] border-[#84CAFF]'
                            : cust.interestedProjects[0]?.includes('Ecopark')
                            ? 'bg-[#EFF8FF] text-[#175CD3] border-[#B2DDFF]'
                            : 'bg-[#EFF8FF] text-[#175CD3] border-[#B2DDFF]'
                        }`}
                      >
                        {cust.interestedProjects[0] || "Q'Terra"}
                      </span>
                    </td>

                    {/* TIẾN ĐỘ CHỐT DEAL */}
                    <td className="px-4 py-4">
                      {cust.progressPercentage >= 100 ? (
                        <>
                          <div className="flex items-center gap-1.5 text-xs font-bold text-[#12B76A]">
                            <span className="text-[13px] leading-none">●</span>
                            <span className="text-[13px] leading-none">●</span>
                            <span className="text-[13px] leading-none">●</span>
                            <span className="text-[13px] leading-none">●</span>
                            <span className="text-xs font-bold text-[#027A48] ml-1">100%</span>
                          </div>
                          <div className="text-xs text-[#027A48] font-medium mt-0.5">
                            {cust.progressStep}
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="flex items-center gap-1.5 text-xs">
                            <span className={`text-[13px] leading-none ${cust.progressPercentage >= 25 ? 'text-[#2563EB]' : 'text-gray-300'}`}>
                              {cust.progressPercentage >= 25 ? '●' : '○'}
                            </span>
                            <span className={`text-[13px] leading-none ${cust.progressPercentage >= 50 ? 'text-[#2563EB]' : 'text-gray-300'}`}>
                              {cust.progressPercentage >= 50 ? '●' : '○'}
                            </span>
                            <span className={`text-[13px] leading-none ${cust.progressPercentage >= 75 ? 'text-[#2563EB]' : 'text-gray-300'}`}>
                              {cust.progressPercentage >= 75 ? '●' : '○'}
                            </span>
                            <span className={`text-[13px] leading-none ${cust.progressPercentage >= 100 ? 'text-[#2563EB]' : 'text-gray-300'}`}>
                              {cust.progressPercentage >= 100 ? '●' : '○'}
                            </span>
                            <span className="text-xs font-semibold text-gray-700 ml-1">
                              {cust.progressPercentage}%
                            </span>
                          </div>
                          <div className="text-xs text-gray-400 mt-0.5">
                            {cust.progressStep}
                          </div>
                        </>
                      )}
                    </td>

                    {/* NHÓM PHỤ TRÁCH */}
                    <td className="px-4 py-4">
                      <div className="flex items-center gap-1 text-sm font-medium text-gray-900">
                        <span>{cust.staffLead}</span>
                        <span className="text-amber-500 text-[14px]">★</span>
                        {cust.staffSupport && cust.staffSupport.length > 0 && (
                          <span className="text-gray-500">, {cust.staffSupport.join(', ')}</span>
                        )}
                      </div>
                    </td>

                    {/* HẸN TIẾP THEO */}
                    <td className="px-4 py-4">
                      {cust.nextAppointmentDate === 'Hôm nay' ? (
                        <>
                          <div className="flex items-center gap-1.5 text-[#175CD3] font-semibold text-xs">
                            <span className="w-1.5 h-1.5 rounded-full bg-[#175CD3]"></span>
                            <span>Hôm nay</span>
                          </div>
                          <div className="text-xs text-gray-900 font-medium">
                            {cust.nextAppointmentTime}
                          </div>
                          {cust.nextAppointmentNote && (
                            <div className="text-xs text-gray-500 mt-0.5">
                              {cust.nextAppointmentNote}
                            </div>
                          )}
                        </>
                      ) : (
                        <>
                          <div className="text-xs text-gray-900 font-medium">
                            {cust.nextAppointmentDate || 'Chờ lên lịch'}
                          </div>
                          <div className="text-xs text-gray-500 mt-0.5">
                            {cust.nextAppointmentTime || 'Chưa xếp'}
                          </div>
                        </>
                      )}
                    </td>

                    {/* THAO TÁC (Nút Gọi nền xanh nhạt, Zalo nền xanh lá nhạt, Thêm khách xanh dương đậm) */}
                    <td
                      className="px-6 py-4"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="flex items-center justify-center gap-1.5">
                        {/* Nút Gọi: Nền xanh dương nhạt #EFF8FF, chữ xanh #175CD3, viền #B2DDFF */}
                        <button
                          type="button"
                          onClick={() => onOpenCall(cust)}
                          className="px-2.5 py-1 rounded-lg bg-[#EFF8FF] hover:bg-[#D1E9FF] text-[#175CD3] border border-[#B2DDFF] text-xs font-semibold flex items-center gap-1 transition-all shadow-xs active:scale-95 cursor-pointer"
                          title="Gọi điện"
                        >
                          <span className="material-symbols-outlined text-[15px]">call</span>
                          <span>Gọi</span>
                        </button>

                        {/* Nút Zalo: Nền xanh ngọc nhạt #ECFDF3, chữ xanh #027A48, viền #A6F4C5 */}
                        <button
                          type="button"
                          onClick={() => onOpenZalo(cust)}
                          className="px-2.5 py-1 rounded-lg bg-[#ECFDF3] hover:bg-[#D1FADF] text-[#027A48] border border-[#A6F4C5] text-xs font-semibold flex items-center gap-1 transition-all shadow-xs active:scale-95 cursor-pointer"
                          title="Nhắn Zalo"
                        >
                          <span className="material-symbols-outlined text-[15px]">chat</span>
                          <span>Zalo</span>
                        </button>

                        {/* Nút icon Ghi chú */}
                        <button
                          type="button"
                          onClick={() => onOpenQuickNote(cust)}
                          className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors cursor-pointer"
                          title="Ghi chú nhanh"
                        >
                          <span className="material-symbols-outlined text-[18px]">edit_note</span>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>

        {/* ==================== 5. TABLE FOOTER & PAGINATION ==================== */}
        <div className="px-6 py-4 border-t border-gray-200 bg-surface-container-lowest flex flex-col sm:flex-row items-center justify-between gap-4">
          {/* Rows per page selector */}
          <div className="flex items-center gap-3 text-body-md font-body-md text-gray-600">
            <span>Dòng hiển thị:</span>
            <select
              value={rowsPerPage}
              onChange={(e) => setRowsPerPage(Number(e.target.value))}
              className="h-8 px-2.5 bg-white border border-gray-200 rounded-lg text-body-md font-body-md text-gray-700 focus:border-brand-500 focus:ring-1 focus:ring-brand-500 shadow-theme-xs cursor-pointer"
            >
              <option value={20}>20</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </select>
            <span className="text-gray-400">|</span>
            <span className="text-label-xs font-label-xs text-gray-500">
              128 khách hàng đã ghi nhận
            </span>
          </div>

          {/* Pagination Controls */}
          <div className="flex items-center gap-1.5">
            <button
              disabled={currentPage === 1}
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              className="w-8 h-8 flex items-center justify-center rounded-lg border border-gray-200 text-gray-400 hover:text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-40"
              title="Trang trước"
            >
              <span className="material-symbols-outlined text-[18px]">chevron_left</span>
            </button>

            {[1, 2, 3].map((page) => (
              <button
                key={page}
                onClick={() => setCurrentPage(page)}
                className={`w-8 h-8 rounded-lg font-body-md-medium text-body-md flex items-center justify-center transition-all ${
                  currentPage === page
                    ? 'bg-brand-500 text-white shadow-theme-xs font-bold'
                    : 'border border-gray-200 text-gray-700 hover:bg-gray-100'
                }`}
              >
                {page}
              </button>
            ))}

            <span className="px-1 text-gray-400 font-body-md">...</span>

            <button
              onClick={() => setCurrentPage(7)}
              className="w-8 h-8 rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-100 font-body-md text-body-md flex items-center justify-center transition-colors"
            >
              7
            </button>

            <button
              disabled={currentPage === 7}
              onClick={() => setCurrentPage((p) => Math.min(7, p + 1))}
              className="w-8 h-8 flex items-center justify-center rounded-lg border border-gray-200 text-gray-600 hover:text-gray-900 hover:bg-gray-50 transition-colors"
              title="Trang kế"
            >
              <span className="material-symbols-outlined text-[18px]">chevron_right</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
