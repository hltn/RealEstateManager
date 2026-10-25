/**
 * Hàm thuần của màn Cài đặt CRM (X7, chỉ Quản trị): tab, bản nháp danh mục -> body API, kiểm cấu hình nhắc việc,
 * kiểm tài khoản/nhóm. Không phụ thuộc React -> test trực tiếp. Backend vẫn kiểm lại mọi thứ (nguồn sự thật).
 */
import { LIST_GROUP_LABELS } from '@crm/lib/customerRules';
import { toSlug } from '@crm/lib/text';
import type { CatalogEndpoint } from '@crm/api';
import type { Area, CatalogItem, CrmSettings, CustomerStatusItem, ListGroup, StatusTone } from '@crm/types/crm';

/** Danh mục chỉnh bằng form chung (dự án có màn riêng nên dùng `ProjectFormDialog`). */
export type AdminCatalogKind = 'statuses' | 'leadSources' | 'areas';

export type SettingsTab = AdminCatalogKind | 'projects' | 'users' | 'teams' | 'reminders';

export const SETTINGS_TABS: { id: SettingsTab; label: string }[] = [
  { id: 'statuses', label: 'Tình trạng khách' },
  { id: 'leadSources', label: 'Nguồn khách' },
  { id: 'areas', label: 'Khu vực' },
  { id: 'projects', label: 'Dự án' },
  { id: 'users', label: 'Người dùng' },
  { id: 'teams', label: 'Nhóm' },
  { id: 'reminders', label: 'Nhắc việc' },
];

export const CATALOG_ENDPOINTS: Record<AdminCatalogKind, CatalogEndpoint> = {
  statuses: 'customer-statuses',
  leadSources: 'lead-sources',
  areas: 'areas',
};

export const STATUS_TONE_OPTIONS: { value: StatusTone; label: string }[] = [
  { value: 'gray', label: 'Xám' },
  { value: 'brand', label: 'Xanh dương' },
  { value: 'success', label: 'Xanh lá' },
  { value: 'warning', label: 'Vàng cam' },
  { value: 'error', label: 'Đỏ' },
];

export const LIST_GROUP_OPTIONS = (Object.keys(LIST_GROUP_LABELS) as ListGroup[]).map((value) => ({ value, label: LIST_GROUP_LABELS[value] }));

/** Loại khu vực của backend (`AreaType`). */
export const AREA_TYPE_OPTIONS: { value: AreaType; label: string }[] = [
  { value: 'PROVINCE', label: 'Tỉnh / Thành phố' },
  { value: 'DISTRICT', label: 'Quận / Huyện' },
  { value: 'WARD', label: 'Phường / Xã' },
  { value: 'OTHER', label: 'Khác' },
];
export type AreaType = 'COUNTRY' | 'PROVINCE' | 'DISTRICT' | 'WARD' | 'OTHER';

export const CATALOG_NAME_MAX_LENGTH = 100;
export const CATALOG_CODE_PATTERN = /^[A-Z][A-Z0-9_]{0,29}$/;

export type AdminCatalogItem = CustomerStatusItem | CatalogItem | Area;

/** Bản nháp thống nhất cho form danh mục (trường không dùng bị bỏ qua theo loại). */
export interface CatalogDraft {
  /** null = thêm mới. */
  id: string | null;
  name: string;
  code: string;
  order: number;
  isActive: boolean;
  isDefault: boolean;
  isSystem: boolean;
  listGroup: ListGroup;
  tone: StatusTone;
  areaType: AreaType;
  /** '' = khu vực gốc. */
  parentId: string;
}

const getOrder = (item: AdminCatalogItem): number => item.order;

/** Thứ tự kế tiếp (lớn nhất + 1). */
export const getNextOrder = (items: readonly AdminCatalogItem[]): number => items.reduce((max, item) => Math.max(max, getOrder(item)), 0) + 1;

/** Sắp theo `order` rồi mục ẩn xuống cuối. */
export const sortCatalogItems = <T extends AdminCatalogItem>(items: readonly T[]): T[] =>
  [...items].sort((first, second) => Number(second.isActive) - Number(first.isActive) || getOrder(first) - getOrder(second));

/** Tên dùng khi SỬA (khu vực: tên gốc, không kèm tên cha). */
export const getItemName = (item: AdminCatalogItem): string => ('label' in item ? item.label : (item.rawName ?? item.name));

export const createEmptyDraft = (items: readonly AdminCatalogItem[]): CatalogDraft => ({
  id: null,
  name: '',
  code: '',
  order: getNextOrder(items),
  isActive: true,
  isDefault: false,
  isSystem: false,
  listGroup: 'INTERESTED',
  tone: 'brand',
  areaType: 'DISTRICT',
  parentId: '',
});

export const toDraft = (item: AdminCatalogItem): CatalogDraft => ({
  ...createEmptyDraft([]),
  id: item.id,
  name: getItemName(item),
  code: 'code' in item && item.code ? item.code : '',
  order: item.order,
  isActive: item.isActive,
  isDefault: 'isDefault' in item ? item.isDefault : false,
  isSystem: 'isSystem' in item ? item.isSystem : false,
  listGroup: 'listGroup' in item ? item.listGroup : 'INTERESTED',
  tone: 'tone' in item ? item.tone : 'brand',
  areaType: 'type' in item && item.type ? (item.type as AreaType) : 'DISTRICT',
  parentId: 'parentId' in item && item.parentId ? item.parentId : '',
});

/** Mã danh mục sinh từ tên khi tạo mới ("Hội chợ BĐS" -> "HOI_CHO_BDS"), tối đa 30 ký tự, bắt đầu bằng chữ. */
export const deriveCatalogCode = (name: string): string => {
  const slug = toSlug(name).toUpperCase().replace(/^[^A-Z]+/, '').slice(0, 30);
  return slug;
};

/** Lỗi nhập (null = hợp lệ). Trùng mã/tên do server báo (`CATALOG_DUPLICATED`). */
export const validateDraft = (kind: AdminCatalogKind, draft: CatalogDraft): string | null => {
  const name = draft.name.trim();
  if (!name) return 'Vui lòng nhập tên.';
  if (name.length > CATALOG_NAME_MAX_LENGTH) return `Tên tối đa ${CATALOG_NAME_MAX_LENGTH} ký tự.`;
  if (draft.id === null && kind !== 'areas' && !CATALOG_CODE_PATTERN.test(draft.code || deriveCatalogCode(name))) {
    return 'Không tạo được mã từ tên này. Hãy nhập tên có chữ cái (mã gồm chữ HOA, số, "_").';
  }
  if (!Number.isInteger(draft.order) || draft.order < 0 || draft.order > 10_000) return 'Thứ tự từ 0 đến 10000.';
  return null;
};

/**
 * Bản nháp -> body `POST/PATCH` (backend `forbidNonWhitelisted`): tạo mới gửi `code`; sửa KHÔNG gửi `code`;
 * tình trạng hệ thống không đổi được nhóm danh sách; khu vực đổi cha bằng `parentId` (null = về gốc).
 */
export const toCatalogBody = (kind: AdminCatalogKind, draft: CatalogDraft): Record<string, unknown> => {
  const name = draft.name.trim();
  const isNew = draft.id === null;
  if (kind === 'statuses') {
    return isNew
      ? { code: draft.code || deriveCatalogCode(name), label: name, listGroup: draft.listGroup, color: draft.tone, order: draft.order }
      : {
          label: name,
          color: draft.tone,
          order: draft.order,
          isActive: draft.isActive,
          isDefault: draft.isDefault,
          ...(draft.isSystem ? {} : { listGroup: draft.listGroup }),
        };
  }
  if (kind === 'leadSources') {
    return isNew ? { code: draft.code || deriveCatalogCode(name), label: name, order: draft.order } : { label: name, order: draft.order, isActive: draft.isActive };
  }
  return isNew
    ? { name, type: draft.areaType, order: draft.order, ...(draft.parentId ? { parentId: draft.parentId } : {}) }
    : { name, order: draft.order, isActive: draft.isActive, parentId: draft.parentId || null };
};

// ---------------------------------------------------------------------------------------------------------------------
// Cài đặt nhắc việc (`/crm/settings`, 05 §2.14)
// ---------------------------------------------------------------------------------------------------------------------

export interface SettingsDraft {
  staleCustomerDays: string;
  staleCheckTime: string;
  occasionNotifyTime: string;
  /** Nhiều giá trị cách nhau bằng dấu phẩy. */
  occasionLeadDays: string;
  defaultAppointmentReminderMinutes: string;
  careLogEditWindowHours: string;
  careLogNotifyDebounceMinutes: string;
  phoneViewAlertPerHour: string;
}

export const SETTINGS_FIELD_META: { key: keyof SettingsDraft; label: string; hint: string; kind: 'number' | 'time' | 'list' }[] = [
  { key: 'staleCustomerDays', label: 'Khách lâu chưa chăm sóc sau (ngày)', hint: '1–365 ngày', kind: 'number' },
  { key: 'staleCheckTime', label: 'Giờ quét khách lâu chưa chăm sóc', hint: 'HH:mm, giờ Việt Nam', kind: 'time' },
  { key: 'occasionLeadDays', label: 'Nhắc dịp đặc biệt trước (ngày)', hint: 'Tối đa 5 giá trị 0–30 cách nhau dấu phẩy (0 = đúng ngày)', kind: 'list' },
  { key: 'occasionNotifyTime', label: 'Giờ gửi nhắc dịp đặc biệt', hint: 'HH:mm, giờ Việt Nam', kind: 'time' },
  { key: 'defaultAppointmentReminderMinutes', label: 'Nhắc lịch hẹn trước (phút)', hint: 'Tối đa 5 giá trị 0–10080 cách nhau dấu phẩy. VD: 60, 1440', kind: 'list' },
  { key: 'careLogEditWindowHours', label: 'Cho tác giả sửa nhật ký trong (giờ)', hint: '1–168 giờ', kind: 'number' },
  { key: 'careLogNotifyDebounceMinutes', label: 'Gộp thông báo nhật ký mới trong (phút)', hint: '0–120 phút (0 = không gộp)', kind: 'number' },
  { key: 'phoneViewAlertPerHour', label: 'Cảnh báo khi xem SĐT quá (lượt/giờ)', hint: '1–10000 lượt', kind: 'number' },
];

const NUMBER_LIMITS: Record<'staleCustomerDays' | 'careLogEditWindowHours' | 'careLogNotifyDebounceMinutes' | 'phoneViewAlertPerHour', { min: number; max: number }> = {
  staleCustomerDays: { min: 1, max: 365 },
  careLogEditWindowHours: { min: 1, max: 168 },
  careLogNotifyDebounceMinutes: { min: 0, max: 120 },
  phoneViewAlertPerHour: { min: 1, max: 10_000 },
};
const LIST_LIMITS: Record<'occasionLeadDays' | 'defaultAppointmentReminderMinutes', { min: number; max: number }> = {
  occasionLeadDays: { min: 0, max: 30 },
  defaultAppointmentReminderMinutes: { min: 0, max: 10_080 },
};
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const MAX_LIST_ITEMS = 5;

export const toSettingsDraft = (settings: CrmSettings): SettingsDraft => ({
  staleCustomerDays: String(settings.staleCustomerDays),
  staleCheckTime: settings.staleCheckTime,
  occasionNotifyTime: settings.occasionNotifyTime,
  occasionLeadDays: settings.occasionLeadDays.join(', '),
  defaultAppointmentReminderMinutes: settings.defaultAppointmentReminderMinutes.join(', '),
  careLogEditWindowHours: String(settings.careLogEditWindowHours),
  careLogNotifyDebounceMinutes: String(settings.careLogNotifyDebounceMinutes),
  phoneViewAlertPerHour: String(settings.phoneViewAlertPerHour),
});

/** "60, 1440" -> [60, 1440]; phần tử không phải số nguyên -> NaN (bị validate bắt). */
export const parseNumberList = (text: string): number[] =>
  text
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => (/^\d+$/.test(part) ? Number(part) : Number.NaN));

/** Kiểm bản nháp; trả lỗi đầu tiên (tiếng Việt) hoặc `{ value }` đã chuyển kiểu để gửi API. */
export const parseSettingsDraft = (draft: SettingsDraft): { error: string } | { value: CrmSettings } => {
  const value = {} as CrmSettings;
  for (const meta of SETTINGS_FIELD_META) {
    const raw = draft[meta.key];
    if (meta.kind === 'time') {
      if (!TIME_PATTERN.test(raw.trim())) return { error: `${meta.label}: giờ phải có dạng HH:mm (00:00 – 23:59).` };
      (value as unknown as Record<string, unknown>)[meta.key] = raw.trim();
    } else if (meta.kind === 'number') {
      const limit = NUMBER_LIMITS[meta.key as keyof typeof NUMBER_LIMITS];
      const number = Number(raw);
      if (!raw.trim() || !Number.isInteger(number) || number < limit.min || number > limit.max) return { error: `${meta.label}: nhập số nguyên từ ${limit.min} đến ${limit.max}.` };
      (value as unknown as Record<string, unknown>)[meta.key] = number;
    } else {
      const limit = LIST_LIMITS[meta.key as keyof typeof LIST_LIMITS];
      const numbers = parseNumberList(raw);
      const isValid = numbers.length >= 1 && numbers.length <= MAX_LIST_ITEMS && new Set(numbers).size === numbers.length && numbers.every((item) => Number.isInteger(item) && item >= limit.min && item <= limit.max);
      if (!isValid) return { error: `${meta.label}: nhập 1–${MAX_LIST_ITEMS} số khác nhau từ ${limit.min} đến ${limit.max}, cách nhau dấu phẩy.` };
      (value as unknown as Record<string, unknown>)[meta.key] = numbers;
    }
  }
  return { value };
};

/** Chỉ gửi trường đã đổi so với cấu hình hiện tại. */
export const diffSettings = (current: CrmSettings, next: CrmSettings): Partial<CrmSettings> =>
  Object.fromEntries((Object.keys(next) as (keyof CrmSettings)[]).filter((key) => JSON.stringify(current[key]) !== JSON.stringify(next[key])).map((key) => [key, next[key]])) as Partial<CrmSettings>;

// ---------------------------------------------------------------------------------------------------------------------
// Tài khoản, nhóm
// ---------------------------------------------------------------------------------------------------------------------

export const USER_PASSWORD_MIN_LENGTH = 8;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface NewUserDraft {
  email: string;
  password: string;
  displayName: string;
  role: 'MANAGER' | 'STAFF' | 'ADMIN';
  teamId: string;
}

export const createEmptyUserDraft = (teamId: string): NewUserDraft => ({ email: '', password: '', displayName: '', role: 'STAFF', teamId });

/** Lỗi tạo tài khoản (null = hợp lệ). Vai trò Quản trị không gắn nhóm; Quản lý/Nhân viên cần nhóm để có phạm vi dữ liệu. */
export const validateNewUser = (draft: NewUserDraft): string | null => {
  if (!EMAIL_PATTERN.test(draft.email.trim())) return 'Email không hợp lệ.';
  if (draft.password.length < USER_PASSWORD_MIN_LENGTH) return `Mật khẩu tối thiểu ${USER_PASSWORD_MIN_LENGTH} ký tự.`;
  if (!draft.displayName.trim()) return 'Vui lòng nhập tên hiển thị.';
  if (draft.role !== 'ADMIN' && !draft.teamId) return 'Chọn nhóm cho Quản lý/Nhân viên.';
  return null;
};

export interface TeamDraft {
  id: string | null;
  name: string;
  code: string;
  managerIds: string[];
  isActive: boolean;
}

export const TEAM_CODE_PATTERN = /^[A-Za-z0-9_-]{1,20}$/;

export const validateTeam = (draft: TeamDraft): string | null => {
  if (!draft.name.trim()) return 'Vui lòng nhập tên nhóm.';
  if (draft.id === null && !TEAM_CODE_PATTERN.test(draft.code.trim())) return 'Mã nhóm gồm chữ không dấu, số, "-" hoặc "_", tối đa 20 ký tự.';
  return null;
};
