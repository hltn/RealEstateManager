/**
 * Mapper danh mục: response backend -> kiểu danh mục của UI (`@crm/types/crm`).
 * Hàm thuần, không đọc store/mạng -> test được.
 */
import type {
  AdminUser,
  Area,
  CatalogItem,
  ContactResult,
  CrmSettings,
  CrmUser,
  CustomerStatusItem,
  PersonaFieldDefinition,
  PersonaGroupCode,
  Project,
  Ref,
  StatusRef,
  StatusTone,
  Tag,
  Team,
  TeamMember,
  UserRole,
} from '@crm/types/crm';
import { rolesOf } from '../../../../utils/userRoles';
import { rememberCatalogId, toUiCatalogId, type CatalogKind } from './catalogIds';
import type { AreaDto, CustomerAssigneeDto, CatalogRefDto, ContactResultDto, CrmSettingsDto, CustomerStatusDto, LeadSourceDto, PersonaFieldDto, ProjectDto, StatusRefDto, TagDto, TeamDto, TeamMemberDto, UserDto } from './dto';

const STATUS_TONES: readonly StatusTone[] = ['gray', 'success', 'warning', 'error', 'brand'];

/** `color` của backend là chuỗi tự do (tên màu thiết kế); ngoài danh sách -> xám. */
export const toStatusTone = (color: string | null | undefined): StatusTone => (STATUS_TONES.includes(color as StatusTone) ? (color as StatusTone) : 'gray');

/**
 * Tham chiếu danh mục (nguồn, khu vực, dự án, kết quả liên hệ) -> `Ref` của UI với id = `code` (FR-40).
 * Backend chưa trả `code` (bản ghi chưa migrate): dùng id cũ để UI không lỗi.
 */
export const toCatalogRef = (kind: CatalogKind, dto: CatalogRefDto): Ref => ({
  id: dto.code ? rememberCatalogId(kind, dto.id, dto.code) : toUiCatalogId(kind, dto.id),
  label: dto.label,
});

/** Giống `toCatalogRef` cho trường có thể null. */
export const toNullableCatalogRef = (kind: CatalogKind, dto: CatalogRefDto | null | undefined): Ref | null => (dto ? toCatalogRef(kind, dto) : null);

export const toStatusRef = (dto: StatusRefDto): StatusRef => ({ id: rememberCatalogId('statuses', dto.id, dto.code), code: dto.code, label: dto.label, listGroup: dto.listGroup, tone: toStatusTone(dto.color) });

export const toStatusItem = (dto: CustomerStatusDto): CustomerStatusItem => ({
  id: rememberCatalogId('statuses', dto.id, dto.code),
  code: dto.code,
  label: dto.label,
  listGroup: dto.listGroup,
  tone: toStatusTone(dto.color),
  order: dto.order,
  isDefault: dto.isDefault,
  isSystem: dto.isSystem,
  isActive: dto.isActive,
});

export const toCatalogItem = (dto: LeadSourceDto): CatalogItem => ({ id: rememberCatalogId('leadSources', dto.id, dto.code), code: dto.code, label: dto.label, order: dto.order, isActive: dto.isActive });

export const toContactResult = (dto: ContactResultDto): ContactResult => ({
  id: rememberCatalogId('contactResults', dto.id, dto.code),
  label: dto.label,
  suggestedFollowUpDays: dto.suggestedFollowUpDays,
  suggestionText: dto.suggestionText,
  order: dto.order,
  isActive: dto.isActive,
});

/**
 * Khu vực: UI dùng danh sách phẳng. Gắn tên cha để phân biệt cùng tên ("Quận 1 · TP.HCM"); `parentLabel` rỗng với khu vực gốc.
 */
export const toArea = (dto: AreaDto): Area => {
  const parent = dto.path.length > 0 ? dto.path[dto.path.length - 1].label : '';
  return {
    id: rememberCatalogId('areas', dto.id, dto.code),
    name: parent ? `${dto.name} · ${parent}` : dto.name,
    rawName: dto.name,
    type: dto.type,
    // `parentId` của UI cũng là `code` của khu vực cha (cây khu vực dựng theo id của UI).
    parentId: dto.parentId ? toUiCatalogId('areas', dto.parentId) : null,
    order: dto.order,
    isActive: dto.isActive,
  };
};

/** Cả danh sách: ghi nhớ id <-> code của mọi khu vực TRƯỚC khi đổi `parentId` (cha có thể đứng sau con). */
export const toAreaList = (dtos: readonly AreaDto[]): Area[] => {
  dtos.forEach((dto) => rememberCatalogId('areas', dto.id, dto.code));
  return dtos.map(toArea);
};

/**
 * Dự án: backend không có tên đầy đủ/đơn vị giá/phân khúc -> `fullName` = `name`, `priceUnit` = TOTAL, `segment` rỗng.
 */
/** Chuẩn hóa mã dự án như backend (`codeNormalized`): bỏ khoảng trắng đầu/cuối, chữ HOA. */
export const normalizeProjectCode = (code: string): string => code.trim().toUpperCase();

export const toProject = (dto: ProjectDto): Project => ({
  // id của UI = `codeNormalized` (khóa tham chiếu của backend); `code` giữ chữ người nhập để hiển thị.
  id: rememberCatalogId('projects', dto.id, normalizeProjectCode(dto.code)),
  code: dto.code,
  name: dto.name,
  fullName: dto.name,
  developer: dto.developer ?? '',
  location: dto.location ?? '',
  areaId: dto.areaCode ?? (dto.area ? toCatalogRef('areas', dto.area).id : null),
  propertyTypes: dto.propertyTypes ?? [],
  ...(dto.propertyTypeCodes ? { propertyTypeCodes: dto.propertyTypeCodes } : {}),
  ...(dto.unmappedPropertyTypes ? { unmappedPropertyTypes: dto.unmappedPropertyTypes } : {}),
  priceFrom: dto.priceFrom,
  priceTo: dto.priceTo,
  priceUnit: 'TOTAL',
  status: dto.status,
  segment: '',
  isActive: dto.isActive,
  deletedAt: dto.deletedAt,
});

export const toTag = (dto: TagDto): Tag => ({ id: dto.id, name: dto.label, category: dto.category, isActive: true });

const PERSONA_GROUPS: readonly PersonaGroupCode[] = ['PERSONAL', 'OCCUPATION', 'LIFESTYLE', 'OCCASION', 'FAMILY', 'CONTACT', 'REAL_ESTATE'];

/** Nhóm chân dung lạ (Quản trị thêm nhóm mới trong tương lai) -> gom vào "Cá nhân" thay vì mất trường. */
export const toPersonaGroupCode = (groupCode: string): PersonaGroupCode => (PERSONA_GROUPS.includes(groupCode as PersonaGroupCode) ? (groupCode as PersonaGroupCode) : 'PERSONAL');

/**
 * Trường chân dung: UI làm việc với NHÃN lựa chọn (`options: string[]`); `optionItems` giữ cặp mã/nhãn để đổi qua lại khi gọi API
 * (backend lưu và nhận MÃ lựa chọn). Lựa chọn đã tắt chỉ giữ trong `optionItems` (để đọc giá trị cũ), không hiện khi chọn mới.
 */
export const toPersonaField = (dto: PersonaFieldDto): PersonaFieldDefinition => ({
  key: dto.key,
  label: dto.label,
  groupCode: toPersonaGroupCode(dto.groupCode),
  type: dto.type,
  options: dto.options.filter((option) => option.isActive).map((option) => option.label),
  optionItems: dto.options.map((option) => ({ value: option.value, label: option.label, isActive: option.isActive })),
  placeholder: dto.placeholder ?? dto.helpText ?? undefined,
  weight: dto.weight,
  suggestPriority: dto.suggestPriority,
  isFilterable: dto.isFilterable,
  isOccasion: dto.isOccasion,
  occasionLabel: dto.occasionLabel ?? undefined,
  linkedCriterion: dto.linkedCriterion,
  isSensitive: dto.isSensitive,
  isActive: dto.isActive,
});

/** Role CRM của UI: chỉ ADMIN/MANAGER/STAFF; EDITOR (ngang STAFF, không có quyền CRM) và giá trị lạ -> STAFF. */
export const toCrmRole = (role: string | undefined): UserRole => (role === 'ADMIN' || role === 'MANAGER' ? role : 'STAFF');

/** Người trong bộ lọc phụ trách (`customer-assignees`) -> `CrmUser`. */
export const assigneeToUser = (dto: CustomerAssigneeDto): CrmUser => ({
  id: dto.id,
  fullName: dto.displayName,
  displayName: dto.displayName,
  role: toCrmRole(dto.role),
  jobTitle: '',
  teamId: dto.team?.id ?? null,
  teamName: dto.team?.label,
  isActive: true,
  isLocked: dto.isLocked ?? false,
});

/** Tài khoản từ `/users` (chỉ Quản trị) -> `AdminUser` (EDITOR ngang STAFF nên `role` EDITOR đổi thành STAFF; `roles` giữ nguyên EDITOR). */
export const userDtoToUser = (dto: UserDto): AdminUser => ({
  id: dto._id,
  fullName: dto.displayName,
  displayName: dto.displayName,
  role: dto.role === 'EDITOR' ? 'STAFF' : dto.role,
  jobTitle: '',
  teamId: dto.teamId,
  isActive: dto.status === 'ACTIVE',
  roles: rolesOf(dto),
  teamIds: dto.teamIds ?? (dto.teamId ? [dto.teamId] : []),
});

export const toTeamMember = (dto: TeamMemberDto): TeamMember => ({
  id: dto.id,
  displayName: dto.displayName,
  role: dto.role,
  roles: dto.roles?.length ? dto.roles : [dto.role],
  isActive: dto.status === 'ACTIVE',
  isManager: dto.isManager,
});

export const toTeam = (dto: TeamDto): Team & { code: string; memberCount: number; isActive: boolean } => ({
  id: dto.id,
  name: dto.name,
  managerIds: dto.managers.map((manager) => manager.id),
  code: dto.code,
  memberCount: dto.memberCount,
  isActive: dto.isActive,
});

export const toCrmSettings = (dto: CrmSettingsDto): CrmSettings => ({
  staleCustomerDays: dto.staleCustomerDays,
  staleCheckTime: dto.staleCheckTime,
  occasionNotifyTime: dto.occasionNotifyTime,
  occasionLeadDays: dto.occasionLeadDays,
  defaultAppointmentReminderMinutes: dto.defaultAppointmentReminderMinutes,
  careLogEditWindowHours: dto.careLogEditWindowHours,
  careLogNotifyDebounceMinutes: dto.careLogNotifyDebounceMinutes,
  phoneViewAlertPerHour: dto.phoneViewAlertPerHour,
});

/** Đổi nhãn lựa chọn (UI) <-> mã lựa chọn (API) theo định nghĩa trường. */
export const optionLabelToValue = (field: Pick<PersonaFieldDefinition, 'optionItems'>, label: string): string | undefined =>
  field.optionItems?.find((option) => option.label === label)?.value;

export const optionValueToLabel = (field: Pick<PersonaFieldDefinition, 'optionItems'>, value: string): string =>
  field.optionItems?.find((option) => option.value === value)?.label ?? value;
