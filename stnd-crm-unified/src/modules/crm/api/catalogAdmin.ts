/**
 * Quy tắc quản trị danh mục / cài đặt (X7 — 05 §2.2, §2.8, §2.14), mô phỏng phía máy chủ cho prototype. Hàm thuần, dùng chung cho mock API.
 * KHÔNG xoá cứng: mục đang/đã dùng chỉ được ẩn (`isActive = false`) để dữ liệu cũ vẫn hiển thị đúng.
 * [Prototype] Mã lỗi/thông điệp bám backend (`CATALOG_DUPLICATED`, `VALIDATION_FAILED`...) để màn Cài đặt hiện đúng như app chính.
 */
import { LIST_GROUP_LABELS } from '@crm/lib/customerRules';
import { normalizeVietnamese } from '@crm/lib/text';
import type { CatalogKind, CrmDataState } from '@crm/store/crmReducer';
import type { CrmCatalogs, CrmSettings } from '@crm/types/crm';

type AnyCatalogItem = CrmCatalogs[CatalogKind][number];

export const CATALOG_NAME_MAX_LENGTH = 100;

/** Tên hiển thị của 1 mục danh mục (status/source/contactResult dùng `label`, area/project/tag dùng `name`). */
export const getCatalogItemName = (item: AnyCatalogItem): string => ('label' in item ? item.label : item.name);

/** Số khách đang dùng mục danh mục (để cảnh báo trước khi ẩn). Không tính khách đã xóa mềm. */
export const countCatalogUsage = (state: CrmDataState, kind: CatalogKind, itemId: string): number => {
  const customers = state.customers.filter((customer) => !customer.deletedAt);
  switch (kind) {
    case 'statuses':
      return customers.filter((customer) => customer.statusId === itemId).length;
    case 'leadSources':
      return customers.filter((customer) => customer.sourceId === itemId).length;
    case 'areas':
      return customers.filter((customer) => customer.areaId === itemId).length;
    case 'projects':
      return customers.filter((customer) => customer.interestedProjectIds.includes(itemId)).length;
    case 'tags':
      return customers.filter((customer) => customer.tagIds.includes(itemId)).length;
    default:
      return state.careLogs.filter((log) => log.contactResultId === itemId).length;
  }
};

/**
 * Lỗi nghiệp vụ khi lưu 1 mục danh mục (tình trạng/nguồn/khu vực/kết quả liên hệ); null = hợp lệ.
 * Trả `{ isDuplicate: true }` khi trùng tên để API đổi sang 409 `CATALOG_DUPLICATED` như backend.
 */
export const validateCatalogItem = (catalogs: CrmCatalogs, kind: CatalogKind, item: AnyCatalogItem): { message: string; isDuplicate?: boolean } | null => {
  const name = getCatalogItemName(item).trim();
  if (!name) return { message: 'Vui lòng nhập tên.' };
  if (name.length > CATALOG_NAME_MAX_LENGTH) return { message: `Tên tối đa ${CATALOG_NAME_MAX_LENGTH} ký tự.` };
  const items = catalogs[kind] as readonly AnyCatalogItem[];
  const isDuplicate = items.some((other) => other.id !== item.id && normalizeVietnamese(getCatalogItemName(other).trim()) === normalizeVietnamese(name));
  if (isDuplicate) return { message: `Đã có mục "${name}" trong danh mục.`, isDuplicate: true };
  if (kind === 'statuses' && 'listGroup' in item && item.isDefault && item.listGroup !== 'NOT_CONTACTED') {
    return { message: `Tình trạng mặc định phải thuộc danh sách "${LIST_GROUP_LABELS.NOT_CONTACTED}".` };
  }
  if (kind === 'statuses' && 'listGroup' in item && !item.isActive) {
    if (item.isDefault) return { message: 'Không thể ẩn tình trạng mặc định cho khách mới.' };
    const previous = catalogs.statuses.find((status) => status.id === item.id);
    const remainingInGroup = catalogs.statuses.filter((status) => status.id !== item.id && status.isActive && status.listGroup === item.listGroup);
    if (previous?.isActive && remainingInGroup.length === 0) {
      return { message: `Mỗi danh sách (${Object.values(LIST_GROUP_LABELS).join(' / ')}) cần ít nhất 1 tình trạng đang dùng.` };
    }
  }
  return null;
};

/** Giới hạn cấu hình nhắc việc (khớp `SETTINGS_FIELD_META`/`parseSettingsDraft` của màn Cài đặt và backend `crm-settings`). */
export const SETTINGS_LIMITS: Partial<Record<keyof CrmSettings, { min: number; max: number; label: string }>> = {
  staleCustomerDays: { min: 1, max: 365, label: 'Khách lâu chưa chăm sóc sau (ngày)' },
  careLogEditWindowHours: { min: 1, max: 168, label: 'Cho tác giả sửa nhật ký trong (giờ)' },
  careLogNotifyDebounceMinutes: { min: 0, max: 120, label: 'Gộp thông báo nhật ký mới trong (phút)' },
  phoneViewAlertPerHour: { min: 1, max: 10_000, label: 'Cảnh báo khi xem SĐT quá (lượt/giờ)' },
};

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export const validateSettings = (changes: Partial<CrmSettings>): string | null => {
  for (const key of Object.keys(changes) as (keyof CrmSettings)[]) {
    const value = changes[key];
    const limit = SETTINGS_LIMITS[key];
    if (limit && typeof value === 'number' && (!Number.isInteger(value) || value < limit.min || value > limit.max)) return `${limit.label}: số nguyên từ ${limit.min} đến ${limit.max}.`;
    if ((key === 'staleCheckTime' || key === 'occasionNotifyTime') && (typeof value !== 'string' || !TIME_PATTERN.test(value))) return 'Giờ phải có dạng HH:mm (00:00 – 23:59).';
    if ((key === 'occasionLeadDays' || key === 'defaultAppointmentReminderMinutes') && (!Array.isArray(value) || value.length < 1 || value.length > 5)) return 'Nhập 1–5 giá trị.';
  }
  return null;
};
