/**
 * Quy tắc quản trị danh mục / người dùng / cài đặt (X7 — 05 §2.2, §2.8, §2.14). Hàm thuần, dùng chung cho mock API và UI.
 * KHÔNG xoá cứng: mục đang/đã dùng chỉ được ẩn (`isActive = false`) để dữ liệu cũ vẫn hiển thị đúng.
 */
import { LIST_GROUP_LABELS } from '@crm/lib/customerRules';
import { getFirstProjectError, getProjectErrors } from '@crm/lib/projectRules';
import { normalizeVietnamese } from '@crm/lib/text';
import type { CatalogKind, CrmDataState } from '@crm/store/crmReducer';
import type { CrmCatalogs, CrmSettings, CrmUser } from '@crm/types/crm';

export type AdminCatalogKind = Extract<CatalogKind, 'statuses' | 'leadSources' | 'areas' | 'projects'>;

type AnyCatalogItem = CrmCatalogs[CatalogKind][number];

export const CATALOG_NAME_MAX_LENGTH = 80;

/** Tên hiển thị của 1 mục danh mục (status/source dùng `label`, area/project/tag dùng `name`). */
export const getCatalogItemName = (item: AnyCatalogItem): string => ('label' in item ? item.label : item.name);

/** Số khách đang dùng mục danh mục (để cảnh báo trước khi ẩn). */
export const countCatalogUsage = (state: CrmDataState, kind: CatalogKind, itemId: string): number => {
  switch (kind) {
    case 'statuses':
      return state.customers.filter((customer) => customer.statusId === itemId).length;
    case 'leadSources':
      return state.customers.filter((customer) => customer.sourceId === itemId).length;
    case 'areas':
      return state.customers.filter((customer) => customer.areaId === itemId).length;
    case 'projects':
      return state.customers.filter((customer) => customer.interestedProjectIds.includes(itemId)).length;
    case 'tags':
      return state.customers.filter((customer) => customer.tagIds.includes(itemId)).length;
    default:
      return state.careLogs.filter((log) => log.contactResultId === itemId).length;
  }
};

/** Lỗi nghiệp vụ khi lưu 1 mục danh mục; null = hợp lệ. */
export const validateCatalogItem = (catalogs: CrmCatalogs, kind: CatalogKind, item: AnyCatalogItem): string | null => {
  // Dự án: quy tắc riêng theo từng trường (tên + mã bắt buộc, không trùng) — dùng chung với dialog ở màn Dự án.
  if (kind === 'projects' && 'code' in item && 'fullName' in item) return getFirstProjectError(getProjectErrors(catalogs.projects, item));
  const name = getCatalogItemName(item).trim();
  if (!name) return 'Vui lòng nhập tên.';
  if (name.length > CATALOG_NAME_MAX_LENGTH) return `Tên tối đa ${CATALOG_NAME_MAX_LENGTH} ký tự.`;
  const items = catalogs[kind] as readonly AnyCatalogItem[];
  const isDuplicate = items.some(
    (other) => other.id !== item.id && normalizeVietnamese(getCatalogItemName(other).trim()) === normalizeVietnamese(name),
  );
  if (isDuplicate) return `Đã có mục "${name}" trong danh mục.`;
  if (kind === 'statuses' && 'listGroup' in item && item.isDefault && item.listGroup !== 'NOT_CONTACTED') return `Tình trạng mặc định phải thuộc danh sách "${LIST_GROUP_LABELS.NOT_CONTACTED}".`;
  if (kind === 'statuses' && 'listGroup' in item && !item.isActive) {
    if (item.isDefault) return 'Không thể ẩn tình trạng mặc định cho khách mới.';
    const previous = catalogs.statuses.find((status) => status.id === item.id);
    const remainingInGroup = catalogs.statuses.filter((status) => status.id !== item.id && status.isActive && status.listGroup === item.listGroup);
    if (previous?.isActive && remainingInGroup.length === 0) return `Mỗi danh sách (${Object.values(LIST_GROUP_LABELS).join(' / ')}) cần ít nhất 1 tình trạng đang dùng.`;
  }
  return null;
};

/** Lỗi khi lưu người dùng; null = hợp lệ. `actorId` = Quản trị đang thao tác (chặn tự khoá mình). */
export const validateUser = (state: CrmDataState, user: CrmUser, actorId: string): string | null => {
  if (!user.fullName.trim()) return 'Vui lòng nhập họ tên.';
  if (!user.displayName.trim()) return 'Vui lòng nhập tên hiển thị.';
  if (user.role !== 'ADMIN' && !user.teamId) return 'Quản lý / Nhân viên phải thuộc một nhóm.';
  if (user.teamId && !state.teams.some((team) => team.id === user.teamId)) return 'Nhóm không tồn tại.';
  if (user.id === actorId) {
    if (!user.isActive) return 'Không thể tự khoá tài khoản đang đăng nhập.';
    if (user.role !== 'ADMIN') return 'Không thể tự hạ quyền Quản trị của chính mình.';
  }
  // Khoá HOẶC chuyển sang Quản trị đều làm người này không còn được phân chăm sóc (assertAssignableUsers).
  if (!user.isActive || user.role === 'ADMIN') {
    const primaryCount = state.customers.filter((customer) => customer.primaryAssigneeId === user.id).length;
    if (primaryCount > 0) return `Người này đang phụ trách chính ${primaryCount} khách — chuyển phụ trách chính trước khi khoá hoặc đổi sang Quản trị.`;
  }
  return null;
};

export const SETTINGS_LIMITS: Record<keyof CrmSettings, { min: number; max: number; label: string }> = {
  staleCustomerDays: { min: 1, max: 365, label: 'Số ngày không chăm sóc thì nhắc' },
  occasionLeadDays: { min: 0, max: 60, label: 'Nhắc dịp đặc biệt trước' },
  upcomingDays: { min: 1, max: 60, label: 'Số ngày hiển thị việc "Sắp tới"' },
};

export const validateSettings = (changes: Partial<CrmSettings>): string | null => {
  for (const key of Object.keys(changes) as (keyof CrmSettings)[]) {
    const value = changes[key];
    const limit = SETTINGS_LIMITS[key];
    if (!limit || value === undefined) continue;
    if (!Number.isInteger(value) || value < limit.min || value > limit.max) return `${limit.label}: số nguyên từ ${limit.min} đến ${limit.max}.`;
  }
  return null;
};
