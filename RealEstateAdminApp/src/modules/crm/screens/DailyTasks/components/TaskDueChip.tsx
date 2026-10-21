/** Chip thời hạn của 1 việc: "Trễ 2 ngày" (quá hạn) / giờ hẹn (hôm nay) / ngày (sắp tới). */
import { Clock } from 'lucide-react';
import type { DailyTask } from '@crm/types/crm';
import { TASK_CATEGORY_META } from '../taskCategoryMeta';

/** Chữ thời hạn hiển thị theo nhóm việc (fallback như Admin Stitch). */
export const getTaskDueText = (task: DailyTask): string => {
  if (task.category === 'overdue') return task.overdueText || 'Trễ hạn';
  if (task.category === 'today') return task.timeText || 'Hôm nay';
  return task.dateText || 'Sắp tới';
};

interface TaskDueChipProps {
  task: DailyTask;
}

export const TaskDueChip = ({ task }: TaskDueChipProps) => (
  <span
    className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${
      TASK_CATEGORY_META[task.category].dueChipClass
    }`}
  >
    {task.category === 'today' && <Clock size={12} aria-hidden="true" />}
    {getTaskDueText(task)}
  </span>
);
