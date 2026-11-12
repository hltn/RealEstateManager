/**
 * Tham chiếu danh mục theo `code` (FR-40, Architecture 4.2 / 6.1).
 * Quy ước của UI: "id" của tình trạng, nguồn, khu vực, dự án, kết quả liên hệ = `code` bất biến của backend; khi backend chưa trả `code`
 * (bản ghi chưa migrate) thì dùng `id` cũ (ObjectId) để UI vẫn chạy. Backend nhận cả hai (ghi kép) trong suốt v1.0.4.
 *
 * Ngoại lệ: URL quản trị (`PATCH/DELETE /crm/areas/:id`...) và vài tham số hợp đồng chưa đổi (lọc lịch hẹn theo `projectId`) vẫn cần
 * ObjectId thật. Bảng tra nhỏ dưới đây được mapper điền mỗi lần đọc danh mục để đổi `code` -> id thật đúng ở lớp adapter,
 * không phải sửa các màn hình.
 */

import { CrmApiException } from './crmErrors';

export type CatalogKind = 'statuses' | 'leadSources' | 'contactResults' | 'areas' | 'projects';

/** ObjectId (24 ký tự hex thường). `code` luôn là chữ HOA/số/`_` nên không bao giờ trùng dạng này. */
const LEGACY_ID_PATTERN = /^[0-9a-f]{24}$/;

export const isLegacyServerId = (value: string): boolean => LEGACY_ID_PATTERN.test(value);

const codeByServerId = new Map<string, string>();
const serverIdByCode = new Map<string, string>();

const keyOf = (kind: CatalogKind, value: string): string => `${kind}:${value}`;

/** Ghi nhớ cặp id thật <-> code (gọi khi mapper đọc response). */
export const rememberCatalogId = (kind: CatalogKind, serverId: string, code: string | null | undefined): string => {
  const uiId = code || serverId;
  codeByServerId.set(keyOf(kind, serverId), uiId);
  serverIdByCode.set(keyOf(kind, uiId), serverId);
  return uiId;
};

/** id thật -> id của UI (`code`); chưa biết thì giữ nguyên. */
export const toUiCatalogId = (kind: CatalogKind, serverId: string): string => codeByServerId.get(keyOf(kind, serverId)) ?? serverId;

/** id của UI (`code`) -> id thật để gọi URL/tham số chỉ nhận ObjectId; chưa biết thì giữ nguyên. */
export const toServerCatalogId = (kind: CatalogKind, uiId: string): string => serverIdByCode.get(keyOf(kind, uiId)) ?? uiId;

/**
 * Như `toServerCatalogId` nhưng CHẶN SỚM khi thao tác bắt buộc cần ObjectId (URL quản trị, lọc lịch hẹn theo dự án...) mà chưa biết
 * id thật của `code` (danh mục chưa tải xong hoặc `code` không tồn tại): ném lỗi tiếng Việt thay vì gửi `code` vào chỗ cần ObjectId.
 * Nhận ObjectId cũ (bản ghi chưa migrate) và `code` đã được mapper ghi nhớ.
 */
export const requireServerCatalogId = (kind: CatalogKind, uiId: string): string => {
  if (isLegacyServerId(uiId)) return uiId;
  const serverId = serverIdByCode.get(keyOf(kind, uiId));
  if (serverId) return serverId;
  throw new CrmApiException({ statusCode: 0, errorCode: 'CATALOG_ID_UNRESOLVED', message: 'Danh mục chưa được tải xong hoặc đã thay đổi. Vui lòng tải lại trang rồi thử lại.' });
};

/** Chỉ dùng cho test. */
export const clearCatalogIdRegistry = (): void => {
  codeByServerId.clear();
  serverIdByCode.clear();
};

type Params = Record<string, string | string[] | null>;

/**
 * Một tham chiếu đơn: giá trị dạng `code` -> `{ [codeKey]: value }`; ObjectId cũ (bản ghi chưa migrate) -> `{ [idKey]: value }`.
 * `undefined` = không gửi; `null` = gửi tường minh (xóa) theo khóa `code`.
 */
export const refParam = (codeKey: string, idKey: string, value: string | null | undefined): Params => {
  if (value === undefined) return {};
  return value !== null && isLegacyServerId(value) ? { [idKey]: value } : { [codeKey]: value };
};

/**
 * Danh sách tham chiếu. Backend chỉ nhận MỘT trong hai (`…Codes` hoặc `…Ids`; gửi cả hai không cùng bản ghi -> 400) nên luôn trả đúng một khóa:
 * - ObjectId cũ mà đã biết `code` (danh mục đã tải, đã migrate) thì đổi sang `code` trước;
 * - toàn `code` -> `{ [codeKey] }`; toàn ObjectId cũ -> `{ [idKey] }`; mảng rỗng -> `{ [codeKey]: [] }` (xóa hết);
 * - trộn lẫn (chỉ xảy ra khi danh mục chưa migrate hết): đổi hết về ObjectId qua bảng tra rồi gửi `{ [idKey] }`; `code` chưa tra được thì
 *   giữ nguyên để backend báo lỗi rõ ràng thay vì bỏ sót im lặng.
 */
export const refListParam = (codeKey: string, idKey: string, values: readonly string[] | undefined, kind: CatalogKind): Params => {
  if (values === undefined) return {};
  const normalized = values.map((value) => (isLegacyServerId(value) ? toUiCatalogId(kind, value) : value));
  const legacy = normalized.filter(isLegacyServerId);
  if (legacy.length === 0) return { [codeKey]: normalized };
  if (legacy.length === normalized.length) return { [idKey]: normalized };
  return { [idKey]: normalized.map((value) => (isLegacyServerId(value) ? value : toServerCatalogId(kind, value))) };
};
