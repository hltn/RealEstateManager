import React, { useState } from 'react';
import { FilterOptions } from '../types';
import { AVAILABLE_PROJECTS } from '../data/mockData';

interface AdvancedFilterModalProps {
  isOpen: boolean;
  onClose: () => void;
  filters: FilterOptions;
  onApplyFilters: (newFilters: FilterOptions) => void;
  onResetFilters: () => void;
}

export const AdvancedFilterModal: React.FC<AdvancedFilterModalProps> = ({
  isOpen,
  onClose,
  filters,
  onApplyFilters,
  onResetFilters,
}) => {
  const [selectedProjects, setSelectedProjects] = useState<string[]>(filters.projectsSelected);
  const [timeRange, setTimeRange] = useState<string>(filters.timeRange);
  const [staff, setStaff] = useState<string>(filters.staff);
  const [searchProjectQuery, setSearchProjectQuery] = useState<string>('');

  if (!isOpen) return null;

  const toggleProject = (proj: string) => {
    if (proj === 'all') {
      setSelectedProjects([]);
      return;
    }
    if (selectedProjects.includes(proj)) {
      setSelectedProjects(selectedProjects.filter((p) => p !== proj));
    } else {
      setSelectedProjects([...selectedProjects, proj]);
    }
  };

  const handleApply = () => {
    onApplyFilters({
      ...filters,
      projectsSelected: selectedProjects,
      timeRange,
      staff,
    });
    onClose();
  };

  const handleReset = () => {
    setSelectedProjects([]);
    setTimeRange('month');
    setStaff('all');
    onResetFilters();
  };

  const filteredAvailableProjects = AVAILABLE_PROJECTS.filter((p) =>
    p.toLowerCase().includes(searchProjectQuery.toLowerCase())
  );

  return (
    <>
      {/* Backdrop overlay */}
      <div
        onClick={onClose}
        className="fixed inset-0 bg-gray-950/60 backdrop-blur-[3px] z-[9998] transition-opacity animate-in fade-in duration-200"
      />

      {/* Modal Bottom Sheet Container */}
      <div className="fixed inset-x-0 bottom-0 z-[9999] flex justify-center items-end outline-none pointer-events-none">
        <div className="w-full max-w-lg bg-white rounded-t-[24px] shadow-theme-lg border-t border-gray-200 flex flex-col max-h-[92vh] pointer-events-auto animate-in slide-in-from-bottom duration-300">
          {/* Header Modal: Drag handle & Title bar */}
          <div className="pt-3 pb-2 px-5 flex flex-col items-center border-b border-gray-100 flex-shrink-0">
            <div className="w-11 h-1.5 bg-gray-300 rounded-full mb-3 cursor-grab hover:bg-gray-400 transition-colors" />
            <div className="w-full flex items-center justify-between pb-1">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  aria-label="Đóng bộ lọc"
                  onClick={onClose}
                  className="w-8 h-8 rounded-lg flex items-center justify-center text-gray-500 hover:bg-gray-100 transition-colors -ml-1"
                >
                  <span className="material-symbols-outlined text-[20px]">close</span>
                </button>
                <h2 className="text-title-md font-bold text-gray-900 tracking-tight">
                  Bộ lọc nâng cao
                </h2>
              </div>
              <button
                type="button"
                onClick={handleReset}
                className="text-brand-500 hover:text-brand-600 font-medium flex items-center gap-1 px-2 py-1 rounded-md hover:bg-brand-50 transition-colors active:scale-95 text-xs"
              >
                <span className="material-symbols-outlined text-[16px]">restart_alt</span>
                Thiết lập lại
              </button>
            </div>
          </div>

          {/* Scrollable Filter Content */}
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-6 overscroll-contain">
            {/* TIÊU CHÍ 1: DỰ ÁN QUAN TÂM */}
            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-label-xs uppercase text-gray-700 tracking-wider font-semibold flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-brand-500 text-[18px]">
                    apartment
                  </span>
                  Dự án quan tâm <span className="text-brand-500">*</span>
                </label>
                <span className="text-label-xs text-brand-600 bg-brand-50 px-2 py-0.5 rounded-full font-medium">
                  Đã chọn {selectedProjects.length}
                </span>
              </div>

              {/* Quick Search */}
              <div className="relative">
                <span className="material-symbols-outlined absolute left-3 top-2.5 text-gray-400 text-[18px]">
                  search
                </span>
                <input
                  type="text"
                  value={searchProjectQuery}
                  onChange={(e) => setSearchProjectQuery(e.target.value)}
                  placeholder="Tìm nhanh tên dự án..."
                  className="w-full h-10 pl-9 pr-3 text-body-md rounded-lg border border-gray-200 bg-gray-50/70 focus:bg-white focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10 placeholder-gray-400 outline-none transition-all"
                />
              </div>

              {/* Project Pills */}
              <div className="flex flex-wrap gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => toggleProject('all')}
                  className={`px-3.5 py-1.5 rounded-lg text-body-md transition-all active:scale-95 ${
                    selectedProjects.length === 0
                      ? 'bg-brand-500 text-white font-medium shadow-theme-xs'
                      : 'text-gray-600 bg-gray-100 hover:bg-gray-200'
                  }`}
                >
                  Tất cả dự án
                </button>
                {filteredAvailableProjects.map((proj) => {
                  const isSelected = selectedProjects.includes(proj);
                  return (
                    <button
                      key={proj}
                      type="button"
                      onClick={() => toggleProject(proj)}
                      className={`px-3.5 py-1.5 rounded-lg text-body-md flex items-center gap-1.5 transition-all active:scale-95 ${
                        isSelected
                          ? 'bg-brand-500 text-white font-medium shadow-theme-xs'
                          : 'text-gray-700 bg-white border border-gray-200 hover:border-brand-300 hover:bg-brand-50/40'
                      }`}
                    >
                      {isSelected && (
                        <span className="material-symbols-outlined text-[16px]">check</span>
                      )}
                      {proj}
                    </button>
                  );
                })}
              </div>
            </section>

            <div className="h-px bg-gray-100"></div>

            {/* TIÊU CHÍ 2: THỜI GIAN PHÂN TÍCH */}
            <section className="space-y-3">
              <label className="text-label-xs uppercase text-gray-700 tracking-wider font-semibold flex items-center gap-1.5">
                <span className="material-symbols-outlined text-brand-500 text-[18px]">
                  calendar_month
                </span>
                Thời gian phân tích
              </label>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { id: 'week', label: 'Tuần này' },
                  { id: 'month', label: 'Tháng này' },
                  { id: 'quarter', label: 'Quý này' },
                  { id: 'year', label: 'Năm nay' },
                ].map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setTimeRange(item.id)}
                    className={`h-9 rounded-lg text-body-md transition-all active:scale-95 text-center ${
                      timeRange === item.id
                        ? 'bg-brand-50 border border-brand-500 text-brand-600 font-medium shadow-theme-xs'
                        : 'border border-gray-200 text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </section>

            <div className="h-px bg-gray-100"></div>

            {/* TIÊU CHÍ 3: NHÂN VIÊN PHỤ TRÁCH */}
            <section className="space-y-3">
              <label className="text-label-xs uppercase text-gray-700 tracking-wider font-semibold flex items-center gap-1.5">
                <span className="material-symbols-outlined text-brand-500 text-[18px]">
                  badge
                </span>
                Nhân viên phụ trách
              </label>
              <div className="relative">
                <select
                  value={staff}
                  onChange={(e) => setStaff(e.target.value)}
                  className="w-full h-11 px-3.5 pr-10 rounded-lg border border-gray-200 text-body-md bg-white text-gray-800 focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10 outline-none appearance-none"
                >
                  <option value="all">Tất cả nhân sự (Toàn ban)</option>
                  <option value="Hạnh ★">Hạnh ★ (Trưởng nhóm kinh doanh 1)</option>
                  <option value="Thảo">Thảo (Chuyên viên tư vấn cao cấp)</option>
                  <option value="Tuấn">Tuấn (Chuyên viên tư vấn)</option>
                  <option value="Minh ★">Minh ★ (Tư vấn viên dự án Privia)</option>
                  <option value="Quân">Quân (Thực tập sinh)</option>
                </select>
                <span className="material-symbols-outlined absolute right-3 top-3 text-gray-400 pointer-events-none text-[20px]">
                  keyboard_arrow_down
                </span>
              </div>
            </section>
          </div>

          {/* Fixed Footer */}
          <div className="p-4 bg-white border-t border-gray-200 flex items-center gap-3 flex-shrink-0 shadow-theme-md">
            <button
              type="button"
              onClick={onClose}
              className="w-1/3 h-12 bg-white hover:bg-gray-50 border border-gray-200 text-gray-700 rounded-lg font-medium flex items-center justify-center transition-all active:scale-95 shadow-theme-xs text-sm"
            >
              Đóng / Hủy
            </button>
            <button
              type="button"
              onClick={handleApply}
              className="w-2/3 h-12 bg-brand-500 hover:bg-brand-600 text-white rounded-lg font-medium flex items-center justify-center gap-2 shadow-theme-sm transition-all active:scale-[0.98] text-sm"
            >
              <span className="material-symbols-outlined text-[18px]">filter_list</span>
              <span>Áp dụng</span>
            </button>
          </div>
        </div>
      </div>
    </>
  );
};
