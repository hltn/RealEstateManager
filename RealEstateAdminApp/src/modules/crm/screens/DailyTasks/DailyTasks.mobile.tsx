// Port từ stnd-real-estate-crm-oct-15-2026-4-14-56-pm/src/views/TodayTasksView.tsx
// Khung mobile là của Admin (AppHeader + drawer, vùng nội dung đã có `p-4`) + CrmBottomNav của CrmLayout:
// không vẽ top app bar, không padding ngang thêm, không ModuleNavTabs (thanh đáy đã có 4 tab).
// Viên thuốc lọc + mục Quá hạn / Hôm nay / Sắp tới vẽ theo Stitch bằng token Admin.
// Dữ liệu: `useDailyTasks()` — việc tính theo ngày thực (giờ VN) ở lớp dữ liệu.
import { useState } from 'react';
import { Plus } from 'lucide-react';
import { BUTTON_PRIMARY_CLASS, PAGE_DESCRIPTION_CLASS, PAGE_TITLE_MOBILE_CLASS } from '@crm/lib/uiClasses';
import { useDailyTasks } from '@crm/api';
import { useCrmActions } from '@crm/store';
import type { DailyTaskGroup } from '@crm/types/crm';
import { TaskCard } from './components/TaskCard';
import { TASK_CATEGORY_META, TASK_CATEGORY_ORDER } from './taskCategoryMeta';
import { groupTasks } from './taskFilters';

type CategoryFilter = 'all' | DailyTaskGroup;

const PILL_BASE_CLASS =
  'inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-medium transition-colors active:scale-95';

export const DailyTasksMobile = () => {
  const { data: tasks } = useDailyTasks();
  const taskGroups = groupTasks(tasks);
  const { navigate } = useCrmActions();
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('all');
  const visibleCategories = TASK_CATEGORY_ORDER.filter(
    (category) => categoryFilter === 'all' || categoryFilter === category,
  );

  return (
    <div className="flex w-full flex-col gap-4">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className={PAGE_TITLE_MOBILE_CLASS}>Việc hôm nay</h2>
          <p className={`${PAGE_DESCRIPTION_CLASS} mt-0.5`}>Lịch hẹn, bước tiếp theo và nhắc chăm sóc khách.</p>
        </div>
        <button type="button" onClick={() => navigate('create_customer')} className={`${BUTTON_PRIMARY_CLASS} h-10 shrink-0`}>
          <Plus size={18} aria-hidden="true" />
          Thêm khách
        </button>
      </header>

      {/* Viên thuốc đếm theo nhóm — bấm để chỉ xem 1 nhóm, bấm lại để xem tất cả */}
      <div role="group" aria-label="Lọc theo nhóm việc" className="flex items-center gap-2 overflow-x-auto no-scrollbar">
        {TASK_CATEGORY_ORDER.map((category) => {
          const meta = TASK_CATEGORY_META[category];
          const isActive = categoryFilter === category;
          return (
            <button
              key={category}
              type="button"
              aria-pressed={isActive}
              onClick={() => setCategoryFilter(isActive ? 'all' : category)}
              className={`${PILL_BASE_CLASS} ${isActive ? meta.pillActiveClass : meta.pillIdleClass}`}
            >
              <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${isActive ? 'bg-current' : meta.dotClass}`} />
              {meta.label}: {taskGroups[category].length}
            </button>
          );
        })}
      </div>

      {visibleCategories.map((category) => {
        const meta = TASK_CATEGORY_META[category];
        const Icon = meta.icon;
        const categoryTasks = taskGroups[category];
        const headingId = `mobile-task-section-${category}`;
        return (
          <section key={category} aria-labelledby={headingId} className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <h3 id={headingId} className={`flex items-center gap-1.5 text-theme-xs font-semibold uppercase tracking-wider ${meta.titleClass}`}>
                <Icon size={16} aria-hidden="true" />
                {meta.label} ({categoryTasks.length})
              </h3>
              <span className="text-theme-xs text-gray-400 dark:text-gray-500">{meta.hint}</span>
            </div>
            {categoryTasks.length > 0 ? (
              categoryTasks.map((task) => <TaskCard key={task.id} task={task} />)
            ) : (
              <p className="rounded-2xl border border-dashed border-gray-200 p-5 text-center text-theme-xs text-gray-500 dark:border-white/[0.1] dark:text-gray-400">
                Không có việc trong nhóm này.
              </p>
            )}
          </section>
        );
      })}
    </div>
  );
};

export default DailyTasksMobile;
