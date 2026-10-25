/**
 * Dạng "Danh sách" của Việc hôm nay (web) — mẫu bảng Admin. Cột phụ ẩn ở màn hẹp; chật thì cuộn ngang trong vỏ.
 */
import type { DailyTask } from '@crm/api';
import { CustomerStatusChip } from '@crm/components/CustomerStatusChip';
import { TableContactActions } from '@crm/components/TableContactActions';
import { formatProjectSummary } from '@crm/lib/customerAdapters';
import { useCrmActions } from '@crm/store';
import { TASK_KIND_LABELS } from '../taskFilters';
import { TaskDoneButton, TaskDueChip } from './TaskCard';

const TASK_TABLE_COLUMNS: { label: string; className?: string; isRightAligned?: boolean }[] = [
  { label: 'Thời hạn' },
  { label: 'Khách hàng', className: 'min-w-[170px]' },
  { label: 'Tình trạng' },
  { label: 'Dự án', className: 'hidden 2xl:table-cell' },
  { label: 'Việc cần làm', className: 'min-w-[240px]' },
  { label: 'Thực hiện', className: 'hidden xl:table-cell' },
  { label: 'Thao tác', isRightAligned: true },
];

export const TaskListTable = ({ tasks }: { tasks: DailyTask[] }) => {
  const { selectCustomer } = useCrmActions();

  return (
    <div className="overflow-hidden rounded-2xl border border-gray-200 dark:border-white/[0.05]">
      <div className="custom-scrollbar overflow-x-auto">
        <table className="min-w-full">
          <thead className="border-b border-gray-100 dark:border-white/[0.05]">
            <tr className="bg-gray-50 dark:bg-gray-900">
              {TASK_TABLE_COLUMNS.map((column) => (
                <th
                  key={column.label}
                  scope="col"
                  className={`whitespace-nowrap px-5 py-3 text-theme-xs font-medium uppercase text-gray-500 dark:text-gray-400 ${column.isRightAligned ? 'text-right' : 'text-left'} ${column.className ?? ''}`}
                >
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-white/[0.05]">
            {tasks.map((task) => (
              <tr key={task.id} onClick={() => selectCustomer(task.customer.id)} className="cursor-pointer transition-colors hover:bg-gray-50 dark:hover:bg-white/[0.02]">
                <td className="px-5 py-4">
                  <TaskDueChip task={task} />
                </td>
                <td className="px-5 py-4">
                  <p className="text-theme-sm font-medium text-gray-800 dark:text-white/90">{task.customer.fullName}</p>
                  {task.customer.phoneMasked && <p className="text-theme-xs text-gray-500 dark:text-gray-400">{task.customer.phoneMasked}</p>}
                </td>
                <td className="px-5 py-4">
                  <CustomerStatusChip status={task.customer.status} />
                </td>
                <td className="hidden px-5 py-4 text-theme-sm text-gray-700 2xl:table-cell dark:text-gray-300">{task.project ? `Dự án: ${task.project.label}` : formatProjectSummary(task.customer.projects) || '—'}</td>
                <td className="px-5 py-4">
                  <p className="text-theme-xs text-gray-500 dark:text-gray-400">{TASK_KIND_LABELS[task.kind]}</p>
                  <p className="line-clamp-2 text-theme-sm text-gray-700 dark:text-gray-300">{task.title}</p>
                  <TaskDoneButton task={task} />
                </td>
                <td className="hidden whitespace-nowrap px-5 py-4 text-theme-sm text-gray-700 xl:table-cell dark:text-gray-300">{task.assignee?.displayName ?? '—'}</td>
                <td className="px-5 py-4">
                  <TableContactActions customerId={task.customer.id} customerName={task.customer.fullName} />
                </td>
              </tr>
            ))}
            {tasks.length === 0 && (
              <tr>
                <td colSpan={TASK_TABLE_COLUMNS.length} className="px-5 py-16 text-center text-theme-sm text-gray-500 dark:text-gray-400">
                  Không có việc phù hợp với bộ lọc hiện tại.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
