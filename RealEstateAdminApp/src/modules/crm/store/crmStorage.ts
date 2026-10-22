/**
 * Lưu/đọc dữ liệu CRM prototype trong localStorage, CÓ version schema + migration an toàn.
 *
 * - Schema hiện tại: v5.
 *   - v3 -> v4: bỏ `customer.code` (+ dựng lại searchText), tách listGroup CARING -> NOT_CONTACTED | INTERESTED.
 *   - v4 -> v5: dự án có `deletedAt`, `priceFrom/priceTo/priceUnit` (thay `priceText`), `status` enum (thay `statusLabel`), mã hợp lệ
 *     (sinh mã gợi ý cho mã rỗng/sai mẫu); thêm `auditLogs`.
 * - Trước khi ghi đè bản cũ luôn giữ 1 bản sao nguyên văn dưới khoá `stnd_crm_data_backup_v<version>`.
 * - Một khách hỏng KHÔNG làm mất cả CSDL: khách hỏng bị loại riêng (kèm dữ liệu con), bản gốc lưu ở `stnd_crm_data_corrupt_<timestamp>`.
 * - v2 và cũ hơn / payload hỏng nặng: không tương thích, xoá và nạp lại seed.
 */
import { buildSearchText } from '@crm/lib/customerRules';
import { pruneNationalIds } from '@crm/lib/nationalIdVault';
import { isValidProjectCode, normalizePropertyTypes, parseLegacyPriceText, parseLegacyProjectStatus, PROJECT_NAME_MAX_LENGTH, suggestProjectCode } from '@crm/lib/projectRules';
import { normalizeVietnamese } from '@crm/lib/text';
import type { CrmDataState, CrmSession } from './crmReducer';

export const CRM_SCHEMA_VERSION = 5;
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

/**
 * Migration v3 -> v4 (chỉ gọi cho payload v3; không crash với dữ liệu thiếu/sai kiểu — phần còn lại do `isCrmDataState` kiểm):
 * - Bỏ field `code` (mã khách) khỏi từng khách và dựng lại `searchText` (không còn chứa mã, dù mã nằm ở biến thể nào).
 * - Tình trạng thuộc nhóm cũ CARING: mã (hoặc id seed) INTERESTED -> nhóm INTERESTED, còn lại -> NOT_CONTACTED (kể cả tình trạng
 *   không có `code`); tình trạng mặc định luôn thuộc NOT_CONTACTED.
 */
const migrateV3ToV4 = (data: unknown): unknown => {
  if (!isRecord(data)) return data;
  const customers = Array.isArray(data.customers)
    ? data.customers.map((customer) => {
        if (!isRecord(customer)) return customer;
        const { code: _legacyCode, ...rest } = customer;
        const searchText =
          isString(rest.fullName) && isString(rest.phone)
            ? buildSearchText({ fullName: rest.fullName, phone: rest.phone, email: isString(rest.email) ? rest.email : '' })
            : rest.searchText;
        return { ...rest, searchText };
      })
    : data.customers;
  const catalogs = data.catalogs;
  if (!isRecord(catalogs)) return { ...data, customers };
  const statuses = Array.isArray(catalogs.statuses)
    ? catalogs.statuses.map((status) => {
        if (!isRecord(status) || status.listGroup !== 'CARING') return status;
        const isInterested = (status.code === 'INTERESTED' || status.id === 'st-interested') && status.isDefault !== true;
        return { ...status, listGroup: isInterested ? 'INTERESTED' : 'NOT_CONTACTED' };
      })
    : catalogs.statuses;
  return { ...data, customers, catalogs: { ...catalogs, statuses } };
};

/** 1 dự án v4 -> v5: giá/trạng thái dạng chữ -> số/enum (không parse được thì để trống), loại hình chuỗi -> mảng, thêm `deletedAt`. */
const migrateProjectToV5 = (project: Record<string, unknown>): Record<string, unknown> => {
  const { priceText, statusLabel, propertyType, ...rest } = project;
  const isLegacy = 'priceText' in project || 'statusLabel' in project;
  const price = isLegacy ? parseLegacyPriceText(priceText) : { priceFrom: rest.priceFrom, priceTo: rest.priceTo, priceUnit: rest.priceUnit };
  const isFiniteNumber = (value: unknown) => typeof value === 'number' && Number.isFinite(value);
  return {
    ...rest,
    developer: withDefault(rest.developer, isString, ''),
    // Loại hình: mảng có sẵn giữ nguyên (đã chuẩn hoá); chuỗi cũ -> mảng 1 phần tử.
    propertyTypes: Array.isArray(rest.propertyTypes) ? normalizePropertyTypes(rest.propertyTypes) : normalizePropertyTypes([propertyType]),
    priceFrom: withDefault(price.priceFrom, isFiniteNumber, null),
    priceTo: withDefault(price.priceTo, isFiniteNumber, null),
    priceUnit: price.priceUnit === 'PER_SQM' ? 'PER_SQM' : 'TOTAL',
    status: isLegacy ? parseLegacyProjectStatus(statusLabel) : withDefault(rest.status, (value) => value === 'UPCOMING' || value === 'SELLING' || value === 'SOLD_OUT', null),
    deletedAt: withDefault(rest.deletedAt, isString, null),
  };
};

/**
 * Migration v4 -> v5: dự án (xem `migrateProjectToV5`) + VÁ dữ liệu cũ để `updateProject` không bị khoá: tên rỗng/quá 80 ký tự được vá,
 * tên trùng (không dấu) thêm hậu tố " (2)"…, mã chuẩn hoá CHỮ HOA, mã rỗng/sai mẫu/trùng -> mã gợi ý sinh từ tên (theo thứ tự: dự án
 * đứng trước giữ mã, dự án sau bị đổi). Thêm `auditLogs` rỗng.
 */
const migrateV4ToV5 = (data: unknown): unknown => {
  if (!isRecord(data)) return data;
  const catalogs = data.catalogs;
  const auditLogs = Array.isArray(data.auditLogs) ? data.auditLogs : [];
  if (!isRecord(catalogs) || !Array.isArray(catalogs.projects)) return { ...data, auditLogs };
  const takenCodes = new Set<string>();
  const takenNames = new Set<string>();
  const projects = catalogs.projects.map((entry) => {
    if (!isRecord(entry)) return entry;
    const project = migrateProjectToV5(entry);
    const fullName = isString(project.fullName) ? project.fullName.trim() : '';
    const legacyCode = isString(project.code) ? project.code.trim() : '';
    const name = ((isString(project.name) ? project.name.trim() : '') || fullName || legacyCode || 'Dự án').slice(0, PROJECT_NAME_MAX_LENGTH);
    let uniqueName = name;
    for (let suffix = 2; takenNames.has(normalizeVietnamese(uniqueName)); suffix += 1) {
      const tail = ` (${suffix})`;
      uniqueName = `${name.slice(0, PROJECT_NAME_MAX_LENGTH - tail.length)}${tail}`;
    }
    takenNames.add(normalizeVietnamese(uniqueName));
    let code = legacyCode.toUpperCase();
    if (!isValidProjectCode(code) || takenCodes.has(code)) code = suggestProjectCode(uniqueName, takenCodes);
    takenCodes.add(code);
    return { ...project, name: uniqueName, code };
  });
  return { ...data, auditLogs, catalogs: { ...catalogs, projects } };
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
 * Luôn dọn khoá schema cũ. Tự migrate v3 -> v4 -> v5 (giữ 1 bản sao dưới khoá backup) và vá bản ghi hỏng (bản gốc ở khoá _corrupt_ khi
 * KHÔNG migrate — khi migrate thì bản backup đã là bản gốc, không ghi trùng); khách bị loại cũng được dọn khỏi kho CCCD mô phỏng.
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
      const storedVersion = parsed.schemaVersion;
      let data: unknown = parsed.data;
      let version = storedVersion;
      if (version === 3) {
        data = migrateV3ToV4(data);
        version = 4;
      }
      if (version === 4) {
        data = migrateV4ToV5(data);
        version = 5;
      }
      if (version === CRM_SCHEMA_VERSION) {
        const result = salvageCrmData(normalizeCrmData(data));
        if (result) {
          const isMigrated = storedVersion !== CRM_SCHEMA_VERSION;
          const isPatched = result.droppedCount > 0;
          if (isMigrated) backupBeforeOverwrite(storage, raw, storedVersion);
          else if (isPatched) backupCorruptPayload(storage, raw);
          if (isPatched) pruneNationalIds(new Set(result.data.customers.map((customer) => customer.id)));
          if (isMigrated || isPatched) setItemWithQuotaRetry(storage, CRM_STORAGE_KEY, JSON.stringify({ schemaVersion: CRM_SCHEMA_VERSION, data: result.data }));
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
