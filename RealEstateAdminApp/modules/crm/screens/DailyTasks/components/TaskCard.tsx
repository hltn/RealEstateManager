/**
 * Thẻ 1 việc (Admin Stitch `DailyTasksView` + Mobile `TodayTasksView`). Admin không có kanban/thẻ việc
 * (tài liệu 03 mục 10) → bố cục Stitch, token Admin:
 * - đầy đủ (quá hạn / hôm nay): tên + chip tình trạng, dự án, chip thời hạn, nội dung, gợi ý AI, 4 nút liên hệ;
 * - gọn (sắp tới): tên, dự án, ngày, nội dung 2 dòng, người phụ trách + "Chi tiết".
 */
import { Building, ChevronRight, Sparkles } from 'lucide-react';
import { ContactActionGrid } from '@crm/components/ContactActionGrid';
import { CustomerStatusChip } from '@crm/components/CustomerStatusChip';
import { AI_HINT_CLASS } from '@crm/lib/uiClasses';
import { useCrmActions, type TaskWithCustomer } from '@crm/store';
import { TASK_CATEGORY_META } from '../taskCategoryMeta';
import { TaskDueChip } from './TaskDueChip';

const CARD_BASE_CLASS = 'rounded-xl border bg-white p-4 dark:bg-white/[0.03]';

interface TaskCardProps {
  task: TaskWithCustomer;
  /** Lưới nút liên hệ 4 cột ở màn rất rộng (cột kanban web ≥ 1536px). */
  hasWideActions?: boolean;
}

export const TaskCard = ({ task, hasWideActions = false }: TaskCardProps) => {
  const { selectCustomer } = useCrmActions();
  const customerName = task.customer?.name ?? task.customerName;
  const customerStatus = task.customer?.status ?? task.statusTag;
  const meta = TASK_CATEGORY_META[task.category];
  const handleOpenDetail = () => selectCustomer(task.customerId);

  const nameButton = (
    <button
      type="button"
      onClick={handleOpenDetail}
      className="text-left text-theme-sm font-semibold text-gray-800 transition-colors hover:text-brand-500 dark:text-white/90 dark:hover:text-brand-400"
    >
      {customerName}
    </button>
  );

  const projectLine = (
    <p className="mt-1 flex min-w-0 items-center gap-1.5 text-theme-xs text-gray-500 dark:text-gray-400">
      <Building size={13} className="shrink-0" aria-hidden="true" />
      <span className="truncate">
        Dự án: <span className="font-medium text-gray-700 dark:text-gray-300">{task.projectName}</span>
      </span>
    </p>
  );

  if (task.category === 'upcoming') {
    return (
      <article className={`${CARD_BASE_CLASS} ${meta.cardBorderClass} space-y-2.5`}>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            {nameButton}
            {projectLine}
          </div>
          <TaskDueChip task={task} />
        </div>
        <p className="line-clamp-2 text-theme-xs leading-relaxed text-gray-600 dark:text-gray-400">{task.content}</p>
        <div className="flex items-center justify-between gap-2 border-t border-gray-100 pt-2.5 text-theme-xs dark:border-white/[0.05]">
          <span className="truncate text-gray-400 dark:text-gray-500">
            Phụ trách: <span className="font-medium text-gray-700 dark:text-gray-300">{task.assignee}</span>
          </span>
          <button
            type="button"
            onClick={handleOpenDetail}
            className="inline-flex shrink-0 items-center gap-0.5 font-medium text-brand-500 hover:text-brand-600 dark:text-brand-400"
          >
            Chi tiết
            <ChevronRight size={14} aria-hidden="true" />
          </button>
        </div>
      </article>
    );
  }

  return (
    <article className={`${CARD_BASE_CLASS} ${meta.cardBorderClass} space-y-3`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {nameButton}
            <CustomerStatusChip status={customerStatus} />
          </div>
          {projectLine}
        </div>
        <TaskDueChip task={task} />
      </div>

      <p className="rounded-lg border border-gray-200 bg-gray-50 p-2.5 text-theme-xs leading-relaxed text-gray-700 dark:border-white/[0.05] dark:bg-white/[0.03] dark:text-gray-300">
        {task.content}
      </p>

      {task.aiSuggestion && (
        <div className={AI_HINT_CLASS}>
          <Sparkles size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
          <p>
            <span className="font-semibold">Gợi ý STND AI: </span>
            <span className="text-gray-700 dark:text-gray-300">{task.aiSuggestion}</span>
          </p>
        </div>
      )}

      <ContactActionGrid customerId={task.customerId} className={hasWideActions ? '2xl:grid-cols-4' : ''} />
    </article>
  );
};
