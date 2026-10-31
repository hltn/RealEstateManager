/**
 * Tiện ích bộ lọc danh sách khách phía giao diện (đếm bộ lọc đang bật, tuỳ chọn tiến độ).
 * Logic so khớp nằm ở lớp dữ liệu (`api/queries.ts` — `matchesCustomerFilters`) để giống query backend.
 */
import type { CustomerFilters } from '@crm/types/app';
import { PROGRESS_VALUES } from './customerRules';

/** Trường "bộ lọc nâng cao" (ngoài ô tìm kiếm + tab danh sách). */
export type AdvancedFilterKey = Exclude<keyof CustomerFilters, 'q' | 'listGroup'>;

/** Số nhóm bộ lọc nâng cao đang bật (hiện trên nút "Bộ lọc nâng cao"). Khoảng ngày cập nhật tính 1 nhóm. */
export const countActiveAdvancedFilters = (filters: CustomerFilters): number => {
  const arrayKeys: AdvancedFilterKey[] = ['statusIds', 'sourceIds', 'projectIds', 'areaIds', 'assigneeIds', 'primaryAssigneeIds', 'progress', 'tagIds'];
  const arrayCount = arrayKeys.filter((key) => (filters[key] as unknown[]).length > 0).length;
  const dateCount = filters.updatedFrom || filters.updatedTo ? 1 : 0;
  const occupationCount = filters.occupation.trim() ? 1 : 0;
  return arrayCount + dateCount + occupationCount;
};

/** Có từ khoá tìm kiếm hoặc bộ lọc nâng cao nào đang bật (tab danh sách không tính). */
export const hasActiveCustomerFilters = (filters: CustomerFilters): boolean => filters.q.trim() !== '' || countActiveAdvancedFilters(filters) > 0;

export const PROGRESS_FILTER_OPTIONS: readonly { value: number; label: string }[] = PROGRESS_VALUES.map((value) => ({
  value,
  label: `${value}% (${value / 25}/4)`,
}));

/** Bật/tắt 1 giá trị trong mảng bộ lọc. */
export const toggleValue = <T>(values: readonly T[], value: T): T[] =>
  values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
