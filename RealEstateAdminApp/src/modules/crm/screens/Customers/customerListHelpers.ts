/**
 * Cấu hình cục bộ của màn "Khách hàng": tuỳ chọn sắp xếp (whitelist `sort` của 05 §2.3) và tab danh sách.
 */
import type { CustomerSort } from '@crm/api';
import { LIST_GROUP_LABELS } from '@crm/lib/customerRules';
import type { CustomerListTab } from '@crm/types/app';

export const CUSTOMER_SORT_OPTIONS: { value: CustomerSort; label: string }[] = [
  { value: '-lastUpdatedAt', label: 'Cập nhật mới nhất' },
  { value: 'nextAppointmentAt', label: 'Hẹn gần nhất' },
  { value: '-progress', label: 'Tiến độ (cao → thấp)' },
  { value: 'fullName', label: 'Tên A → Z' },
  { value: '-createdAt', label: 'Mới tạo' },
  { value: 'lastCareLogAt', label: 'Lâu chưa chăm sóc' },
];

/**
 * Tab danh sách (C6): 4 nhóm danh sách theo tình trạng + "Tất cả" (đặt cuối).
 */
export const LIST_TABS: { value: CustomerListTab; label: string }[] = [
  { value: 'NOT_CONTACTED', label: LIST_GROUP_LABELS.NOT_CONTACTED },
  { value: 'INTERESTED', label: LIST_GROUP_LABELS.INTERESTED },
  { value: 'NET', label: LIST_GROUP_LABELS.NET },
  { value: 'DROPPED', label: LIST_GROUP_LABELS.DROPPED },
  { value: 'ALL', label: 'Tất cả' },
];
