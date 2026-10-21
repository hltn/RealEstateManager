/**
 * 1 cột kanban (web) — Admin không có kanban (tài liệu 03 mục 10: "Kanban 3 cột … Làm mới") → bố cục
 * Stitch (`DailyTasksView`: nền xám nhạt, viền theo nhóm, tiêu đề chữ hoa + số đếm + icon), token Admin.
 * Tablet (768–1279px): cột chiếm hết chiều ngang, thẻ xếp 2 cột; ≥ 1280px: 3 cột cạnh nhau, thẻ xếp dọc.
 */
import type { ReactNode } from 'react';
import type { TaskWithCustomer } from '@crm/store';
import type { TaskCategory } from '@crm/types/crm';
import { TASK_CATEGORY_META } from '../taskCategoryMeta';
import { TaskCard } from './TaskCard';

interface TaskKanbanColumnProps {
  category: TaskCategory;
  tasks: TaskWithCustomer[];
  /** Nội dung thêm ở cuối cột (vd nút "Xem thêm"). */
  footer?: ReactNode;
}

export const TaskKanbanColumn = ({ category, tasks, footer }: TaskKanbanColumnProps) => {
  const meta = TASK_CATEGORY_META[category];
  const Icon = meta.icon;
  const headingId = `task-column-${category}`;

  return (
    <section
      aria-labelledby={headingId}
      className={`flex flex-col gap-4 rounded-2xl border bg-gray-100/60 p-4 dark:bg-white/[0.02] ${meta.columnBorderClass}`}
    >
      <header className="flex items-center justify-between border-b border-gray-200 pb-3 dark:border-white/[0.05]">
        <h3 id={headingId} className={`flex items-center gap-2 text-theme-xs font-semibold uppercase tracking-wider ${meta.titleClass}`}>
          <span aria-hidden="true" className={`h-2.5 w-2.5 rounded-full ${meta.dotClass}`} />
          {meta.label} ({tasks.length})
        </h3>
        <Icon size={18} className={meta.titleClass} aria-hidden="true" />
      </header>

      {tasks.length > 0 ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-1">
          {tasks.map((task) => (
            <TaskCard key={task.id} task={task} hasWideActions />
          ))}
        </div>
      ) : (
        <p className="rounded-xl border border-dashed border-gray-300 p-5 text-center text-theme-xs text-gray-500 dark:border-white/[0.1] dark:text-gray-400">
          Không có việc phù hợp với bộ lọc.
        </p>
      )}

      {footer}
    </section>
  );
};
