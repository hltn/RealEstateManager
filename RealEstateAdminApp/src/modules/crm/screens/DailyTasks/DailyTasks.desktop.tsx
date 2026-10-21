// Port từ stnd-admin-real-estate-manager-crm-oct-16-2026-1-51-45-pm/src/components/DailyTasksView.tsx
// Phong cách Admin: đầu trang có nút, tab module (`CrmModuleTabs`, thay thanh tab tự vẽ + số cứng của Stitch),
// thanh lọc kiểu ExternalLogs; kanban 3 cột vẽ theo Stitch bằng token Admin; dạng danh sách = bảng Admin.
// Dữ liệu: useTaskGroups() (việc + hồ sơ khách); bộ lọc cục bộ (taskFilters.ts); liên hệ qua useContactActions.
import { useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import { CrmModuleTabs } from '@crm/components/CrmModuleTabs';
import { BUTTON_PRIMARY_CLASS, PAGE_DESCRIPTION_CLASS, PAGE_TITLE_CLASS } from '@crm/lib/uiClasses';
import { useCrmActions, useCrmState, useTaskGroups } from '@crm/store';
import { TaskKanbanColumn } from './components/TaskKanbanColumn';
import { TaskListTable } from './components/TaskListTable';
import { TaskToolbar, type TaskViewMode } from './components/TaskToolbar';
import { TASK_CATEGORY_META, TASK_CATEGORY_ORDER } from './taskCategoryMeta';
import { DEFAULT_TASK_FILTERS, filterTaskGroups, getTaskAssignees, type TaskFilterState } from './taskFilters';

export const DailyTasksDesktop = () => {
  const { tasks } = useCrmState();
  const taskGroups = useTaskGroups();
  const { navigate, showToast } = useCrmActions();
  const [filters, setFilters] = useState<TaskFilterState>(DEFAULT_TASK_FILTERS);
  const [viewMode, setViewMode] = useState<TaskViewMode>('kanban');

  const filteredGroups = useMemo(() => filterTaskGroups(taskGroups, filters), [taskGroups, filters]);
  const assignees = useMemo(() => getTaskAssignees(tasks), [tasks]);
  const filteredTaskList = TASK_CATEGORY_ORDER.flatMap((category) => filteredGroups[category]);

  return (
    <div className="flex w-full flex-col gap-6">
      {/* Đầu trang: tiêu đề + bộ đếm theo nhóm + nút chính, rồi tab module */}
      <div className="flex flex-col gap-4">
        <header className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div className="flex flex-col gap-2">
            <h2 className={PAGE_TITLE_CLASS}>Việc hôm nay</h2>
            <p className={`${PAGE_DESCRIPTION_CLASS} max-w-2xl`}>
              Theo dõi nhiệm vụ cần xử lý, nhắc hẹn và gợi ý hành động từ STND AI.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <dl className="flex items-center divide-x divide-gray-200 rounded-xl border border-gray-200 bg-white py-1.5 dark:divide-white/[0.05] dark:border-white/[0.05] dark:bg-white/[0.03]">
              {TASK_CATEGORY_ORDER.map((category) => {
                const meta = TASK_CATEGORY_META[category];
                return (
                  <div key={category} className="flex items-center gap-1.5 px-3 text-theme-xs">
                    <span aria-hidden="true" className={`h-2 w-2 rounded-full ${meta.dotClass}`} />
                    <dt className="text-gray-500 dark:text-gray-400">{meta.label}:</dt>
                    <dd className={`font-semibold ${meta.titleClass}`}>{taskGroups[category].length}</dd>
                  </div>
                );
              })}
            </dl>
            <button type="button" onClick={() => navigate('create_customer')} className={BUTTON_PRIMARY_CLASS}>
              <Plus size={18} aria-hidden="true" />
              Thêm khách
            </button>
          </div>
        </header>
        <CrmModuleTabs />
      </div>

      <TaskToolbar
        filters={filters}
        onFiltersChange={(changes) => setFilters((current) => ({ ...current, ...changes }))}
        onReset={() => setFilters(DEFAULT_TASK_FILTERS)}
        assignees={assignees}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
      />

      {viewMode === 'kanban' ? (
        <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-3">
          {TASK_CATEGORY_ORDER.map((category) => (
            <TaskKanbanColumn
              key={category}
              category={category}
              tasks={filteredGroups[category]}
              footer={
                category === 'upcoming' && (
                  <button
                    type="button"
                    onClick={() =>
                      showToast({ title: 'Đang tải thêm nhiệm vụ tuần tới...', message: 'Dữ liệu mẫu: chưa có thêm nhiệm vụ.', type: 'info' })
                    }
                    className="w-full rounded-lg border border-dashed border-gray-300 bg-white px-3 py-2 text-theme-xs font-medium text-gray-600 transition-colors hover:border-brand-500 hover:text-brand-500 dark:border-white/[0.1] dark:bg-transparent dark:text-gray-400 dark:hover:border-brand-500 dark:hover:text-brand-400"
                  >
                    + Xem thêm nhiệm vụ tuần này
                  </button>
                )
              }
            />
          ))}
        </div>
      ) : (
        <TaskListTable tasks={filteredTaskList} />
      )}
    </div>
  );
};

export default DailyTasksDesktop;
