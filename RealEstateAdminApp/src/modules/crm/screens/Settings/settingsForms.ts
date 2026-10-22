/**
 * Hàm thuần của màn Cài đặt CRM (X7): tab, lựa chọn, tạo mục rỗng, sắp xếp. Không phụ thuộc React -> test trực tiếp.
 */
import type { AdminCatalogKind } from '@crm/api';
import { LIST_GROUP_LABELS } from '@crm/lib/customerRules';
import { ROLE_LABELS } from '@crm/lib/roles';
import { createEmptyProject, normalizeProject } from '@crm/lib/projectRules';
import { toSlug } from '@crm/lib/text';
import type { Area, CatalogItem, CrmUser, CustomerStatusItem, ListGroup, Project, StatusTone, UserRole } from '@crm/types/crm';

export type SettingsTab = AdminCatalogKind | 'users' | 'reminders';

export const SETTINGS_TABS: { id: SettingsTab; label: string }[] = [
  { id: 'statuses', label: 'Tình trạng khách' },
  { id: 'leadSources', label: 'Nguồn khách' },
  { id: 'areas', label: 'Khu vực' },
  { id: 'projects', label: 'Dự án' },
  { id: 'users', label: 'Người dùng' },
  { id: 'reminders', label: 'Nhắc việc' },
];

export const STATUS_TONE_OPTIONS: { value: StatusTone; label: string }[] = [
  { value: 'gray', label: 'Xám' },
  { value: 'brand', label: 'Xanh dương' },
  { value: 'success', label: 'Xanh lá' },
  { value: 'warning', label: 'Vàng cam' },
  { value: 'error', label: 'Đỏ' },
];

export const LIST_GROUP_OPTIONS = (Object.keys(LIST_GROUP_LABELS) as ListGroup[]).map((value) => ({ value, label: LIST_GROUP_LABELS[value] }));

export const ROLE_OPTIONS = (Object.keys(ROLE_LABELS) as UserRole[]).map((value) => ({ value, label: ROLE_LABELS[value] }));

export type AdminCatalogItem = CustomerStatusItem | CatalogItem | Area | Project;

const getOrder = (item: AdminCatalogItem): number => ('order' in item ? item.order : 0);

/** Thứ tự kế tiếp (lớn nhất + 1). */
export const getNextOrder = (items: readonly AdminCatalogItem[]): number => items.reduce((max, item) => Math.max(max, getOrder(item)), 0) + 1;

/** Sắp theo `order` (nếu có) rồi theo tên. Dự án giữ thứ tự danh mục. Mục ẩn xếp cuối. */
export const sortCatalogItems = <T extends AdminCatalogItem>(items: readonly T[]): T[] =>
  [...items].sort((first, second) => Number(second.isActive) - Number(first.isActive) || getOrder(first) - getOrder(second));

/** Mục rỗng cho nút "Thêm". */
export const createEmptyCatalogItem = (kind: AdminCatalogKind, items: readonly AdminCatalogItem[], id: string): AdminCatalogItem => {
  const order = getNextOrder(items);
  switch (kind) {
    case 'statuses':
      return { id, code: '', label: '', listGroup: 'INTERESTED', tone: 'brand', order, isDefault: false, isSystem: false, isActive: true };
    case 'leadSources':
      return { id, label: '', order, isActive: true };
    case 'areas':
      return { id, name: '', order, isActive: true };
    default:
      return createEmptyProject(id);
  }
};

/** Chuẩn hoá trước khi lưu: cắt khoảng trắng; tình trạng mới tự sinh `code` từ tên. */
export const normalizeCatalogItem = (kind: AdminCatalogKind, item: AdminCatalogItem): AdminCatalogItem => {
  if (kind === 'statuses' && 'listGroup' in item) {
    const label = item.label.trim();
    return { ...item, label, code: item.code || toSlug(label).toUpperCase() };
  }
  if (kind === 'projects' && 'fullName' in item) {
    return normalizeProject(item);
  }
  if ('label' in item) return { ...item, label: item.label.trim() };
  return { ...item, name: item.name.trim() };
};

/** Tên hiển thị ngắn mặc định = từ cuối của họ tên ("Trần Mỹ Hạnh" -> "Hạnh"). */
export const deriveDisplayName = (fullName: string): string => fullName.trim().split(/\s+/).pop() ?? '';

export const createEmptyUser = (id: string, teamId: string | null): CrmUser => ({
  id,
  fullName: '',
  displayName: '',
  role: 'STAFF',
  jobTitle: 'Nhân viên kinh doanh',
  teamId,
  isActive: true,
});

/** Chuẩn hoá người dùng trước khi lưu; Quản trị không gắn nhóm. */
export const normalizeUser = (user: CrmUser): CrmUser => {
  const fullName = user.fullName.trim().replace(/\s+/g, ' ');
  return {
    ...user,
    fullName,
    displayName: user.displayName.trim() || deriveDisplayName(fullName),
    jobTitle: user.jobTitle.trim(),
    teamId: user.role === 'ADMIN' ? null : user.teamId,
  };
};
