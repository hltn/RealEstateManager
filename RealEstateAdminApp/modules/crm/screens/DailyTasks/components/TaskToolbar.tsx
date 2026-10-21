/**
 * Thanh lọc việc hôm nay (web) — mẫu "thanh lọc" Admin (`ExternalLogsScreen.tsx:202-293`), ô tìm có icon kiểu
 * `ManageWpScreen.tsx:738-748`. Trường theo Admin Stitch `DailyTasksView`: tìm kiếm, dự án, người phụ trách,
 * mức ưu tiên, làm mới bộ lọc, chuyển dạng Kanban / Danh sách (điều khiển phân đoạn — Admin chưa có, vẽ mới).
 * Bộ lọc là state cục bộ của màn (FilterOptions của store chỉ mô tả bộ lọc khách hàng).
 */
import { Kanban, List, RotateCcw, Search } from 'lucide-react';
import { BUTTON_OUTLINE_BASE_CLASS, CAPTION_CLASS, FILTER_INPUT_CLASS } from '@crm/lib/uiClasses';
import { PROJECT_NAMES } from '@crm/data/mockData';
import { TASK_PRIORITY_OPTIONS, type TaskFilterState, type TaskPriorityFilter } from '../taskFilters';

export type TaskViewMode = 'kanban' | 'list';

const VIEW_MODE_OPTIONS: { value: TaskViewMode; label: string; icon: typeof Kanban }[] = [
  { value: 'kanban', label: 'Dạng cột Kanban', icon: Kanban },
  { value: 'list', label: 'Dạng danh sách', icon: List },
];

interface TaskToolbarProps {
  filters: TaskFilterState;
  onFiltersChange: (changes: Partial<TaskFilterState>) => void;
  onReset: () => void;
  assignees: string[];
  viewMode: TaskViewMode;
  onViewModeChange: (viewMode: TaskViewMode) => void;
}

export const TaskToolbar = ({ filters, onFiltersChange, onReset, assignees, viewMode, onViewModeChange }: TaskToolbarProps) => (
  <div className="flex flex-col gap-4 rounded-2xl border border-gray-200 bg-white p-4 md:flex-row md:flex-wrap md:items-end dark:border-white/[0.05] dark:bg-white/[0.03]">
    <div className="flex flex-col gap-1.5 md:min-w-[220px] md:flex-1">
      <label htmlFor="task-search" className={CAPTION_CLASS}>
        Tìm kiếm
      </label>
      <div className="relative">
        <Search size={18} aria-hidden="true" className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          id="task-search"
          type="search"
          value={filters.search}
          onChange={(event) => onFiltersChange({ search: event.target.value })}
          placeholder="Tên, SĐT, dự án, nội dung..."
          className={`${FILTER_INPUT_CLASS} w-full pl-10`}
        />
      </div>
    </div>

    <div className="flex flex-col gap-1.5">
      <label htmlFor="task-project" className={CAPTION_CLASS}>
        Dự án
      </label>
      <select
        id="task-project"
        value={filters.project}
        onChange={(event) => onFiltersChange({ project: event.target.value })}
        className={`${FILTER_INPUT_CLASS} md:min-w-[150px]`}
      >
        <option value="all">Tất cả</option>
        {PROJECT_NAMES.map((project) => (
          <option key={project} value={project}>
            {project}
          </option>
        ))}
      </select>
    </div>

    <div className="flex flex-col gap-1.5">
      <label htmlFor="task-assignee" className={CAPTION_CLASS}>
        Người phụ trách
      </label>
      <select
        id="task-assignee"
        value={filters.assignee}
        onChange={(event) => onFiltersChange({ assignee: event.target.value })}
        className={`${FILTER_INPUT_CLASS} md:min-w-[150px]`}
      >
        <option value="all">Tất cả</option>
        {assignees.map((assignee) => (
          <option key={assignee} value={assignee}>
            {assignee}
          </option>
        ))}
      </select>
    </div>

    <div className="flex flex-col gap-1.5">
      <label htmlFor="task-priority" className={CAPTION_CLASS}>
        Mức ưu tiên
      </label>
      <select
        id="task-priority"
        value={filters.priority}
        onChange={(event) => onFiltersChange({ priority: event.target.value as TaskPriorityFilter })}
        className={`${FILTER_INPUT_CLASS} md:min-w-[160px]`}
      >
        {TASK_PRIORITY_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.value === 'all' ? 'Tất cả' : option.label}
          </option>
        ))}
      </select>
    </div>

    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={onReset}
        title="Làm mới bộ lọc"
        aria-label="Làm mới bộ lọc"
        className={`${BUTTON_OUTLINE_BASE_CLASS} h-10 w-10 shrink-0`}
      >
        <RotateCcw size={16} aria-hidden="true" />
      </button>

      <div
        role="radiogroup"
        aria-label="Kiểu hiển thị"
        className="flex h-10 items-center gap-0.5 rounded-lg border border-gray-200 bg-gray-100 p-0.5 dark:border-white/[0.05] dark:bg-gray-800"
      >
        {VIEW_MODE_OPTIONS.map(({ value, label, icon: Icon }) => {
          const isActive = viewMode === value;
          return (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={isActive}
              aria-label={label}
              title={label}
              onClick={() => onViewModeChange(value)}
              className={`flex h-full w-9 items-center justify-center rounded-md transition-colors ${
                isActive
                  ? 'bg-white text-brand-500 shadow-theme-xs dark:bg-gray-900 dark:text-brand-400'
                  : 'text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-white/90'
              }`}
            >
              <Icon size={18} aria-hidden="true" />
            </button>
          );
        })}
      </div>
    </div>
  </div>
);
