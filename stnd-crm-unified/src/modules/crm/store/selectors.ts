/**
 * Selector thuần đọc dữ liệu dẫn xuất từ CrmState. Dùng trong hook hoặc test.
 */
import { STAFF_LIST } from '@crm/data/mockData';
import { filterCustomers } from '@crm/lib/customerFilters';
import type { CareLog, Customer, DailyTask, TaskCategory } from '@crm/types/crm';
import type { CrmState } from './crmReducer';

export const selectCustomerById = (state: CrmState, customerId: string | null | undefined): Customer | null =>
  customerId ? (state.customers.find((customer) => customer.id === customerId) ?? null) : null;

/**
 * Khách đang chọn (ở màn theo khách = id trên URL, CrmProvider ghi đè `selectedCustomerId`).
 * KHÔNG rơi về khách đầu tiên khi id không tồn tại: trả `null` để màn hiện "Không tìm thấy khách hàng"
 * thay vì mở / sửa nhầm hồ sơ khác.
 */
export const selectSelectedCustomer = (state: CrmState): Customer | null =>
  selectCustomerById(state, state.selectedCustomerId);

/** Nhật ký của 1 khách, giữ thứ tự mới nhất trước. */
export const selectCareLogsByCustomer = (state: CrmState, customerId: string | null | undefined): CareLog[] =>
  customerId ? state.careLogs.filter((log) => log.customerId === customerId) : [];

export interface TaskWithCustomer extends DailyTask {
  /** Hồ sơ khách đầy đủ (null nếu khách đã bị xoá khỏi dữ liệu). */
  customer: Customer | null;
}

export type TaskGroups = Record<TaskCategory, TaskWithCustomer[]>;

/** Nhóm việc theo Quá hạn / Hôm nay / Sắp tới, kèm hồ sơ khách (thay cho Customer.category của Mobile). */
export const selectTaskGroups = (state: CrmState): TaskGroups => {
  const groups: TaskGroups = { overdue: [], today: [], upcoming: [] };
  state.tasks.forEach((task) => {
    groups[task.category].push({ ...task, customer: selectCustomerById(state, task.customerId) });
  });
  return groups;
};

/** Số việc cần xử lý (quá hạn + hôm nay) - badge "Việc hôm nay". */
export const selectPendingTaskCount = (state: CrmState): number =>
  state.tasks.filter((task) => task.category !== 'upcoming').length;

export const selectFilteredCustomers = (state: CrmState): Customer[] =>
  filterCustomers(state.customers, state.filters, STAFF_LIST);

/** Đếm số khách theo nhãn trạng thái (tab trạng thái của danh sách). */
export const selectCustomerCountByStatus = (state: CrmState): Record<Customer['status'], number> =>
  state.customers.reduce(
    (counts, customer) => ({ ...counts, [customer.status]: counts[customer.status] + 1 }),
    { 'Có quan tâm': 0, 'Khách net': 0, 'Chưa tiếp cận': 0, 'Bỏ / Không nhu cầu': 0 } as Record<
      Customer['status'],
      number
    >,
  );
