/**
 * Dạng "Danh sách" của Việc hôm nay (web). Stitch có nút chuyển nhưng chưa vẽ dạng này → dùng mẫu bảng Admin
 * (tài liệu 03 mục 5: vỏ `rounded-2xl border`, thead gray-50/gray-900, `th.text-theme-xs uppercase`, dòng bấm được).
 * Ẩn cột phụ ở màn hẹp: "Dự án" < 1536px (hiện dưới tên), "Phụ trách" < 1280px; còn chật thì cuộn ngang trong vỏ.
 */
import { CustomerStatusChip } from '@crm/components/CustomerStatusChip';
import { TableContactActions } from '@crm/components/TableContactActions';
import { useCrmActions, type TaskWithCustomer } from '@crm/store';
import { TaskDueChip } from './TaskDueChip';

const TASK_TABLE_COLUMNS: { label: string; className?: string; isRightAligned?: boolean }[] = [
  { label: 'Thời hạn' },
  { label: 'Khách hàng', className: 'min-w-[170px]' },
  { label: 'Tình trạng' },
  { label: 'Dự án', className: 'hidden 2xl:table-cell' },
  { label: 'Việc cần làm', className: 'min-w-[240px]' },
  { label: 'Phụ trách', className: 'hidden xl:table-cell' },
  { label: 'Thao tác', isRightAligned: true },
];

interface TaskListTableProps {
  tasks: TaskWithCustomer[];
}

export const TaskListTable = ({ tasks }: TaskListTableProps) => {
  const { selectCustomer } = useCrmActions();

  return (
    <div className="overflow-hidden rounded-2xl border border-gray-200 dark:border-white/[0.05]">
      <div className="overflow-x-auto custom-scrollbar">
        <table className="min-w-full">
          <thead className="border-b border-gray-100 dark:border-white/[0.05]">
            <tr className="bg-gray-50 dark:bg-gray-900">
              {TASK_TABLE_COLUMNS.map((column) => (
                <th
                  key={column.label}
                  scope="col"
                  className={`whitespace-nowrap px-5 py-3 text-theme-xs font-medium uppercase text-gray-500 dark:text-gray-400 ${
                    column.isRightAligned ? 'text-right' : 'text-left'
                  } ${column.className ?? ''}`}
                >
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-white/[0.05]">
            {tasks.map((task) => {
              const customerName = task.customer?.name ?? task.customerName;
              return (
                <tr
                  key={task.id}
                  onClick={() => selectCustomer(task.customerId)}
                  className="cursor-pointer transition-colors hover:bg-gray-50 dark:hover:bg-white/[0.02]"
                >
                  <td className="px-5 py-4">
                    <TaskDueChip task={task} />
                  </td>
                  <td className="px-5 py-4">
                    <p className="text-theme-sm font-medium text-gray-800 dark:text-white/90">{customerName}</p>
                    <p className="text-theme-xs text-gray-500 dark:text-gray-400">{task.customerPhone}</p>
                    <p className="text-theme-xs text-gray-500 2xl:hidden dark:text-gray-400">{task.projectName}</p>
                  </td>
                  <td className="px-5 py-4">
                    <CustomerStatusChip status={task.customer?.status ?? task.statusTag} />
                  </td>
                  <td className="hidden px-5 py-4 text-theme-sm text-gray-700 2xl:table-cell dark:text-gray-300">{task.projectName}</td>
                  <td className="px-5 py-4">
                    <p className="line-clamp-2 text-theme-sm text-gray-700 dark:text-gray-300">{task.content}</p>
                  </td>
                  <td className="hidden whitespace-nowrap px-5 py-4 text-theme-sm text-gray-700 xl:table-cell dark:text-gray-300">
                    {task.assignee}
                  </td>
                  <td className="px-5 py-4">
                    <TableContactActions customerId={task.customerId} customerName={customerName} />
                  </td>
                </tr>
              );
            })}
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
