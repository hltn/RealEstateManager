/**
 * Cấu hình hiển thị 3 nhóm việc Quá hạn / Hôm nay / Sắp tới (cột kanban web, mục danh sách app,
 * chip đếm, chip thời hạn). Màu theo token Admin, đủ cặp `dark:`:
 * quá hạn = error, hôm nay = brand, sắp tới = gray (thay rose/amber/gray của Stitch).
 */
import { CalendarCheck, CalendarDays, TriangleAlert, type LucideIcon } from 'lucide-react';
import type { TaskCategory } from '@crm/types/crm';

export interface TaskCategoryMeta {
  label: string;
  /** Dòng phụ cạnh tiêu đề mục trên app. */
  hint: string;
  icon: LucideIcon;
  /** Chấm màu (chip đếm, tiêu đề cột). */
  dotClass: string;
  /** Màu chữ tiêu đề cột / mục. */
  titleClass: string;
  /** Viền cột kanban. */
  columnBorderClass: string;
  /** Viền thẻ việc trong cột. */
  cardBorderClass: string;
  /** Chip thời hạn (Trễ x ngày / giờ hẹn / ngày). */
  dueChipClass: string;
  /** Viên thuốc lọc trên app: thường / đang chọn. */
  pillIdleClass: string;
  pillActiveClass: string;
}

export const TASK_CATEGORY_ORDER: TaskCategory[] = ['overdue', 'today', 'upcoming'];

export const TASK_CATEGORY_META: Record<TaskCategory, TaskCategoryMeta> = {
  overdue: {
    label: 'Quá hạn',
    hint: 'Cần xử lý gấp',
    icon: TriangleAlert,
    dotClass: 'bg-error-500',
    titleClass: 'text-error-600 dark:text-error-500',
    columnBorderClass: 'border-error-200 dark:border-error-500/20',
    cardBorderClass: 'border-error-100 dark:border-error-500/20',
    dueChipClass: 'bg-error-50 text-error-600 dark:bg-error-500/10 dark:text-error-500',
    pillIdleClass:
      'border-error-100 bg-error-50 text-error-600 dark:border-error-500/25 dark:bg-error-500/10 dark:text-error-500',
    pillActiveClass: 'border-error-500 bg-error-500 text-white',
  },
  today: {
    label: 'Hôm nay',
    hint: 'Lịch & việc trong ngày',
    icon: CalendarCheck,
    dotClass: 'bg-brand-500',
    titleClass: 'text-brand-500 dark:text-brand-400',
    columnBorderClass: 'border-brand-200 dark:border-brand-500/20',
    cardBorderClass: 'border-gray-200 dark:border-white/[0.05]',
    dueChipClass: 'bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-400',
    pillIdleClass:
      'border-brand-100 bg-brand-50 text-brand-500 dark:border-brand-500/25 dark:bg-brand-500/15 dark:text-brand-400',
    pillActiveClass: 'border-brand-500 bg-brand-500 text-white',
  },
  upcoming: {
    label: 'Sắp tới',
    hint: 'Trong tuần',
    icon: CalendarDays,
    dotClass: 'bg-gray-400',
    titleClass: 'text-gray-700 dark:text-gray-300',
    columnBorderClass: 'border-gray-200 dark:border-white/[0.05]',
    cardBorderClass: 'border-gray-200 dark:border-white/[0.05]',
    dueChipClass: 'bg-gray-100 text-gray-600 dark:bg-white/[0.05] dark:text-gray-400',
    pillIdleClass:
      'border-gray-200 bg-gray-100 text-gray-700 dark:border-white/[0.05] dark:bg-white/[0.05] dark:text-gray-300',
    pillActiveClass: 'border-gray-700 bg-gray-700 text-white dark:border-gray-300 dark:bg-gray-300 dark:text-gray-900',
  },
};
