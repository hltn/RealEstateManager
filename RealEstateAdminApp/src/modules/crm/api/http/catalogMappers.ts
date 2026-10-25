/**
 * Mapper danh mục: response backend -> kiểu danh mục của UI (`@crm/types/crm`).
 * Hàm thuần, không đọc store/mạng -> test được.
 */
import type {
  Area,
  CatalogItem,
  ContactResult,
  CrmSettings,
  CrmUser,
  CustomerStatusItem,
  PersonaFieldDefinition,
  PersonaGroupCode,
  Project,
  StatusRef,
  StatusTone,
  Tag,
  Team,
} from '@crm/types/crm';
import type { AreaDto, AssignableUserDto, ContactResultDto, CrmSettingsDto, CustomerStatusDto, LeadSourceDto, PersonaFieldDto, ProjectDto, StatusRefDto, TagDto, TeamDto, UserDto } from './dto';

const STATUS_TONES: readonly StatusTone[] = ['gray', 'success', 'warning', 'error', 'brand'];

/** `color` của backend là chuỗi tự do (tên màu thiết kế); ngoài danh sách -> xám. */
export const toStatusTone = (color: string | null | undefined): StatusTone => (STATUS_TONES.includes(color as StatusTone) ? (color as StatusTone) : 'gray');

export const toStatusRef = (dto: StatusRefDto): StatusRef => ({ id: dto.id, code: dto.code, label: dto.label, listGroup: dto.listGroup, tone: toStatusTone(dto.color) });

export const toStatusItem = (dto: CustomerStatusDto): CustomerStatusItem => ({
  id: dto.id,
  code: dto.code,
  label: dto.label,
  listGroup: dto.listGroup,
  tone: toStatusTone(dto.color),
  order: dto.order,
  isDefault: dto.isDefault,
  isSystem: dto.isSystem,
  isActive: dto.isActive,
});

export const toCatalogItem = (dto: LeadSourceDto): CatalogItem => ({ id: dto.id, code: dto.code, label: dto.label, order: dto.order, isActive: dto.isActive });

export const toContactResult = (dto: ContactResultDto): ContactResult => ({
  id: dto.id,
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
  return { id: dto.id, name: parent ? `${dto.name} · ${parent}` : dto.name, rawName: dto.name, type: dto.type, parentId: dto.parentId, order: dto.order, isActive: dto.isActive };
};

/**
 * Dự án: backend không có tên đầy đủ/đơn vị giá/phân khúc -> `fullName` = `name`, `priceUnit` = TOTAL, `segment` rỗng.
 */
export const toProject = (dto: ProjectDto): Project => ({
  id: dto.id,
  code: dto.code,
  name: dto.name,
  fullName: dto.name,
  developer: dto.developer ?? '',
  location: dto.location ?? '',
  areaId: dto.area?.id ?? null,
  propertyTypes: dto.propertyTypes ?? [],
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

/** Người có thể phân chăm sóc (assignable-users) -> `CrmUser` dùng cho ô chọn/bộ lọc. */
export const assignableToUser = (dto: AssignableUserDto): CrmUser => ({
  id: dto.id,
  fullName: dto.displayName,
  displayName: dto.displayName,
  role: dto.role,
  jobTitle: '',
  teamId: dto.team?.id ?? null,
  teamName: dto.team?.label,
  isActive: true,
});

/** Tài khoản từ `GET /users` (chỉ Quản trị) -> `CrmUser`. */
export const userDtoToUser = (dto: UserDto): CrmUser => ({
  id: dto._id,
  fullName: dto.displayName,
  displayName: dto.displayName,
  role: dto.role === 'EDITOR' ? 'STAFF' : dto.role,
  jobTitle: '',
  teamId: dto.teamId,
  isActive: dto.status === 'ACTIVE',
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
