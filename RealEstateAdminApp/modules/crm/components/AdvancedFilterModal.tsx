/**
 * Bộ lọc nâng cao — port từ Mobile `src/views/AdvancedFilterModal.tsx`
 * (nhiều dự án + tìm nhanh, khoảng thời gian, nhân viên phụ trách).
 * - Web: vỏ `components/ui/modal` của Admin (`max-w-lg`), nội dung cuộn, chân nút cố định.
 * - App: `BottomSheet` (bố cục Stitch: thanh kéo, "Thiết lập lại" ở đầu, chân 1/3 – 2/3).
 * Chip chọn dự án / thẻ chọn thời gian: Admin chưa có (tài liệu 03 mục 10) → vẽ theo Stitch bằng token Admin.
 * Bản nháp giữ cục bộ; chỉ ghi vào store khi bấm "Áp dụng" (onApply) hoặc "Thiết lập lại" (onReset).
 */
import { useMemo, useState } from 'react';
import { Building, CalendarRange, Check, ListFilter, RotateCcw, Search, UserRound } from 'lucide-react';
import { Modal } from '../../../components/ui/modal';
import { DEFAULT_FILTERS, PROJECT_NAMES, STAFF_LIST } from '@crm/data/mockData';
import type { FilterOptions, FilterTimeRange } from '@crm/types/crm';
import { BottomSheet } from './BottomSheet';
import {
  BUTTON_OUTLINE_CLASS,
  BUTTON_PRIMARY_CLASS,
  CAPTION_CLASS,
  MODAL_INPUT_CLASS,
  OPTION_ACTIVE_CLASS,
  OPTION_IDLE_CLASS,
  PILL_ACTIVE_CLASS,
  PILL_IDLE_CLASS,
  SOLID_INPUT_CLASS,
} from '@crm/lib/uiClasses';

export type AdvancedFilterVariant = 'dialog' | 'sheet';

export const TIME_RANGE_OPTIONS: { value: FilterTimeRange; label: string }[] = [
  { value: 'week', label: 'Tuần này' },
  { value: 'month', label: 'Tháng này' },
  { value: 'quarter', label: 'Quý này' },
  { value: 'year', label: 'Năm nay' },
];

const TITLE_ID = 'crm-advanced-filter-title';

const CHIP_BASE_CLASS =
  'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors active:scale-[0.98]';

interface AdvancedFilterModalProps {
  filters: FilterOptions;
  /** 'dialog' = modal giữa màn (web), 'sheet' = trượt từ đáy (app). */
  variant: AdvancedFilterVariant;
  onApply: (filters: FilterOptions) => void;
  onReset: () => void;
  onClose: () => void;
}

interface SectionTitleProps {
  icon: typeof Building;
  label: string;
  htmlFor?: string;
}

const SectionTitle = ({ icon: Icon, label, htmlFor }: SectionTitleProps) => (
  <label htmlFor={htmlFor} className={`${CAPTION_CLASS} flex items-center gap-1.5`}>
    <Icon size={16} className="text-brand-500 dark:text-brand-400" aria-hidden="true" />
    {label}
  </label>
);

export const AdvancedFilterModal = ({ filters, variant, onApply, onReset, onClose }: AdvancedFilterModalProps) => {
  const [selectedProjects, setSelectedProjects] = useState<string[]>(filters.projectsSelected);
  const [timeRange, setTimeRange] = useState<FilterTimeRange>(filters.timeRange);
  const [staff, setStaff] = useState(filters.staff);
  const [projectKeyword, setProjectKeyword] = useState('');
  const isSheet = variant === 'sheet';
  const isAllProjects = selectedProjects.length === 0;

  const visibleProjects = useMemo(() => {
    const keyword = projectKeyword.trim().toLowerCase();
    return keyword ? PROJECT_NAMES.filter((project) => project.toLowerCase().includes(keyword)) : PROJECT_NAMES;
  }, [projectKeyword]);

  const toggleProject = (project: string) =>
    setSelectedProjects((current) =>
      current.includes(project) ? current.filter((item) => item !== project) : [...current, project],
    );

  const handleApply = () => {
    onApply({ ...filters, projectsSelected: selectedProjects, timeRange, staff });
    onClose();
  };

  /** Như bản Mobile: đặt lại bản nháp + store, KHÔNG đóng (người dùng thấy ngay kết quả đặt lại). */
  const handleReset = () => {
    setSelectedProjects([]);
    setTimeRange(DEFAULT_FILTERS.timeRange);
    setStaff('all');
    setProjectKeyword('');
    onReset();
  };

  const resetButton = (
    <button
      type="button"
      onClick={handleReset}
      className="inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-sm font-medium text-brand-500 transition-colors hover:bg-brand-50 dark:text-brand-400 dark:hover:bg-brand-500/10"
    >
      <RotateCcw size={15} aria-hidden="true" />
      Thiết lập lại
    </button>
  );

  const body = (
    <div className="space-y-6">
      {/* 1. Dự án quan tâm (chọn nhiều) */}
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <SectionTitle icon={Building} label="Dự án quan tâm" htmlFor="advanced-filter-project-search" />
          <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-600 dark:bg-brand-500/15 dark:text-brand-400">
            {isAllProjects ? 'Tất cả' : `Đã chọn ${selectedProjects.length}`}
          </span>
        </div>
        <div className="relative">
          <Search size={18} aria-hidden="true" className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            id="advanced-filter-project-search"
            type="search"
            value={projectKeyword}
            onChange={(event) => setProjectKeyword(event.target.value)}
            placeholder="Tìm nhanh tên dự án..."
            className={`${MODAL_INPUT_CLASS} pl-10`}
          />
        </div>
        <div role="group" aria-label="Chọn dự án" className="flex flex-wrap gap-2">
          <button
            type="button"
            aria-pressed={isAllProjects}
            onClick={() => setSelectedProjects([])}
            className={`${CHIP_BASE_CLASS} ${isAllProjects ? PILL_ACTIVE_CLASS : PILL_IDLE_CLASS}`}
          >
            Tất cả dự án
          </button>
          {visibleProjects.map((project) => {
            const isSelected = selectedProjects.includes(project);
            return (
              <button
                key={project}
                type="button"
                aria-pressed={isSelected}
                onClick={() => toggleProject(project)}
                className={`${CHIP_BASE_CLASS} ${isSelected ? PILL_ACTIVE_CLASS : PILL_IDLE_CLASS}`}
              >
                {isSelected && <Check size={14} aria-hidden="true" />}
                {project}
              </button>
            );
          })}
          {visibleProjects.length === 0 && (
            <p className="text-theme-sm text-gray-500 dark:text-gray-400">Không tìm thấy dự án phù hợp.</p>
          )}
        </div>
      </section>

      <div aria-hidden="true" className="h-px bg-gray-100 dark:bg-white/[0.05]" />

      {/* 2. Thời gian phân tích */}
      <section className="space-y-3">
        <SectionTitle icon={CalendarRange} label="Thời gian phân tích" />
        <div role="radiogroup" aria-label="Thời gian phân tích" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {TIME_RANGE_OPTIONS.map((option) => {
            const isSelected = timeRange === option.value;
            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={isSelected}
                onClick={() => setTimeRange(option.value)}
                className={`h-10 rounded-lg border text-sm font-medium transition-colors ${
                  isSelected ? OPTION_ACTIVE_CLASS : OPTION_IDLE_CLASS
                }`}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      </section>

      <div aria-hidden="true" className="h-px bg-gray-100 dark:bg-white/[0.05]" />

      {/* 3. Nhân viên phụ trách */}
      <section className="space-y-3">
        <SectionTitle icon={UserRound} label="Nhân viên phụ trách" htmlFor="advanced-filter-staff" />
        <select
          id="advanced-filter-staff"
          value={staff}
          onChange={(event) => setStaff(event.target.value)}
          className={SOLID_INPUT_CLASS}
        >
          <option value="all">Tất cả nhân sự (Toàn ban)</option>
          {STAFF_LIST.map((member) => (
            <option key={member.id} value={member.id}>
              {member.name}
            </option>
          ))}
        </select>
      </section>
    </div>
  );

  const footer = (
    <div className="flex items-center gap-3">
      <button type="button" onClick={onClose} className={`${BUTTON_OUTLINE_CLASS} h-11 flex-1`}>
        Đóng
      </button>
      <button type="button" onClick={handleApply} className={`${BUTTON_PRIMARY_CLASS} h-11 flex-[2]`}>
        <ListFilter size={18} aria-hidden="true" />
        Áp dụng
      </button>
    </div>
  );

  if (isSheet) {
    return (
      <BottomSheet titleId={TITLE_ID} title="Bộ lọc nâng cao" headerAction={resetButton} footer={footer} onClose={onClose}>
        {body}
      </BottomSheet>
    );
  }

  return (
    <Modal isOpen onClose={onClose} showCloseButton={false} className="mx-4 max-w-lg overflow-hidden">
      <div role="dialog" aria-modal="true" aria-labelledby={TITLE_ID} className="flex max-h-[90vh] flex-col">
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-gray-200 px-6 py-4 dark:border-gray-800">
          <h3 id={TITLE_ID} className="text-lg font-semibold text-gray-800 dark:text-white/90">
            Bộ lọc tìm kiếm nâng cao
          </h3>
          {resetButton}
        </header>
        <div className="flex-1 overflow-y-auto px-6 py-5">{body}</div>
        <footer className="shrink-0 border-t border-gray-200 px-6 py-4 dark:border-gray-800">{footer}</footer>
      </div>
    </Modal>
  );
};
