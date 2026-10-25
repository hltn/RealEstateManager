/**
 * Truy vấn trên store MOCK — CHỈ còn phục vụ phần giai đoạn 2 (M8) chạy bằng dữ liệu mẫu có cờ: Báo cáo (`dashboard.ts`),
 * xuất file (`exports.ts`), nhập file (`mockCrmApi.ts`). Các màn đã nối API thật KHÔNG dùng file này.
 * Hàm thuần: (state, actor, tham số) -> kết quả; mọi truy vấn khách đều lọc theo phạm vi quyền. Gỡ cùng M8.
 */
import { getListGroupOfStatus, getPersonaText, getProgressPercent, isInCareTeam } from '@crm/lib/customerRules';
import { toVnDateKey } from '@crm/lib/dateTime';
import { getPhoneSearchVariants, normalizePhone } from '@crm/lib/phone';
import { normalizeVietnamese } from '@crm/lib/text';
import type { CrmDataState } from '@crm/store/crmReducer';
import type { CustomerFilters } from '@crm/types/app';
import type { CrmCatalogs, CrmUser, Customer, StatusRef, UserRef } from '@crm/types/crm';
import { canAccessCustomer, type CrmActor } from './access';
import type { CustomerListQuery, CustomerSort, PhoneLookupResult } from './types';

export const DEFAULT_CUSTOMER_SORT: CustomerSort = '-lastUpdatedAt';

export const toUserRef = (users: readonly CrmUser[], userId: string | null | undefined): UserRef | null => {
  if (!userId) return null;
  const user = users.find((item) => item.id === userId);
  return { id: userId, displayName: user?.displayName ?? (userId === 'system' ? 'Hệ thống' : 'Không rõ') };
};

export const toStatusRef = (catalogs: CrmCatalogs, statusId: string): StatusRef => {
  const status = catalogs.statuses.find((item) => item.id === statusId);
  return status
    ? { id: status.id, label: status.label, code: status.code, listGroup: status.listGroup, tone: status.tone }
    : { id: statusId, label: 'Không rõ', code: 'UNKNOWN', listGroup: 'NOT_CONTACTED', tone: 'gray' };
};

export const getAccessibleCustomers = (state: CrmDataState, actor: CrmActor): Customer[] =>
  state.customers.filter((customer) => canAccessCustomer(actor, customer, state.users));

const hasAny = (values: readonly string[] | undefined): values is string[] => Boolean(values && values.length > 0);

/** Từ khoá SĐT: bỏ ký tự phân cách, còn lại toàn chữ số (>= 3) thì so theo chữ số và các biến thể SĐT. */
const matchesPhoneKeyword = (searchText: string, rawKeyword: string): boolean => {
  const compact = rawKeyword.replace(/[\s+().-]/g, '');
  if (!/^\d{3,}$/.test(compact)) return false;
  const variants = new Set([compact, ...(normalizePhone(rawKeyword) ? getPhoneSearchVariants(rawKeyword) : [])]);
  return [...variants].some((variant) => variant.length >= 3 && searchText.includes(variant));
};

/** So khớp 1 khách với bộ lọc (không gồm `listGroup`). Tìm kiếm không dấu qua `searchText`. */
export const matchesCustomerFilters = (customer: Customer, filters: Partial<CustomerFilters>): boolean => {
  const keyword = normalizeVietnamese(filters.q ?? '');
  if (keyword && !customer.searchText.includes(keyword) && !matchesPhoneKeyword(customer.searchText, filters.q ?? '')) return false;
  if (hasAny(filters.statusIds) && !filters.statusIds.includes(customer.statusId)) return false;
  if (hasAny(filters.sourceIds) && (!customer.sourceId || !filters.sourceIds.includes(customer.sourceId))) return false;
  if (hasAny(filters.projectIds) && !customer.interestedProjectIds.some((id) => filters.projectIds?.includes(id))) return false;
  if (hasAny(filters.areaIds) && (!customer.areaId || !filters.areaIds.includes(customer.areaId))) return false;
  if (hasAny(filters.assigneeIds) && !filters.assigneeIds.some((userId) => isInCareTeam(customer.careTeam, userId))) return false;
  if (hasAny(filters.primaryAssigneeIds) && (!customer.primaryAssigneeId || !filters.primaryAssigneeIds.includes(customer.primaryAssigneeId))) return false;
  if (filters.progress && filters.progress.length > 0 && !filters.progress.includes(getProgressPercent(customer.criteria))) return false;
  const updatedKey = toVnDateKey(customer.lastUpdatedAt);
  if (filters.updatedFrom && updatedKey < filters.updatedFrom) return false;
  if (filters.updatedTo && updatedKey > filters.updatedTo) return false;
  if (filters.occupation?.trim()) {
    const occupation = normalizeVietnamese(getPersonaText(customer.persona, 'occupation'));
    if (!occupation.includes(normalizeVietnamese(filters.occupation))) return false;
  }
  if (hasAny(filters.tagIds) && !filters.tagIds.every((tagId) => customer.tagIds.includes(tagId))) return false;
  return true;
};

const compareNullableIso = (first: string | null, second: string | null): number => {
  if (first === second) return 0;
  if (!first) return 1;
  if (!second) return -1;
  return first.localeCompare(second);
};

/** Sắp xếp theo whitelist 05 §2.3 (mặc định `-lastUpdatedAt`; giá trị rỗng luôn xuống cuối). */
export const sortCustomers = (customers: Customer[], sort: CustomerSort = DEFAULT_CUSTOMER_SORT): Customer[] => {
  const isDescending = sort.startsWith('-');
  const field = (isDescending ? sort.slice(1) : sort) as CustomerSort;
  const direction = isDescending ? -1 : 1;
  return [...customers].sort((first, second) => {
    switch (field) {
      case 'fullName':
        return direction * first.fullName.localeCompare(second.fullName, 'vi');
      case 'progress':
        return direction * (getProgressPercent(first.criteria) - getProgressPercent(second.criteria));
      case 'personaCompleteness':
        return direction * (first.personaCompleteness - second.personaCompleteness);
      case 'createdAt':
        return direction * first.createdAt.localeCompare(second.createdAt);
      case 'nextAppointmentAt':
      case 'lastCareLogAt': {
        const firstValue = first[field];
        const secondValue = second[field];
        if (!firstValue || !secondValue) return compareNullableIso(firstValue, secondValue);
        return direction * firstValue.localeCompare(secondValue);
      }
      default:
        return direction * first.lastUpdatedAt.localeCompare(second.lastUpdatedAt);
    }
  });
};

/** Lọc khách (gồm listGroup + customerIds) theo phạm vi quyền — dùng chung xuất CSV, báo cáo mẫu. */
export const queryCustomers = (state: CrmDataState, actor: CrmActor, query: CustomerListQuery): Customer[] => {
  const customers = getAccessibleCustomers(state, actor).filter(
    (customer) =>
      (!query.customerIds || query.customerIds.includes(customer.id)) &&
      (!query.listGroup || query.listGroup === 'ALL' || getListGroupOfStatus(state.catalogs.statuses, customer.statusId) === query.listGroup) &&
      matchesCustomerFilters(customer, query),
  );
  return sortCustomers(customers, query.sort);
};

/** Tra trùng SĐT trong dữ liệu mẫu (kiểm file nhập). */
export const lookupPhone = (state: CrmDataState, actor: CrmActor, phone: string): PhoneLookupResult | null => {
  const normalizedPhone = normalizePhone(phone);
  if (!normalizedPhone) return null;
  const existing = state.customers.find((customer) => normalizePhone(customer.phone) === normalizedPhone);
  if (!existing) return { normalizedPhone, exists: false, isAccessible: false, caredByName: null, canRequestJoin: false, hasPendingRequest: false };
  const isAccessible = canAccessCustomer(actor, existing, state.users);
  return { normalizedPhone, exists: true, isAccessible, customerId: isAccessible ? existing.id : undefined, caredByName: null, canRequestJoin: false, hasPendingRequest: false };
};
