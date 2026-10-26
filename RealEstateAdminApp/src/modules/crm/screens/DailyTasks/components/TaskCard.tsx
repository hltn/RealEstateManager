/**
 * Thẻ 1 việc (02 §4.1): tên khách + tình trạng, dự án, thời hạn (tính theo ngày thực), việc cần làm,
 * lần liên hệ gần nhất, gợi ý bước tiếp theo (CHỈ khi có dữ liệu thật) và nút hành động.
 * Việc "Bước tiếp theo" có nút "Đã xong"; việc "Lịch hẹn" có nút "Hoàn thành".
 */
import { Building, CircleCheck, Clock, Lightbulb } from 'lucide-react';
import { useState } from 'react';
import { useCrmApi, type DailyTask } from '@crm/api';
import { ContactActionGrid } from '@crm/components/ContactActionGrid';
import { CustomerStatusChip } from '@crm/components/CustomerStatusChip';
import { formatProjectSummary } from '@crm/lib/customerAdapters';
import { formatVnRelative } from '@crm/lib/dateTime';
import { NEXT_STEP_HINT_CLASS, CHIP_SMALL_CLASS, CHIP_TONE_CLASS } from '@crm/lib/uiClasses';
import { useCrmActions } from '@crm/store';
import { TASK_CATEGORY_META } from '../taskCategoryMeta';
import { getTaskDueText, TASK_KIND_LABELS } from '../taskFilters';

const CARD_BASE_CLASS = 'rounded-xl border bg-white p-4 dark:bg-white/[0.03]';

export const TaskDueChip = ({ task }: { task: DailyTask }) => (
  <span className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${TASK_CATEGORY_META[task.group].dueChipClass}`}>
    {task.group === 'TODAY' && <Clock size={12} aria-hidden="true" />}
    {getTaskDueText(task)}
  </span>
);

/**
 * Nút xử lý việc: lịch hẹn -> "Hoàn thành" (`PATCH appointments/:id/status`); bước tiếp theo -> "Ghi nhật ký" (mở ghi chú nhanh;
 * việc tự hết khi có nhật ký mới hơn — backend không có thao tác "đã xong" riêng). Việc khác (dịp, lâu chưa chăm sóc) tự hết theo ngày/nhật ký.
 */
export const TaskDoneButton = ({ task }: { task: DailyTask }) => {
  const api = useCrmApi();
  const { showToast, openQuickNote } = useCrmActions();
  const [isBusy, setIsBusy] = useState(false);
  if (task.kind !== 'FOLLOW_UP' && task.kind !== 'APPOINTMENT') return null;
  const complete = async () => {
    if (task.kind === 'FOLLOW_UP') {
      openQuickNote(task.customer.id);
      return;
    }
    if (!task.appointmentId || isBusy) return;
    setIsBusy(true);
    const result = await api.updateAppointmentStatus(task.appointmentId, 'DONE');
    setIsBusy(false);
    showToast(result.ok ? { title: 'Đã hoàn thành lịch hẹn' } : { type: 'error', title: result.error.message });
  };
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        void complete();
      }}
      disabled={isBusy}
      className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-success-600 transition-colors hover:bg-success-50 dark:text-success-500 dark:hover:bg-success-500/10"
    >
      <CircleCheck size={14} aria-hidden="true" />
      {task.kind === 'FOLLOW_UP' ? 'Ghi nhật ký' : 'Hoàn thành'}
    </button>
  );
};

interface TaskCardProps {
  task: DailyTask;
}

export const TaskCard = ({ task }: TaskCardProps) => {
  const { selectCustomer } = useCrmActions();
  const meta = TASK_CATEGORY_META[task.group];
  // Việc lịch hẹn có dự án: hiện dự án của buổi hẹn (nhãn rõ); không thì dự án khách quan tâm.
  const projectSummary = task.project ? `Dự án: ${task.project.label}` : formatProjectSummary(task.customer.projects);

  return (
    <article data-testid="daily-task-card" className={`${CARD_BASE_CLASS} ${meta.cardBorderClass} space-y-3`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <button
              type="button"
              onClick={() => selectCustomer(task.customer.id)}
              className="text-left text-theme-sm font-semibold text-gray-800 transition-colors hover:text-brand-500 dark:text-white/90 dark:hover:text-brand-400"
            >
              {task.customer.fullName}
            </button>
            <CustomerStatusChip status={task.customer.status} size="small" />
          </div>
          {projectSummary && (
            <p className="mt-1 flex min-w-0 items-center gap-1.5 text-theme-xs text-gray-500 dark:text-gray-400">
              <Building size={13} className="shrink-0" aria-hidden="true" />
              <span className="truncate">{projectSummary}</span>
            </p>
          )}
        </div>
        <TaskDueChip task={task} />
      </div>

      <div className="rounded-lg border border-gray-200 bg-gray-50 p-2.5 dark:border-white/[0.05] dark:bg-white/[0.03]">
        <p className="flex flex-wrap items-center gap-1.5 text-theme-xs text-gray-700 dark:text-gray-300">
          <span className={`${CHIP_SMALL_CLASS} ${CHIP_TONE_CLASS.gray}`}>{TASK_KIND_LABELS[task.kind]}</span>
          <span className="font-medium">{task.title}</span>
        </p>
        {task.lastCareLog && (
          <p className="mt-1.5 line-clamp-2 text-theme-xs text-gray-500 dark:text-gray-400">
            Gần nhất ({formatVnRelative(task.lastCareLog.occurredAt)}): {task.lastCareLog.excerpt}
          </p>
        )}
      </div>

      {task.suggestion && task.suggestion !== task.title && (
        <div className={NEXT_STEP_HINT_CLASS}>
          <Lightbulb size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
          <p>
            <span className="font-semibold">Gợi ý tiếp theo: </span>
            <span className="text-gray-700 dark:text-gray-300">{task.suggestion}</span>
          </p>
        </div>
      )}

      <div className="flex items-center justify-between gap-2 text-theme-xs text-gray-500 dark:text-gray-400">
        <span>
          Thực hiện: <span className="font-medium text-gray-700 dark:text-gray-300">{task.assignee?.displayName ?? '—'}</span>
          {task.isPrimary && ' (phụ trách chính)'}
        </span>
        <TaskDoneButton task={task} />
      </div>

      <ContactActionGrid customerId={task.customer.id} />
    </article>
  );
};
