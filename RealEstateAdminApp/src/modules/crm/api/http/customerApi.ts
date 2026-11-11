/**
 * Gọi API khách hàng (05 §2.3, §2.4, §2.7, §2.11) và trả về view-type của UI. Hàm ghi ném `CrmApiException` khi lỗi.
 * Không log tham số/kết quả (có PII).
 */
import type { PersonaFieldDefinition } from '@crm/types/crm';
import type {
  CareLogView,
  CriteriaPatch,
  CreateCustomerInput,
  CustomerDetail,
  CustomerListItem,
  CustomerListQuery,
  CustomerPersonaView,
  DeletedCustomerItem,
  DeletedCustomerQuery,
  HistoryEntry,
  ListCounts,
  NationalIdViewEntry,
  Paginated,
  PersonaValueInput,
  PurgeResult,
  UpdateCriteriaResult,
  UpdateCustomerInput,
  UpdateStatusResult,
} from '../types';
import type { CareLogDto, CustomerDetailDto, CustomerListItemDto, CustomerPersonaDto, DeletedCustomerDto, HistoryEntryDto } from './dto';
import { crmHttp, type QueryParams } from './crmHttp';
import { refListParam, refParam, toUiCatalogId } from './catalogIds';
import { toStatusRef } from './catalogMappers';
import { buildCustomerFilterParams, buildCustomerListParams } from './customerQuery';
import { toCareLog, toCustomerDetail, toCustomerListItem, toCustomerPersona, toDeletedCustomer, toHistoryEntry, toNationalIdView, toPersonaValueBody } from './customerMappers';

const BASE = '/crm/customers';

export const fetchCustomerList = async (query: CustomerListQuery, signal?: AbortSignal): Promise<Paginated<CustomerListItem>> => {
  const result = await crmHttp.list<CustomerListItemDto>(BASE, { params: buildCustomerListParams(query), signal });
  return { data: result.data.map(toCustomerListItem), meta: result.meta };
};

interface ListCountsDto extends Omit<ListCounts, 'byStatus'> {
  /** `statusCode` có từ khi backend đếm theo `code` (FR-40); thiếu thì suy từ `statusId`. */
  byStatus: { statusId: string; statusCode?: string; count: number }[];
}

/** `byStatus[].statusId` của UI = `code` của tình trạng (FR-40). */
export const toListCounts = (dto: ListCountsDto): ListCounts => ({
  ...dto,
  byStatus: dto.byStatus.map((item) => ({ statusId: item.statusCode ?? toUiCatalogId('statuses', item.statusId), count: item.count })),
});

export const fetchListCounts = async (query: CustomerListQuery, signal?: AbortSignal): Promise<ListCounts> =>
  toListCounts(await crmHttp.get<ListCountsDto>(`${BASE}/list-counts`, { params: buildCustomerFilterParams(query), signal }));

export const fetchCustomerDetail = async (customerId: string, signal?: AbortSignal): Promise<CustomerDetail> =>
  toCustomerDetail(await crmHttp.get<CustomerDetailDto>(`${BASE}/${encodeURIComponent(customerId)}`, { signal }));

export const fetchCustomerPersona = async (customerId: string, fields: ReadonlyMap<string, PersonaFieldDefinition>, signal?: AbortSignal): Promise<CustomerPersonaView> =>
  toCustomerPersona(await crmHttp.get<CustomerPersonaDto>(`${BASE}/${encodeURIComponent(customerId)}/persona`, { signal }), fields);

export interface CareLogQuery {
  page?: number;
  limit?: number;
  authorId?: string;
  contactChannel?: string;
  from?: string;
  to?: string;
}

export const fetchCareLogs = async (customerId: string, query: CareLogQuery, primaryUserId: string | null, signal?: AbortSignal): Promise<Paginated<CareLogView>> => {
  const result = await crmHttp.list<CareLogDto>(`${BASE}/${encodeURIComponent(customerId)}/care-logs`, { params: query as QueryParams, signal });
  return { data: result.data.map((item) => toCareLog(item, primaryUserId)), meta: result.meta };
};

export const fetchHistories = async (customerId: string, query: { page?: number; limit?: number }, signal?: AbortSignal): Promise<Paginated<HistoryEntry>> => {
  const result = await crmHttp.list<HistoryEntryDto>(`${BASE}/${encodeURIComponent(customerId)}/histories`, { params: query, signal });
  return { data: result.data.map(toHistoryEntry), meta: result.meta };
};

export const fetchNationalIdViews = async (customerId: string, signal?: AbortSignal): Promise<Paginated<NationalIdViewEntry>> => {
  const result = await crmHttp.list<{ viewer: { id: string; displayName: string }; viewedAt: string; purpose: string | null; source: string }>(
    `${BASE}/${encodeURIComponent(customerId)}/national-id-views`,
    { params: { limit: 50 }, signal },
  );
  return { data: result.data.map(toNationalIdView), meta: result.meta };
};

// --- Ghi ---------------------------------------------------------------------------------------------------------------

/** Chỉ gửi trường có giá trị; email rỗng -> không gửi (backend nhận `null`/vắng mặt). */
const stripEmpty = <T extends Record<string, unknown>>(input: T): Partial<T> =>
  Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)) as Partial<T>;

/** SĐT gửi lên: vắng = không đổi/không gửi; rỗng hoặc chỉ khoảng trắng = `null` (khách chưa có SĐT, FR-02); có số = giữ nguyên (backend chuẩn hóa). */
const toPhoneBody = (phone: string | null | undefined): string | null | undefined => (phone === undefined ? undefined : phone?.trim() ? phone : null);

export const postCustomer = async (input: CreateCustomerInput): Promise<CustomerDetail> => {
  const body = stripEmpty({
    fullName: input.fullName,
    phone: toPhoneBody(input.phone),
    email: input.email?.trim() ? input.email.trim() : undefined,
    // FR-40: gửi `…Code` (id của UI = code); ObjectId cũ gửi trường id tương ứng.
    ...refParam('statusCode', 'statusId', input.statusId),
    ...refParam('sourceCode', 'sourceId', input.sourceId ?? undefined),
    ...refListParam('projectCodes', 'interestedProjectIds', input.interestedProjectIds, 'projects'),
    ...refParam('areaCode', 'areaId', input.areaId ?? undefined),
    tagIds: input.tagIds,
    nationalId: input.nationalId?.trim() ? input.nationalId.trim() : undefined,
    criteria: input.criteria,
  });
  return toCustomerDetail(await crmHttp.post<CustomerDetailDto>(BASE, body, { isIdempotent: true }));
};

export const patchCustomer = async (customerId: string, input: UpdateCustomerInput): Promise<CustomerDetail> => {
  const body = stripEmpty({
    version: input.version,
    fullName: input.fullName,
    phone: toPhoneBody(input.phone),
    // `email: null` = xóa email (backend nhận null cho field không bắt buộc).
    email: input.email === undefined ? undefined : input.email.trim() === '' ? null : input.email.trim(),
    ...refParam('sourceCode', 'sourceId', input.sourceId),
    ...refListParam('projectCodes', 'interestedProjectIds', input.interestedProjectIds, 'projects'),
    ...refParam('areaCode', 'areaId', input.areaId),
    tagIds: input.tagIds,
  });
  return toCustomerDetail(await crmHttp.patch<CustomerDetailDto>(`${BASE}/${encodeURIComponent(customerId)}`, body));
};

interface StatusResultDto {
  status: Parameters<typeof toStatusRef>[0];
  previousStatusId: string | null;
  version: number;
  lastUpdatedAt: string;
}

export const patchStatus = async (customerId: string, body: { statusId: string; version: number; reason?: string }): Promise<UpdateStatusResult> => {
  const { statusId, ...rest } = body;
  const result = await crmHttp.patch<StatusResultDto>(`${BASE}/${encodeURIComponent(customerId)}/status`, { ...refParam('statusCode', 'statusId', statusId), ...rest });
  return { status: toStatusRef(result.status), previousStatusId: result.previousStatusId ? toUiCatalogId('statuses', result.previousStatusId) : '', version: result.version, lastUpdatedAt: result.lastUpdatedAt };
};

interface CriteriaResultDto {
  progress: number;
  version: number;
  lastUpdatedAt: string;
  autoStatusChange?: { from: Parameters<typeof toStatusRef>[0] | null; to: Parameters<typeof toStatusRef>[0] };
}

/** Sửa tiêu chí; PT-023: nếu server tự đổi tình trạng theo tiến độ thì kèm `autoStatusChange` (map như `patchStatus`). */
export const patchCriteria = async (customerId: string, version: number, criteria: CriteriaPatch): Promise<UpdateCriteriaResult> => {
  const result = await crmHttp.patch<CriteriaResultDto>(`${BASE}/${encodeURIComponent(customerId)}/criteria`, { version, ...criteria });
  const { autoStatusChange, ...rest } = result;
  if (!autoStatusChange) return rest;
  return { ...rest, autoStatusChange: { from: autoStatusChange.from ? toStatusRef(autoStatusChange.from) : null, to: toStatusRef(autoStatusChange.to) } };
};

/** `DELETE /crm/customers/:id?reason=` -> 204: xóa mềm (lý do bắt buộc). */
export const deleteCustomerById = (customerId: string, reason: string): Promise<void> => crmHttp.del(`${BASE}/${encodeURIComponent(customerId)}`, { params: { reason } });

// --- Khách đã xóa (chỉ Quản trị) -----------------------------------------------------------------------------------------

const DELETED_BASE = '/crm/deleted-customers';

export const fetchDeletedCustomers = async (query: DeletedCustomerQuery, signal?: AbortSignal): Promise<Paginated<DeletedCustomerItem>> => {
  const result = await crmHttp.list<DeletedCustomerDto>(DELETED_BASE, { params: { page: query.page, limit: query.limit, q: query.q }, signal });
  return { data: result.data.map(toDeletedCustomer), meta: result.meta };
};

/** `POST /crm/customer-restorations` (409 `CUSTOMER_ANONYMIZED` nếu khách đã ẩn danh hóa). */
export const postCustomerRestoration = (customerId: string): Promise<{ id: string }> => crmHttp.post<{ id: string }>('/crm/customer-restorations', { customerId });

/** `DELETE /crm/deleted-customers/:id` -> 200 `{ data: PurgeResult }`: KHÔNG hoàn tác; 503 = kho tệp lỗi, chưa xóa gì ở CSDL. */
export const deletePurgeCustomer = async (customerId: string): Promise<PurgeResult> =>
  (await crmHttp.raw<{ data: PurgeResult }>('delete', `${DELETED_BASE}/${encodeURIComponent(customerId)}`)).data;

export const putNationalIdValue = (customerId: string, nationalId: string): Promise<{ hasNationalId: boolean; nationalIdMasked: string | null }> =>
  crmHttp.put(`${BASE}/${encodeURIComponent(customerId)}/national-id`, { nationalId });

export const deleteNationalIdValue = (customerId: string): Promise<void> => crmHttp.del(`${BASE}/${encodeURIComponent(customerId)}/national-id`);

/** Xem/gọi/sao chép SĐT đầy đủ: server ghi audit `PHONE_VIEWED` (không lưu số). */
export const postPhoneView = (customerId: string, purpose: 'VIEW' | 'CALL' | 'COPY'): Promise<{ phone: string; viewedAt: string }> =>
  crmHttp.post(`${BASE}/${encodeURIComponent(customerId)}/phone-views`, { purpose });

export const postNationalIdView = (customerId: string, purpose?: string): Promise<{ nationalId: string; viewedAt: string }> =>
  crmHttp.post(`${BASE}/${encodeURIComponent(customerId)}/national-id-views`, purpose ? { purpose } : {});

export const patchPersona = async (
  customerId: string,
  version: number,
  values: PersonaValueInput[],
  fields: ReadonlyMap<string, PersonaFieldDefinition>,
): Promise<{ completeness: number; version: number }> => {
  const body = {
    version,
    values: values.map((item) => ({
      fieldKey: item.fieldKey,
      value: item.value === null ? null : toPersonaValueBody(item.value, fields.get(item.fieldKey)),
      source: item.source,
      ...(fields.get(item.fieldKey)?.isSensitive && item.value !== null ? { sensitiveAcknowledged: item.source === 'CUSTOMER_SHARED' } : {}),
    })),
  };
  return crmHttp.patch(`${BASE}/${encodeURIComponent(customerId)}/persona`, body);
};
