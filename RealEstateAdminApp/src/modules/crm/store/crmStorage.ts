/**
 * Lưu/đọc dữ liệu CRM prototype trong localStorage, CÓ version schema + migration an toàn.
 *
 * - Schema hiện tại: v3 (mô hình tài liệu 04: statusId/careTeam/persona[]/changeLogs...).
 * - Dữ liệu cũ (khoá `stnd_crm_unified_v2`, mô hình phẳng "status: 'Có quan tâm'", "staffLead"...) KHÔNG tương thích:
 *   bị xoá và nạp lại dữ liệu mẫu mới — không cố chuyển đổi để tránh dữ liệu nửa vời.
 * - Payload sai cấu trúc / JSON hỏng / thiếu trường bắt buộc -> trả null để store nạp seed (không crash).
 */
import type { CrmDataState, CrmSession } from './crmReducer';

export const CRM_SCHEMA_VERSION = 3;
export const CRM_STORAGE_KEY = 'stnd_crm_data';
export const CRM_SESSION_STORAGE_KEY = 'stnd_crm_session_v1';
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
];

const CATALOG_KEYS = ['statuses', 'leadSources', 'areas', 'projects', 'tags', 'contactResults'] as const;

const isString = (value: unknown): value is string => typeof value === 'string';
const isNullableString = (value: unknown): boolean => value === null || isString(value);
const isStringArray = (value: unknown): boolean => Array.isArray(value) && value.every(isString);
const isArrayOf = (value: unknown, check: (item: unknown) => boolean): boolean => Array.isArray(value) && value.every(check);

const ROLES = ['ADMIN', 'MANAGER', 'STAFF'];
const LIST_GROUPS = ['CARING', 'NET', 'DROPPED'];
const CRITERIA_FIELDS = ['demand', 'motivation', 'finance', 'timing'];

const isCriteria = (value: unknown): boolean =>
  isRecord(value) && CRITERIA_FIELDS.every((key) => isRecord(value[key]) && typeof (value[key] as Record<string, unknown>).isDone === 'boolean');

const isCareTeamMember = (value: unknown): boolean => isRecord(value) && isString(value.userId) && (value.role === 'PRIMARY' || value.role === 'MEMBER');

/** Kiểm tra đủ sâu 1 khách v3: mọi trường mà selector/UI truy cập trực tiếp (criteria, careTeam, persona...). */
const isCustomerV3 = (value: unknown): boolean =>
  isRecord(value) &&
  isString(value.id) &&
  isString(value.fullName) &&
  isString(value.phone) &&
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
  isRecord(value) && ['staleCustomerDays', 'occasionLeadDays', 'upcomingDays'].every((key) => typeof value[key] === 'number');

/** Kiểm tra cấu trúc dữ liệu v3 (sâu tới các trường UI/selector dùng trực tiếp). Sai -> nạp seed. */
export const isCrmDataState = (value: unknown): value is CrmDataState => {
  if (!isRecord(value)) return false;
  if (!DATA_ARRAY_KEYS.every((key) => Array.isArray(value[key]))) return false;
  const catalogs = value.catalogs;
  if (!isRecord(catalogs) || !CATALOG_KEYS.every((key) => Array.isArray(catalogs[key]))) return false;
  if (!isArrayOf(catalogs.statuses, isStatusV3)) return false;
  if (!(['leadSources', 'areas', 'projects', 'tags', 'contactResults'] as const).every((key) => isArrayOf(catalogs[key], hasId))) return false;
  if (!isSettingsV3(value.settings)) return false;
  return (
    isArrayOf(value.users, isUserV3) &&
    isArrayOf(value.teams, (team) => hasId(team) && isStringArray((team as Record<string, unknown>).managerIds)) &&
    isArrayOf(value.customers, isCustomerV3) &&
    isArrayOf(value.careLogs, isCareLogV3) &&
    isArrayOf(value.appointments, isAppointmentV3) &&
    isArrayOf(value.changeLogs, isChangeLogV3) &&
    isArrayOf(value.nationalIdViews, isRecord) &&
    isArrayOf(value.careTeamRequests, isCareTeamRequestV3)
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
  };
};

// ---------------------------------------------------------------------------
// Sao lưu dữ liệu hỏng
// ---------------------------------------------------------------------------

export const MAX_CORRUPT_BACKUPS = 3;

/** Lưu bản sao `<key>_corrupt_<timestamp>` (giữ tối đa 3 bản mới nhất) để có thể cứu dữ liệu thủ công. */
const backupCorruptPayload = (storage: Storage, raw: string): void => {
  try {
    const prefix = `${CRM_STORAGE_KEY}_corrupt_`;
    let stamp = Date.now();
    while (storage.getItem(`${prefix}${stamp}`) !== null) stamp += 1;
    storage.setItem(`${prefix}${stamp}`, raw);
    const keys: string[] = [];
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key?.startsWith(prefix)) keys.push(key);
    }
    keys
      .sort((first, second) => Number(first.slice(prefix.length)) - Number(second.slice(prefix.length)))
      .slice(0, Math.max(0, keys.length - MAX_CORRUPT_BACKUPS))
      .forEach((key) => storage.removeItem(key));
  } catch {
    // Hết dung lượng: bỏ qua sao lưu, vẫn nạp seed.
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

/**
 * Đọc dữ liệu đã lưu. Trả null (để nạp seed) nếu: chưa có, JSON hỏng, sai version, sai cấu trúc.
 * Luôn dọn khoá schema cũ.
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
    if (isRecord(parsed) && parsed.schemaVersion === CRM_SCHEMA_VERSION) {
      const data = normalizeCrmData(parsed.data);
      if (isCrmDataState(data)) return data;
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
