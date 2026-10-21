/**
 * Bộ lọc cục bộ của màn "Việc hôm nay" (thanh lọc bản web) - hàm thuần.
 * Không đưa vào store vì FilterOptions chỉ mô tả bộ lọc khách hàng.
 */
import type { TaskGroups, TaskWithCustomer } from '@crm/store';
import type { DailyTask } from '@crm/types/crm';

export type TaskPriorityFilter = 'all' | 'overdue' | 'today' | 'vip';

export interface TaskFilterState {
  search: string;
  /** 'all' hoặc tên dự án. */
  project: string;
  /** 'all' hoặc tên người phụ trách (`DailyTask.assignee`). */
  assignee: string;
  priority: TaskPriorityFilter;
}

export const DEFAULT_TASK_FILTERS: TaskFilterState = {
  search: '',
  project: 'all',
  assignee: 'all',
  priority: 'all',
};

export const TASK_PRIORITY_OPTIONS: { value: TaskPriorityFilter; label: string }[] = [
  { value: 'all', label: 'Mức ưu tiên: Tất cả' },
  { value: 'overdue', label: 'Khẩn cấp (Quá hạn)' },
  { value: 'today', label: 'Hôm nay' },
  { value: 'vip', label: 'Khách VIP / Net' },
];

const normalizeText = (value: string): string => value.trim().toLowerCase();
const digitsOnly = (value: string): string => value.replace(/\D/g, '');

/** Logic `matchesFilter` của Admin DailyTasksView: từ khoá -> dự án -> người phụ trách -> mức ưu tiên. */
export const matchesTaskFilter = (task: DailyTask, filters: TaskFilterState): boolean => {
  const keyword = normalizeText(filters.search);
  if (keyword) {
    const keywordDigits = digitsOnly(keyword);
    const isKeywordMatch =
      normalizeText(task.customerName).includes(keyword) ||
      (keywordDigits.length > 0 && digitsOnly(task.customerPhone).includes(keywordDigits)) ||
      normalizeText(task.projectName).includes(keyword) ||
      normalizeText(task.content).includes(keyword);
    if (!isKeywordMatch) return false;
  }

  if (filters.project !== 'all' && !normalizeText(task.projectName).includes(normalizeText(filters.project))) return false;
  if (filters.assignee !== 'all' && !normalizeText(task.assignee).includes(normalizeText(filters.assignee))) return false;

  if (filters.priority === 'overdue' && task.category !== 'overdue') return false;
  if (filters.priority === 'today' && task.category !== 'today') return false;
  if (filters.priority === 'vip' && task.statusTag !== 'Khách net') return false;
  return true;
};

const filterGroup = (tasks: TaskWithCustomer[], filters: TaskFilterState) =>
  tasks.filter((task) => matchesTaskFilter(task, filters));

/** Áp bộ lọc lên cả 3 nhóm Quá hạn / Hôm nay / Sắp tới. */
export const filterTaskGroups = (groups: TaskGroups, filters: TaskFilterState): TaskGroups => ({
  overdue: filterGroup(groups.overdue, filters),
  today: filterGroup(groups.today, filters),
  upcoming: filterGroup(groups.upcoming, filters),
});

/** Danh sách người phụ trách duy nhất (theo thứ tự xuất hiện) cho dropdown lọc. */
export const getTaskAssignees = (tasks: DailyTask[]): string[] => [...new Set(tasks.map((task) => task.assignee))];
