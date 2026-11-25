/**
 * Lưu/đọc dữ liệu CRM prototype trong localStorage, CÓ version schema + migration an toàn.
 *
 * - Schema hiện tại: v7 (v1.0.5, T-20).
 *   - v7: thêm `customerCode` (mã khách `KH-######`, null được) và cho `phone: null` (khách chưa có SĐT, FR-02). Dữ liệu v6 được DI TRÚ (không
 *     bỏ): giữ bản sao nguyên văn dưới khoá backup v6, gán mã theo thứ tự `createdAt`, ghi lại thành v7.
 *   - v6: "id" của tình trạng/nguồn/khu vực/dự án/kết quả liên hệ = `code` bất biến của backend. Dữ liệu v3-v5 lưu theo id cũ (st-*, src-*,
 *     area-*, proj-*, ObjectId) không đổi được sang code một cách tin cậy (nguồn/khu vực cũ không có `code`) nên BỊ BỎ, không migrate:
 *     giữ 1 bản sao nguyên văn dưới khoá backup rồi nạp lại dữ liệu mẫu (bộ lọc/ưu tiên theo id cũ biến mất cùng dữ liệu đó, không lỗi).
 * - Trước khi ghi đè bản cũ luôn giữ 1 bản sao nguyên văn dưới khoá `stnd_crm_data_backup_v<version>`.
 * - Một khách hỏng KHÔNG làm mất cả CSDL: khách hỏng bị loại riêng (kèm dữ liệu con), bản gốc lưu ở `stnd_crm_data_corrupt_<timestamp>`.
 * - v2 và cũ hơn / payload hỏng nặng: không tương thích, xoá và nạp lại seed.
 */
import { pruneNationalIds } from '@crm/lib/nationalIdVault';
import type { CrmDataState, CrmSession } from './crmReducer';

export const CRM_SCHEMA_VERSION = 7;
/** Phiên bản cũ nhất còn nhận ra để sao lưu rồi bỏ (v3-v5, lưu theo id danh mục cũ). Nhỏ hơn: coi là hỏng/không tương thích. */
const OLDEST_DROPPABLE_SCHEMA_VERSION = 3;
/** Phiên bản cuối cùng bị bỏ; v6 (id theo code) được di trú lên v7 thay vì bỏ. */
const NEWEST_DROPPABLE_SCHEMA_VERSION = 5;
const MIGRATABLE_SCHEMA_VERSION = 6;
export const CRM_STORAGE_KEY = 'stnd_crm_data';
export const CRM_SESSION_STORAGE_KEY = 'stnd_crm_session_v1';
/** Tiền tố khoá bản sao dữ liệu cũ trước khi migration ghi đè (`<prefix><version>`). */
export const CRM_BACKUP_KEY_PREFIX = 'stnd_crm_data_backup_v';
/** Khoá của các schema cũ cần dọn khi nâng cấp. */
export const LEGACY_STORAGE_KEYS = ['stnd_crm_unified_v2', 'stnd_crm_unified_v1', 'stnd_customers', 'stnd_appointments'] as const;

interface StoredPayload {
  schemaVersion: number;
  data: CrmDataState;
}

const getStorage = (): Storage | null => {
  try {
    return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

const DATA_ARRAY_KEYS: (keyof CrmDataState)[] = [
  'users',
  'teams',
  'customers',
  'careLogs',
  'appointments',
  'changeLogs',
  'nationalIdViews',
  'careTeamRequests',
  'auditLogs',
];

const CATALOG_KEYS = ['statuses', 'leadSources', 'areas', 'projects', 'tags', 'contactResults'] as const;

const isString = (value: unknown): value is string => typeof value === 'string';
const isNullableString = (value: unknown): boolean => value === null || isString(value);
const isStringArray = (value: unknown): boolean => Array.isArray(value) && value.every(isString);
const isArrayOf = (value: unknown, check: (item: unknown) => boolean): boolean => Array.isArray(value) && value.every(check);

const ROLES = ['ADMIN', 'MANAGER', 'STAFF'];
const LIST_GROUPS = ['NOT_CONTACTED', 'INTERESTED', 'NET', 'DROPPED'];
const CRITERIA_FIELDS = ['demand', 'motivation', 'finance', 'timing'];

const isCriteria = (value: unknown): boolean =>
  isRecord(value) && CRITERIA_FIELDS.every((key) => isRecord(value[key]) && typeof (value[key] as Record<string, unknown>).isDone === 'boolean');

const isCareTeamMember = (value: unknown): boolean => isRecord(value) && isString(value.userId) && (value.role === 'PRIMARY' || value.role === 'MEMBER');

/** Kiểm tra đủ sâu 1 khách v4: mọi trường mà selector/UI truy cập trực tiếp (criteria, careTeam, persona...). */
const isCustomerV3 = (value: unknown): boolean =>
  isRecord(value) &&
  isString(value.id) &&
  isString(value.fullName) &&
  isNullableString(value.phone) &&
  isNullableString(value.customerCode) &&
  isString(value.statusId) &&
  isString(value.createdAt) &&
  isString(value.searchText) &&
  isCriteria(value.criteria) &&
  isArrayOf(value.careTeam, isCareTeamMember) &&
  isArrayOf(value.persona, (item) => isRecord(item) && isString(item.fieldKey)) &&
  isArrayOf(value.occasions, isRecord) &&
  isStringArray(value.interestedProjectIds) &&
  isStringArray(value.tagIds) &&
  isNullableString(value.sourceId) &&
  isNullableString(value.areaId) &&
  typeof value.version === 'number';

const isUserV3 = (value: unknown): boolean =>
  isRecord(value) && isString(value.id) && isString(value.fullName) && isString(value.displayName) && ROLES.includes(value.role as string) && typeof value.isActive === 'boolean';

const isNextActionV3 = (value: unknown): boolean => value === null || (isRecord(value) && isString(value.suggestion) && isNullableString(value.dueAt));

const isCareLogV3 = (value: unknown): boolean =>
  isRecord(value) &&
  isString(value.id) &&
  isString(value.customerId) &&
  isString(value.content) &&
  isString(value.occurredAt) &&
  isString(value.authorId) &&
  isNextActionV3(value.nextAction) &&
  (value.images === undefined || Array.isArray(value.images));

const isChangeLogV3 = (value: unknown): boolean =>
  isRecord(value) && isString(value.id) && isString(value.customerId) && isString(value.action) && isString(value.createdAt) && isString(value.actorId) && Array.isArray(value.changes);

const isCareTeamRequestV3 = (value: unknown): boolean =>
  isRecord(value) &&
  isString(value.id) &&
  isString(value.customerId) &&
  isString(value.requesterId) &&
  isString(value.message) &&
  isString(value.status) &&
  isString(value.createdAt) &&
  isNullableString(value.resolvedBy) &&
  isNullableString(value.resolvedAt);

const isAppointmentV3 = (value: unknown): boolean =>
  isRecord(value) && isString(value.id) && isString(value.customerId) && isString(value.startAt) && isString(value.assigneeId) && isString(value.status);

const hasId = (value: unknown): boolean => isRecord(value) && isString(value.id);

const isStatusV3 = (value: unknown): boolean =>
  isRecord(value) && isString(value.id) && isString(value.label) && LIST_GROUPS.includes(value.listGroup as string) && typeof value.isActive === 'boolean';

const isSettingsV3 = (value: unknown): boolean =>
  isRecord(value) && typeof value.staleCustomerDays === 'number';

/** Kiểm tra cấu trúc dữ liệu v3 (sâu tới các trường UI/selector dùng trực tiếp). Sai -> nạp seed. */
export const isCrmDataState = (value: unknown): value is CrmDataState => {
  if (!isRecord(value)) return false;
  if (!DATA_ARRAY_KEYS.every((key) => Array.isArray(value[key]))) return false;
  const catalogs = value.catalogs;
  if (!isRecord(catalogs) || !CATALOG_KEYS.every((key) => Array.isArray(catalogs[key]))) return false;
  if (!isArrayOf(catalogs.statuses, isStatusV3)) return false;
  if (!(['leadSources', 'areas', 'tags', 'contactResults'] as const).every((key) => isArrayOf(catalogs[key], hasId))) return false;
  if (!isArrayOf(catalogs.projects, isProjectEntry)) return false;
  if (!isSettingsV3(value.settings)) return false;
  return (
    isArrayOf(value.users, isUserV3) &&
    isArrayOf(value.teams, (team) => hasId(team) && isStringArray((team as Record<string, unknown>).managerIds)) &&
    isArrayOf(value.customers, isCustomerV3) &&
    isArrayOf(value.careLogs, isCareLogV3) &&
    isArrayOf(value.appointments, isAppointmentV3) &&
    isArrayOf(value.changeLogs, isChangeLogV3) &&
    isArrayOf(value.nationalIdViews, isRecord) &&
    isArrayOf(value.careTeamRequests, isCareTeamRequestV3) &&
    isArrayOf(value.auditLogs, hasId)
  );
};


// ---------------------------------------------------------------------------
// Chuẩn hoá: trường THIẾU nhẹ có giá trị mặc định an toàn (không bỏ cả CSDL vì lệch nhỏ)
// ---------------------------------------------------------------------------

const withDefault = <T>(value: unknown, isOk: (item: unknown) => boolean, fallback: T): unknown => (isOk(value) ? value : fallback);

const normalizeCustomer = (value: unknown): unknown =>
  isRecord(value)
    ? {
        ...value,
        occasions: withDefault(value.occasions, Array.isArray, []),
        persona: withDefault(value.persona, Array.isArray, []),
        tagIds: withDefault(value.tagIds, isStringArray, []),
        interestedProjectIds: withDefault(value.interestedProjectIds, isStringArray, []),
        careTeam: withDefault(value.careTeam, Array.isArray, []),
        version: withDefault(value.version, (item) => typeof item === 'number', 1),
        notes: withDefault(value.notes, isString, ''),
        email: withDefault(value.email, isString, ''),
        // v7: bản ghi THIẾU trường (undefined) -> chưa có SĐT / chưa có mã. Sai kiểu (vd số) KHÔNG đổi im lặng thành null: giữ nguyên để
        // `isCustomerV3` loại riêng khách đó và lưu bản gốc vào khoá `_corrupt_` (không làm mất SĐT thật mà không báo).
        phone: value.phone === undefined ? null : value.phone,
        customerCode: value.customerCode === undefined ? null : value.customerCode,
        searchText: withDefault(value.searchText, isString, ''),
      }
    : value;

const normalizeCareLog = (value: unknown): unknown => {
  if (!isRecord(value)) return value;
  const { images, ...rest } = value;
  return { ...rest, nextAction: value.nextAction === undefined ? null : value.nextAction, ...(Array.isArray(images) ? { images } : {}) };
};

/** Nhật ký thay đổi: bỏ bản ghi không có id; điền mặc định cho trường thiếu để UI không vỡ. */
const normalizeChangeLogs = (value: unknown): unknown =>
  Array.isArray(value)
    ? value
        .filter((item) => isRecord(item) && isString(item.id))
        .map((item) => ({
          customerId: '',
          action: 'CUSTOMER_UPDATED',
          actorId: '',
          actorName: '',
          actorRole: 'STAFF',
          source: 'WEB',
          createdAt: '1970-01-01T00:00:00.000Z',
          ...(item as Record<string, unknown>),
          changes: Array.isArray((item as Record<string, unknown>).changes) ? (item as Record<string, unknown>).changes : [],
        }))
    : value;

const normalizeCrmData = (value: unknown): unknown => {
  if (!isRecord(value)) return value;
  return {
    ...value,
    customers: Array.isArray(value.customers) ? value.customers.map(normalizeCustomer) : value.customers,
    careLogs: Array.isArray(value.careLogs) ? value.careLogs.map(normalizeCareLog) : value.careLogs,
    changeLogs: normalizeChangeLogs(value.changeLogs),
    auditLogs: Array.isArray(value.auditLogs) ? value.auditLogs : [],
  };
};

// ---------------------------------------------------------------------------
// Di trú v6 -> v7: cấp mã khách
// ---------------------------------------------------------------------------

const CUSTOMER_CODE_PATTERN = /^KH-(\d{6,})$/;

/**
 * Cấp `customerCode` cho khách v6 chưa có mã: theo thứ tự `createdAt` tăng dần (cùng giờ giữ thứ tự mảng), nối tiếp mã lớn nhất đã có.
 * Hàm thuần; khách sai kiểu giữ nguyên để bước kiểm tra sau đó loại riêng. `phone` không cần đổi (v6 luôn là chuỗi, v7 cho thêm null).
 */
export const migrateV6ToV7 = (data: unknown): unknown => {
  if (!isRecord(data) || !Array.isArray(data.customers)) return data;
  const customers = data.customers as unknown[];
  const existingSequences = customers.map((customer) => (isRecord(customer) && isString(customer.customerCode) ? CUSTOMER_CODE_PATTERN.exec(customer.customerCode) : null)).map((match) => (match ? Number(match[1]) : 0));
  let nextSequence = Math.max(0, ...existingSequences) + 1;
  const createdAtOf = (customer: unknown): string => (isRecord(customer) && isString(customer.createdAt) ? customer.createdAt : '');
  const orderedIndexes = customers
    .map((customer, index) => ({ index, createdAt: createdAtOf(customer) }))
    .sort((left, right) => (left.createdAt < right.createdAt ? -1 : left.createdAt > right.createdAt ? 1 : left.index - right.index))
    .map((item) => item.index);
  const codes = new Map<number, string>();
  orderedIndexes.forEach((index) => {
    const customer = customers[index];
    if (!isRecord(customer) || isString(customer.customerCode)) return;
    codes.set(index, `KH-${String(nextSequence).padStart(6, '0')}`);
    nextSequence += 1;
  });
  return { ...data, customers: customers.map((customer, index) => (codes.has(index) && isRecord(customer) ? { ...customer, customerCode: codes.get(index) } : customer)) };
};

// ---------------------------------------------------------------------------
// Sao lưu dữ liệu hỏng
// ---------------------------------------------------------------------------

export const MAX_CORRUPT_BACKUPS = 3;

const CORRUPT_KEY_PREFIX = `${CRM_STORAGE_KEY}_corrupt_`;

const keysWithPrefix = (storage: Storage, prefix: string): string[] => {
  const keys: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key?.startsWith(prefix)) keys.push(key);
  }
  return keys;
};

/** Xoá mọi bản sao (backup theo version + _corrupt_) để giải phóng dung lượng. */
const removeAllBackups = (storage: Storage): void => {
  [...keysWithPrefix(storage, CRM_BACKUP_KEY_PREFIX), ...keysWithPrefix(storage, CORRUPT_KEY_PREFIX)].forEach((key) => {
    try {
      storage.removeItem(key);
    } catch {
      // Bỏ qua.
    }
  });
};

/**
 * `setItem` có xử lý hết dung lượng: lỗi (QUOTA...) -> xoá MỌI bản sao rồi thử lại 1 lần (dữ liệu chính quan trọng hơn bản sao).
 * Trả true nếu ghi được.
 */
const setItemWithQuotaRetry = (storage: Storage, key: string, value: string): boolean => {
  try {
    storage.setItem(key, value);
    return true;
  } catch {
    removeAllBackups(storage);
    try {
      storage.setItem(key, value);
      return true;
    } catch {
      return false;
    }
  }
};

/** Lưu bản sao `<key>_corrupt_<timestamp>` (giữ tối đa 3 bản mới nhất) để có thể cứu dữ liệu thủ công. */
const backupCorruptPayload = (storage: Storage, raw: string): void => {
  try {
    let stamp = Date.now();
    while (storage.getItem(`${CORRUPT_KEY_PREFIX}${stamp}`) !== null) stamp += 1;
    if (!setItemWithQuotaRetry(storage, `${CORRUPT_KEY_PREFIX}${stamp}`, raw)) return;
    keysWithPrefix(storage, CORRUPT_KEY_PREFIX)
      .sort((first, second) => Number(first.slice(CORRUPT_KEY_PREFIX.length)) - Number(second.slice(CORRUPT_KEY_PREFIX.length)))
      .slice(0, Math.max(0, keysWithPrefix(storage, CORRUPT_KEY_PREFIX).length - MAX_CORRUPT_BACKUPS))
      .forEach((key) => storage.removeItem(key));
  } catch {
    // Không sao lưu được: vẫn nạp seed.
  }
};

/** Xoá các khoá schema cũ (gọi khi phát hiện dữ liệu không tương thích hoặc lần đầu chạy v3). */
export const clearLegacyData = (): void => {
  const storage = getStorage();
  if (!storage) return;
  LEGACY_STORAGE_KEYS.forEach((key) => {
    try {
      storage.removeItem(key);
    } catch {
      // Bỏ qua.
    }
  });
};

/** Giữ bản sao nguyên văn dữ liệu cũ trước khi migration ghi đè — CHỈ 1 bản (xoá bản của version khác). Hết dung lượng: xem `setItemWithQuotaRetry`. */
const backupBeforeOverwrite = (storage: Storage, raw: string, version: unknown): void => {
  keysWithPrefix(storage, CRM_BACKUP_KEY_PREFIX).forEach((key) => storage.removeItem(key));
  setItemWithQuotaRetry(storage, `${CRM_BACKUP_KEY_PREFIX}${String(version)}`, raw);
};

const isProjectEntry = (value: unknown): boolean => isRecord(value) && isString(value.id) && isString(value.name) && isString(value.code);

/**
 * Dữ liệu hợp lệ -> trả nguyên. Có bản ghi hỏng nhưng phần còn lại lành -> loại RIÊNG từng bản ghi hỏng (khách hỏng kéo theo dữ liệu con
 * trỏ tới họ; nhật ký/lịch hẹn/lịch sử/đề nghị/dự án hỏng cũng loại riêng), giữ phần lành. Không còn khách lành nào (trong khi có khách)
 * hoặc hỏng ở phần khác (người dùng, danh mục, cài đặt) -> null (nạp seed). `droppedCount` > 0 nghĩa là đã vá.
 */
const salvageCrmData = (data: unknown): { data: CrmDataState; droppedCount: number } | null => {
  if (isCrmDataState(data)) return { data, droppedCount: 0 };
  if (!isRecord(data) || !Array.isArray(data.customers)) return null;
  const healthy = data.customers.filter(isCustomerV3);
  if (data.customers.length > 0 && healthy.length === 0) return null;
  const ids = new Set(healthy.map((customer) => (customer as Record<string, unknown>).id));
  const isLinkedToHealthyCustomer = (item: unknown): boolean => isRecord(item) && (item.customerId === '' || ids.has(item.customerId));
  const keepOnly = (list: unknown, check: (item: unknown) => boolean): unknown => (Array.isArray(list) ? list.filter((item) => check(item) && isLinkedToHealthyCustomer(item)) : list);
  const catalogs = data.catalogs;
  const candidate = {
    ...data,
    customers: healthy,
    careLogs: keepOnly(data.careLogs, isCareLogV3),
    appointments: keepOnly(data.appointments, isAppointmentV3),
    changeLogs: keepOnly(data.changeLogs, isChangeLogV3),
    nationalIdViews: keepOnly(data.nationalIdViews, isRecord),
    careTeamRequests: keepOnly(data.careTeamRequests, isCareTeamRequestV3),
    auditLogs: Array.isArray(data.auditLogs) ? data.auditLogs.filter(hasId) : data.auditLogs,
    catalogs: isRecord(catalogs) && Array.isArray(catalogs.projects) ? { ...catalogs, projects: catalogs.projects.filter(isProjectEntry) } : catalogs,
  };
  if (!isCrmDataState(candidate)) return null;
  const count = (value: unknown): number => (Array.isArray(value) ? value.length : 0);
  const projectCount = (value: unknown): number => (isRecord(value) ? count(value.projects) : 0);
  const droppedCount =
    count(data.customers) - healthy.length +
    (['careLogs', 'appointments', 'changeLogs', 'nationalIdViews', 'careTeamRequests', 'auditLogs'] as const).reduce((sum, key) => sum + count(data[key]) - count(candidate[key]), 0) +
    projectCount(catalogs) - projectCount(candidate.catalogs);
  return droppedCount > 0 ? { data: candidate, droppedCount } : null;
};

/**
 * Đọc dữ liệu đã lưu. Trả null (để nạp seed) nếu: chưa có, JSON hỏng, version không hỗ trợ, hỏng nặng.
 * Luôn dọn khoá schema cũ. Payload v3-v5 (id danh mục cũ) bị bỏ sau khi giữ 1 bản sao dưới khoá backup; v6 được di trú lên v7; vá bản ghi hỏng (bản gốc
 * ở khoá _corrupt_); khách bị loại cũng được dọn khỏi kho CCCD mô phỏng.
 */
export const loadCrmData = (): CrmDataState | null => {
  const storage = getStorage();
  if (!storage) return null;
  clearLegacyData();
  let raw: string | null = null;
  try {
    raw = storage.getItem(CRM_STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (isRecord(parsed)) {
      const version = parsed.schemaVersion;
      // v3-v5 lưu theo id danh mục cũ: giữ bản sao nguyên văn rồi bỏ (trả null để nạp dữ liệu mẫu theo code), không migrate.
      if (typeof version === 'number' && version >= OLDEST_DROPPABLE_SCHEMA_VERSION && version <= NEWEST_DROPPABLE_SCHEMA_VERSION) {
        backupBeforeOverwrite(storage, raw, version);
        storage.removeItem(CRM_STORAGE_KEY);
        // Toàn bộ khách cũ bị bỏ: dọn luôn CCCD mô phỏng của họ (tập khách còn sống = rỗng).
        pruneNationalIds(new Set());
        return null;
      }
      if (version === CRM_SCHEMA_VERSION || version === MIGRATABLE_SCHEMA_VERSION) {
        const isMigrating = version === MIGRATABLE_SCHEMA_VERSION;
        // v6: giữ bản sao nguyên văn trước khi ghi đè bằng v7 (chỉ 1 bản backup).
        if (isMigrating) backupBeforeOverwrite(storage, raw, version);
        const result = salvageCrmData(normalizeCrmData(isMigrating ? migrateV6ToV7(parsed.data) : parsed.data));
        if (result) {
          if (result.droppedCount > 0) {
            backupCorruptPayload(storage, raw);
            pruneNationalIds(new Set(result.data.customers.map((customer) => customer.id)));
          }
          if (result.droppedCount > 0 || isMigrating) {
            setItemWithQuotaRetry(storage, CRM_STORAGE_KEY, JSON.stringify({ schemaVersion: CRM_SCHEMA_VERSION, data: result.data }));
          }
          return result.data;
        }
      }
    }
  } catch {
    // JSON hỏng: rơi xuống nhánh sao lưu + nạp seed.
  }
  if (raw) backupCorruptPayload(storage, raw);
  try {
    storage.removeItem(CRM_STORAGE_KEY);
  } catch {
    // Bỏ qua.
  }
  return null;
};

export type SaveResult = { ok: true } | { ok: false; reason: 'QUOTA' | 'UNAVAILABLE' };

/**
 * Ghi dữ liệu. KHÔNG nuốt lỗi: trả `{ ok: false, reason }` để UI báo người dùng
 * (dữ liệu vẫn còn trong bộ nhớ phiên hiện tại nhưng sẽ mất khi tải lại trang).
 */
export const saveCrmData = (data: CrmDataState): SaveResult => {
  const storage = getStorage();
  if (!storage) return { ok: false, reason: 'UNAVAILABLE' };
  try {
    const payload: StoredPayload = { schemaVersion: CRM_SCHEMA_VERSION, data };
    storage.setItem(CRM_STORAGE_KEY, JSON.stringify(payload));
    return { ok: true };
  } catch (error) {
    const isQuota = error instanceof DOMException && (error.name === 'QuotaExceededError' || error.name === 'NS_ERROR_DOM_QUOTA_REACHED');
    return { ok: false, reason: isQuota ? 'QUOTA' : 'UNAVAILABLE' };
  }
};

export const loadCrmSession = (): CrmSession | null => {
  const storage = getStorage();
  if (!storage) return null;
  try {
    const raw = storage.getItem(CRM_SESSION_STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    return isRecord(parsed) && typeof parsed.currentUserId === 'string' ? { currentUserId: parsed.currentUserId } : null;
  } catch {
    return null;
  }
};

export const saveCrmSession = (session: CrmSession): void => {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.setItem(CRM_SESSION_STORAGE_KEY, JSON.stringify(session));
  } catch {
    // Bỏ qua.
  }
};
