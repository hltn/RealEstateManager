/**
 * Bộ lọc cục bộ + hiển thị của màn "Việc hôm nay" — hàm thuần.
 * Việc được TÍNH ở lớp dữ liệu (`GET /crm/daily-tasks`); ở đây chỉ lọc thêm theo từ khoá/dự án/loại/người thực hiện.
 */
import type { DailyTask } from '@crm/api';
import { diffDateKeys, formatVnDate, formatVnRelative, getVnTodayKey, toVnDateKey, toVnTime } from '@crm/lib/dateTime';
import type { DailyTaskGroup, DailyTaskKind } from '@crm/types/crm';

export const TASK_KIND_LABELS: Record<DailyTaskKind, string> = {
  APPOINTMENT: 'Lịch hẹn',
  FOLLOW_UP: 'Bước tiếp theo',
  OCCASION: 'Dịp đặc biệt',
  STALE_CUSTOMER: 'Lâu chưa chăm sóc',
};

export interface TaskFilterState {
  search: string;
  /** 'all' hoặc id dự án. */
  projectId: string;
  /** 'all' hoặc id người thực hiện. */
  assigneeId: string;
  kind: 'all' | DailyTaskKind;
}

export const DEFAULT_TASK_FILTERS: TaskFilterState = { search: '', projectId: 'all', assigneeId: 'all', kind: 'all' };

/**
 * Khớp dự án: việc lịch hẹn có dự án riêng thì chỉ khớp theo dự án của lịch; các việc còn lại khớp theo dự án khách quan tâm.
 */
const matchesTaskProject = (task: DailyTask, projectId: string): boolean =>
  task.project ? task.project.id === projectId : task.customer.projects.some((project) => project.id === projectId);

/**
 * Lọc cục bộ theo dự án, người thực hiện, loại việc. Từ khoá `search` (tên/nội dung/SĐT) được xử lý ở LỚP DỮ LIỆU
 * (`useDailyTasks({ q })`), không lọc lại ở đây để số điện thoại không phải đi kèm trong payload.
 */
export const matchesTaskFilter = (task: DailyTask, filters: TaskFilterState): boolean => {
  if (filters.projectId !== 'all' && !matchesTaskProject(task, filters.projectId)) return false;
  if (filters.assigneeId !== 'all' && task.assignee?.id !== filters.assigneeId) return false;
  if (filters.kind !== 'all' && task.kind !== filters.kind) return false;
  return true;
};

export const groupTasks = (tasks: readonly DailyTask[]): Record<DailyTaskGroup, DailyTask[]> => ({
  OVERDUE: tasks.filter((task) => task.group === 'OVERDUE'),
  TODAY: tasks.filter((task) => task.group === 'TODAY'),
  UPCOMING: tasks.filter((task) => task.group === 'UPCOMING'),
});

/** Chữ thời hạn theo ngày thực: "Trễ 2 ngày" / "Hôm nay 15:30" / "Ngày mai 09:00" / "28/10/2026". */
export const getTaskDueText = (task: Pick<DailyTask, 'group' | 'dueAt' | 'kind'>, now: Date = new Date()): string => {
  if (task.group === 'OVERDUE') {
    const days = diffDateKeys(toVnDateKey(task.dueAt), getVnTodayKey(now));
    return `Trễ ${days} ngày`;
  }
  if (task.kind === 'STALE_CUSTOMER') return 'Cần liên hệ';
  if (task.group === 'TODAY') return task.kind === 'OCCASION' ? 'Hôm nay' : `Hôm nay ${toVnTime(task.dueAt)}`;
  const relative = formatVnRelative(task.dueAt, now, task.kind !== 'OCCASION');
  return relative.startsWith('Ngày mai') ? relative : task.kind === 'OCCASION' ? formatVnDate(task.dueAt) : relative;
};
