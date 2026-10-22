// "Việc hôm nay" (web, 02 §4.1): nhóm Quá hạn → Hôm nay → Sắp tới, tính theo NGÀY THỰC (giờ VN) ở lớp dữ liệu.
// Kanban 3 cột (Stitch, token Admin) hoặc bảng Admin; bộ lọc cục bộ.
import { useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import { useCatalogs, useCrmActor, useDailyTasks, type DailyTaskScope } from '@crm/api';
import { CrmModuleTabs } from '@crm/components/CrmModuleTabs';
import { BUTTON_PRIMARY_CLASS, PAGE_DESCRIPTION_CLASS, PAGE_TITLE_CLASS } from '@crm/lib/uiClasses';
import { useCrmActions } from '@crm/store';
import { TaskKanbanColumn } from './components/TaskKanbanColumn';
import { TaskListTable } from './components/TaskListTable';
import { TaskToolbar, type TaskViewMode } from './components/TaskToolbar';
import { TASK_CATEGORY_META, TASK_CATEGORY_ORDER } from './taskCategoryMeta';
import { DEFAULT_TASK_FILTERS, groupTasks, matchesTaskFilter, type TaskFilterState } from './taskFilters';

export const DailyTasksDesktop = () => {
  const actor = useCrmActor();
  const canSeeTeam = actor.role === 'ADMIN' || actor.role === 'MANAGER';
  const [scope, setScope] = useState<DailyTaskScope>('mine');
  const { data: tasks } = useDailyTasks({ scope });
  const { catalogs, users } = useCatalogs();
  const { navigate } = useCrmActions();
  const [filters, setFilters] = useState<TaskFilterState>(DEFAULT_TASK_FILTERS);
  const [viewMode, setViewMode] = useState<TaskViewMode>('kanban');

  const filteredTasks = useMemo(() => tasks.filter((task) => matchesTaskFilter(task, filters)), [tasks, filters]);
  const groups = groupTasks(filteredTasks);
  const allGroups = groupTasks(tasks);

  return (
    <div className="flex w-full flex-col gap-6">
      <div className="flex flex-col gap-4">
        <header className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div className="flex flex-col gap-2">
            <h2 className={PAGE_TITLE_CLASS}>Việc hôm nay</h2>
            <p className={`${PAGE_DESCRIPTION_CLASS} max-w-2xl`}>Lịch hẹn, bước chăm sóc tiếp theo, dịp đặc biệt và khách lâu chưa chăm sóc.</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <dl className="flex items-center divide-x divide-gray-200 rounded-xl border border-gray-200 bg-white py-1.5 dark:divide-white/[0.05] dark:border-white/[0.05] dark:bg-white/[0.03]">
              {TASK_CATEGORY_ORDER.map((category) => (
                <div key={category} className="flex items-center gap-1.5 px-3 text-theme-xs">
                  <span aria-hidden="true" className={`h-2 w-2 rounded-full ${TASK_CATEGORY_META[category].dotClass}`} />
                  <dt className="text-gray-500 dark:text-gray-400">{TASK_CATEGORY_META[category].label}:</dt>
                  <dd className={`font-semibold ${TASK_CATEGORY_META[category].titleClass}`}>{allGroups[category].length}</dd>
                </div>
              ))}
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
        projects={catalogs.projects.filter((project) => project.isActive).map((project) => ({ value: project.id, label: project.name }))}
        assignees={users.filter((user) => user.isActive && user.role !== 'ADMIN').map((user) => ({ value: user.id, label: user.fullName }))}
        scope={scope}
        canSeeTeam={canSeeTeam}
        onScopeChange={setScope}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
      />

      {viewMode === 'kanban' ? (
        <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-3">
          {TASK_CATEGORY_ORDER.map((category) => (
            <TaskKanbanColumn key={category} category={category} tasks={groups[category]} />
          ))}
        </div>
      ) : (
        <TaskListTable tasks={filteredTasks} />
      )}
    </div>
  );
};

export default DailyTasksDesktop;
