/**
 * Bộ lọc nâng cao danh sách khách (X3): tình trạng, nguồn, dự án (tìm không dấu), khu vực, người chăm sóc
 * (bất kỳ ai trong nhóm) / phụ trách chính, tiến độ, ngày cập nhật, nghề nghiệp, thẻ.
 * - Web: vỏ `components/ui/modal` của Admin; App: `BottomSheet`.
 * Bản nháp giữ cục bộ; chỉ ghi vào store khi bấm "Áp dụng" hoặc "Thiết lập lại".
 */
import { useMemo, useState, type ReactNode } from 'react';
import { Check, ListFilter, RotateCcw, Search } from 'lucide-react';
import { Modal } from '../../../components/ui/modal';
import { useCatalogs, useProjectFilterOptions } from '@crm/api';
import { PROGRESS_FILTER_OPTIONS, toggleValue } from '@crm/lib/customerFilters';
import { includesVietnamese } from '@crm/lib/text';
import { BUTTON_OUTLINE_CLASS, BUTTON_PRIMARY_CLASS, CAPTION_CLASS, MODAL_INPUT_CLASS, PILL_ACTIVE_CLASS, PILL_IDLE_CLASS } from '@crm/lib/uiClasses';
import type { CustomerFilters } from '@crm/types/app';
import { BottomSheet } from './BottomSheet';

export type AdvancedFilterVariant = 'dialog' | 'sheet';

const TITLE_ID = 'crm-advanced-filter-title';
const CHIP_BASE_CLASS =
  'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors active:scale-[0.98]';

interface AdvancedFilterModalProps {
  filters: CustomerFilters;
  variant: AdvancedFilterVariant;
  onApply: (filters: CustomerFilters) => void;
  onReset: () => void;
  onClose: () => void;
}

interface ChipOption<T> {
  value: T;
  label: string;
}

interface ChipGroupProps<T> {
  title: string;
  options: ChipOption<T>[];
  selected: T[];
  onToggle: (value: T) => void;
  children?: ReactNode;
}

const ChipGroup = <T extends string | number>({ title, options, selected, onToggle, children }: ChipGroupProps<T>) => (
  <section className="space-y-2.5">
    <div className="flex items-center justify-between gap-2">
      <span className={CAPTION_CLASS}>{title}</span>
      <span className="text-theme-xs text-gray-500 dark:text-gray-400">{selected.length === 0 ? 'Tất cả' : `Đã chọn ${selected.length}`}</span>
    </div>
    {children}
    <div role="group" aria-label={title} className="flex flex-wrap gap-2">
      {options.map((option) => {
        const isSelected = selected.includes(option.value);
        return (
          <button
            key={String(option.value)}
            type="button"
            aria-pressed={isSelected}
            onClick={() => onToggle(option.value)}
            className={`${CHIP_BASE_CLASS} ${isSelected ? PILL_ACTIVE_CLASS : PILL_IDLE_CLASS}`}
          >
            {isSelected && <Check size={14} aria-hidden="true" />}
            {option.label}
          </button>
        );
      })}
      {options.length === 0 && <p className="text-theme-sm text-gray-500 dark:text-gray-400">Không có lựa chọn phù hợp.</p>}
    </div>
  </section>
);

export const AdvancedFilterModal = ({ filters, variant, onApply, onReset, onClose }: AdvancedFilterModalProps) => {
  const { catalogs, users } = useCatalogs();
  const [draft, setDraft] = useState<CustomerFilters>(filters);
  const [projectKeyword, setProjectKeyword] = useState('');
  const isSheet = variant === 'sheet';
  const toggle = <K extends 'statusIds' | 'sourceIds' | 'projectIds' | 'areaIds' | 'assigneeIds' | 'primaryAssigneeIds' | 'tagIds'>(key: K, value: string) =>
    setDraft((current) => ({ ...current, [key]: toggleValue(current[key], value) }));

  const projectOptions = useProjectFilterOptions();
  const visibleProjects = useMemo(() => projectOptions.filter((project) => includesVietnamese(project.searchText, projectKeyword)), [projectOptions, projectKeyword]);
  const staffOptions = users.filter((user) => user.isActive && user.role !== 'ADMIN').map((user) => ({ value: user.id, label: user.fullName }));

  const handleApply = () => {
    onApply(draft);
    onClose();
  };
  const handleReset = () => {
    setDraft({ ...draft, statusIds: [], sourceIds: [], projectIds: [], areaIds: [], assigneeIds: [], primaryAssigneeIds: [], progress: [], updatedFrom: '', updatedTo: '', occupation: '', tagIds: [] });
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
      <ChipGroup
        title="Tình trạng"
        options={catalogs.statuses.filter((status) => status.isActive).map((status) => ({ value: status.id, label: status.label }))}
        selected={draft.statusIds}
        onToggle={(value) => toggle('statusIds', value)}
      />
      <ChipGroup
        title="Nguồn khách"
        options={catalogs.leadSources.filter((source) => source.isActive).map((source) => ({ value: source.id, label: source.label }))}
        selected={draft.sourceIds}
        onToggle={(value) => toggle('sourceIds', value)}
      />
      <ChipGroup
        title="Dự án quan tâm"
        options={visibleProjects.map(({ value, label }) => ({ value, label }))}
        selected={draft.projectIds}
        onToggle={(value) => toggle('projectIds', value)}
      >
        <div className="relative">
          <Search size={18} aria-hidden="true" className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="search"
            value={projectKeyword}
            onChange={(event) => setProjectKeyword(event.target.value)}
            placeholder="Tìm nhanh tên dự án (có/không dấu)..."
            aria-label="Tìm dự án"
            className={`${MODAL_INPUT_CLASS} pl-10`}
          />
        </div>
      </ChipGroup>
      <ChipGroup
        title="Khu vực"
        options={catalogs.areas.filter((area) => area.isActive).map((area) => ({ value: area.id, label: area.name }))}
        selected={draft.areaIds}
        onToggle={(value) => toggle('areaIds', value)}
      />
      <ChipGroup title="Người chăm sóc (chính hoặc hỗ trợ)" options={staffOptions} selected={draft.assigneeIds} onToggle={(value) => toggle('assigneeIds', value)} />
      <ChipGroup title="Phụ trách chính" options={staffOptions} selected={draft.primaryAssigneeIds} onToggle={(value) => toggle('primaryAssigneeIds', value)} />
      <ChipGroup
        title="Tiến độ"
        options={PROGRESS_FILTER_OPTIONS.map((option) => ({ value: option.value, label: option.label }))}
        selected={draft.progress}
        onToggle={(value) => setDraft((current) => ({ ...current, progress: toggleValue(current.progress, value) }))}
      />
      <ChipGroup
        title="Thẻ sở thích / nghề nghiệp (khớp tất cả thẻ chọn)"
        options={catalogs.tags.filter((tag) => tag.isActive).map((tag) => ({ value: tag.id, label: `#${tag.name}` }))}
        selected={draft.tagIds}
        onToggle={(value) => toggle('tagIds', value)}
      />

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className="space-y-1.5">
          <span className={CAPTION_CLASS}>Cập nhật từ ngày</span>
          <input type="date" value={draft.updatedFrom} onChange={(event) => setDraft({ ...draft, updatedFrom: event.target.value })} className={`${MODAL_INPUT_CLASS} dark:[color-scheme:dark]`} />
        </label>
        <label className="space-y-1.5">
          <span className={CAPTION_CLASS}>Đến ngày</span>
          <input type="date" value={draft.updatedTo} onChange={(event) => setDraft({ ...draft, updatedTo: event.target.value })} className={`${MODAL_INPUT_CLASS} dark:[color-scheme:dark]`} />
        </label>
        <label className="space-y-1.5 sm:col-span-2">
          <span className={CAPTION_CLASS}>Nghề nghiệp (chứa, không dấu)</span>
          <input type="text" value={draft.occupation} onChange={(event) => setDraft({ ...draft, occupation: event.target.value })} placeholder="VD: giam doc, ke toan" className={MODAL_INPUT_CLASS} />
        </label>
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
    <Modal isOpen onClose={onClose} showCloseButton={false} className="mx-4 max-w-2xl overflow-hidden">
      <div role="dialog" aria-modal="true" aria-labelledby={TITLE_ID} className="flex max-h-[90vh] flex-col">
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-gray-200 px-6 py-4 dark:border-gray-800">
          <h3 id={TITLE_ID} className="text-lg font-semibold text-gray-800 dark:text-white/90">
            Bộ lọc nâng cao
          </h3>
          {resetButton}
        </header>
        <div className="flex-1 overflow-y-auto px-6 py-5">{body}</div>
        <footer className="shrink-0 border-t border-gray-200 px-6 py-4 dark:border-gray-800">{footer}</footer>
      </div>
    </Modal>
  );
};
