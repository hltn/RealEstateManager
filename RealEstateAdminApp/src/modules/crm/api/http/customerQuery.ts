/**
 * Đổi bộ lọc danh sách khách của UI thành query string của `GET /crm/customers` và `list-counts` (05 §1.4, §2.3).
 * Backend dùng `forbidNonWhitelisted`: KHÔNG gửi tham số lạ; `q` phải 2–100 ký tự.
 */
import type { CustomerListQuery } from '../types';
import type { QueryParams } from './crmHttp';

export const SEARCH_MIN_LENGTH = 2;
export const SEARCH_MAX_LENGTH = 100;

/** `q` hợp lệ để gửi lên server (bỏ khoảng trắng đầu/cuối; <2 ký tự -> không tìm). */
export const normalizeSearchTerm = (raw: string | undefined): string | undefined => {
  const term = (raw ?? '').trim().slice(0, SEARCH_MAX_LENGTH);
  return term.length >= SEARCH_MIN_LENGTH ? term : undefined;
};

/** Bộ lọc chung của danh sách và `list-counts`. */
export const buildCustomerFilterParams = (query: CustomerListQuery): QueryParams => ({
  q: normalizeSearchTerm(query.q),
  statusIds: query.statusIds,
  sourceIds: query.sourceIds,
  projectIds: query.projectIds,
  areaIds: query.areaIds,
  assigneeIds: query.assigneeIds,
  primaryAssigneeIds: query.primaryAssigneeIds,
  progress: query.progress,
  updatedFrom: query.updatedFrom,
  updatedTo: query.updatedTo,
  occupation: query.occupation?.trim() || undefined,
  tagIds: query.tagIds,
});

/** `GET /crm/customers`: `listGroup` = ALL là mặc định nên không gửi. */
export const buildCustomerListParams = (query: CustomerListQuery): QueryParams => ({
  ...buildCustomerFilterParams(query),
  listGroup: query.listGroup && query.listGroup !== 'ALL' ? query.listGroup : undefined,
  sort: query.sort,
  page: query.page,
  limit: query.limit,
});
