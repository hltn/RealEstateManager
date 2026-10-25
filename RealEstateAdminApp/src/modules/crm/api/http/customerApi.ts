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
  HistoryEntry,
  ListCounts,
  NationalIdViewEntry,
  Paginated,
  PersonaValueInput,
  PhoneLookupResult,
  UpdateCustomerInput,
  UpdateStatusResult,
} from '../types';
import type { CareLogDto, CustomerDetailDto, CustomerListItemDto, CustomerPersonaDto, HistoryEntryDto } from './dto';
import { crmHttp, type QueryParams } from './crmHttp';
import { toStatusRef } from './catalogMappers';
import { buildCustomerFilterParams, buildCustomerListParams } from './customerQuery';
import { toCareLog, toCustomerDetail, toCustomerListItem, toCustomerPersona, toHistoryEntry, toNationalIdView, toPersonaValueBody, type DetailMappingContext } from './customerMappers';

const BASE = '/crm/customers';

export const fetchCustomerList = async (query: CustomerListQuery, signal?: AbortSignal): Promise<Paginated<CustomerListItem>> => {
  const result = await crmHttp.list<CustomerListItemDto>(BASE, { params: buildCustomerListParams(query), signal });
  return { data: result.data.map(toCustomerListItem), meta: result.meta };
};

export const fetchListCounts = (query: CustomerListQuery, signal?: AbortSignal): Promise<ListCounts> =>
  crmHttp.get<ListCounts>(`${BASE}/list-counts`, { params: buildCustomerFilterParams(query), signal });

export const fetchCustomerDetail = async (customerId: string, context: DetailMappingContext, signal?: AbortSignal): Promise<CustomerDetail> =>
  toCustomerDetail(await crmHttp.get<CustomerDetailDto>(`${BASE}/${encodeURIComponent(customerId)}`, { signal }), context);

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

/** `POST phone-lookups`: SĐT nằm trong body (không lên URL/log). */
export const postPhoneLookup = (phone: string, signal?: AbortSignal): Promise<PhoneLookupResult> => crmHttp.post<PhoneLookupResult>(`${BASE}/phone-lookups`, { phone }, { signal });

// --- Ghi ---------------------------------------------------------------------------------------------------------------

/** Chỉ gửi trường có giá trị; email rỗng -> không gửi (backend nhận `null`/vắng mặt). */
const stripEmpty = <T extends Record<string, unknown>>(input: T): Partial<T> =>
  Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)) as Partial<T>;

export const postCustomer = async (input: CreateCustomerInput, context: DetailMappingContext): Promise<CustomerDetail> => {
  const body = stripEmpty({
    fullName: input.fullName,
    phone: input.phone,
    email: input.email?.trim() ? input.email.trim() : undefined,
    statusId: input.statusId,
    sourceId: input.sourceId ?? undefined,
    interestedProjectIds: input.interestedProjectIds,
    areaId: input.areaId ?? undefined,
    tagIds: input.tagIds,
    nationalId: input.nationalId?.trim() ? input.nationalId.trim() : undefined,
    criteria: input.criteria,
    careTeam: input.careTeam,
  });
  return toCustomerDetail(await crmHttp.post<CustomerDetailDto>(BASE, body, { isIdempotent: true }), context);
};

export const patchCustomer = async (customerId: string, input: UpdateCustomerInput, context: DetailMappingContext): Promise<CustomerDetail> => {
  const body = stripEmpty({
    version: input.version,
    fullName: input.fullName,
    phone: input.phone,
    // `email: null` = xóa email (backend nhận null cho field không bắt buộc).
    email: input.email === undefined ? undefined : input.email.trim() === '' ? null : input.email.trim(),
    sourceId: input.sourceId,
    interestedProjectIds: input.interestedProjectIds,
    areaId: input.areaId,
    tagIds: input.tagIds,
  });
  return toCustomerDetail(await crmHttp.patch<CustomerDetailDto>(`${BASE}/${encodeURIComponent(customerId)}`, body), context);
};

interface StatusResultDto {
  status: Parameters<typeof toStatusRef>[0];
  previousStatusId: string | null;
  version: number;
  lastUpdatedAt: string;
}

export const patchStatus = async (customerId: string, body: { statusId: string; version: number; reason?: string }): Promise<UpdateStatusResult> => {
  const result = await crmHttp.patch<StatusResultDto>(`${BASE}/${encodeURIComponent(customerId)}/status`, body);
  return { status: toStatusRef(result.status), previousStatusId: result.previousStatusId ?? '', version: result.version, lastUpdatedAt: result.lastUpdatedAt };
};

export const patchCriteria = (customerId: string, version: number, criteria: CriteriaPatch): Promise<{ progress: number; version: number; lastUpdatedAt: string }> =>
  crmHttp.patch(`${BASE}/${encodeURIComponent(customerId)}/criteria`, { version, ...criteria });

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
