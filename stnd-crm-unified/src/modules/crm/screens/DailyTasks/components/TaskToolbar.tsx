/**
 * Thanh lọc Việc hôm nay (web) — mẫu "thanh lọc" Admin: tìm kiếm (không dấu), dự án, người thực hiện, loại việc,
 * phạm vi "Việc của tôi / Cả nhóm" (chỉ Quản lý/Quản trị), làm mới, chuyển dạng Kanban / Danh sách.
 */
import { Kanban, List, RotateCcw, Search } from 'lucide-react';
import type { DailyTaskScope } from '@crm/api';
import { BUTTON_OUTLINE_BASE_CLASS, CAPTION_CLASS, FILTER_INPUT_CLASS } from '@crm/lib/uiClasses';
import type { DailyTaskKind } from '@crm/types/crm';
import { TASK_KIND_LABELS, type TaskFilterState } from '../taskFilters';

export type TaskViewMode = 'kanban' | 'list';

interface Option {
  value: string;
  label: string;
}

const VIEW_MODE_OPTIONS: { value: TaskViewMode; label: string; icon: typeof Kanban }[] = [
  { value: 'kanban', label: 'Dạng cột Kanban', icon: Kanban },
  { value: 'list', label: 'Dạng danh sách', icon: List },
];

interface TaskToolbarProps {
  filters: TaskFilterState;
  onFiltersChange: (changes: Partial<TaskFilterState>) => void;
  onReset: () => void;
  projects: Option[];
  assignees: Option[];
  scope: DailyTaskScope;
  canSeeTeam: boolean;
  onScopeChange: (scope: DailyTaskScope) => void;
  viewMode: TaskViewMode;
  onViewModeChange: (viewMode: TaskViewMode) => void;
}

const SELECT_CLASS = `${FILTER_INPUT_CLASS} md:min-w-[150px] dark:[color-scheme:dark]`;

export const TaskToolbar = ({ filters, onFiltersChange, onReset, projects, assignees, scope, canSeeTeam, onScopeChange, viewMode, onViewModeChange }: TaskToolbarProps) => (
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
          placeholder="Tên khách (có/không dấu), SĐT, nội dung..."
          className={`${FILTER_INPUT_CLASS} w-full pl-10`}
        />
      </div>
    </div>

    {canSeeTeam && (
      <div className="flex flex-col gap-1.5">
        <label htmlFor="task-scope" className={CAPTION_CLASS}>
          Phạm vi
        </label>
        <select id="task-scope" value={scope} onChange={(event) => onScopeChange(event.target.value as DailyTaskScope)} className={SELECT_CLASS}>
          <option value="mine">Việc của tôi</option>
          <option value="team">Cả nhóm</option>
        </select>
      </div>
    )}

    <div className="flex flex-col gap-1.5">
      <label htmlFor="task-project" className={CAPTION_CLASS}>
        Dự án
      </label>
      <select id="task-project" value={filters.projectId} onChange={(event) => onFiltersChange({ projectId: event.target.value })} className={SELECT_CLASS}>
        <option value="all">Tất cả</option>
        {projects.map((project) => (
          <option key={project.value} value={project.value}>
            {project.label}
          </option>
        ))}
      </select>
    </div>

    {scope === 'team' && (
      <div className="flex flex-col gap-1.5">
        <label htmlFor="task-assignee" className={CAPTION_CLASS}>
          Người thực hiện
        </label>
        <select id="task-assignee" value={filters.assigneeId} onChange={(event) => onFiltersChange({ assigneeId: event.target.value })} className={SELECT_CLASS}>
          <option value="all">Tất cả</option>
          {assignees.map((assignee) => (
            <option key={assignee.value} value={assignee.value}>
              {assignee.label}
            </option>
          ))}
        </select>
      </div>
    )}

    <div className="flex flex-col gap-1.5">
      <label htmlFor="task-kind" className={CAPTION_CLASS}>
        Loại việc
      </label>
      <select id="task-kind" value={filters.kind} onChange={(event) => onFiltersChange({ kind: event.target.value as TaskFilterState['kind'] })} className={SELECT_CLASS}>
        <option value="all">Tất cả</option>
        {(Object.keys(TASK_KIND_LABELS) as DailyTaskKind[]).map((kind) => (
          <option key={kind} value={kind}>
            {TASK_KIND_LABELS[kind]}
          </option>
        ))}
      </select>
    </div>

    <div className="flex items-center gap-2">
      <button type="button" onClick={onReset} title="Làm mới bộ lọc" aria-label="Làm mới bộ lọc" className={`${BUTTON_OUTLINE_BASE_CLASS} h-10 w-10 shrink-0`}>
        <RotateCcw size={16} aria-hidden="true" />
      </button>
      <div role="radiogroup" aria-label="Kiểu hiển thị" className="flex h-10 items-center gap-0.5 rounded-lg border border-gray-200 bg-gray-100 p-0.5 dark:border-white/[0.05] dark:bg-gray-800">
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
                isActive ? 'bg-white text-brand-500 shadow-theme-xs dark:bg-gray-900 dark:text-brand-400' : 'text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-white/90'
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
