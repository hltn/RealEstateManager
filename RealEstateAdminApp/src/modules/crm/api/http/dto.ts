/**
 * Kiểu response THÔ của backend CRM (đối chiếu DTO ở `RealEstateBackendApp/src/modules/crm/**` và tài liệu 05 §1.6).
 * Chỉ dùng trong lớp `api/http`; UI làm việc với view-type ở `../types.ts` (qua mapper).
 */
import type { AppointmentStatus, AppointmentType, ContactChannel, DailyTaskGroup, DailyTaskKind, ListGroup, PersonaFieldType, TagCategory } from '@crm/types/crm';

export interface RefDto {
  id: string;
  label: string;
}

/** `Ref` của danh mục có `code` bất biến (FR-40). `code` tùy chọn: bản ghi chưa migrate thì backend chưa trả. */
export interface CatalogRefDto extends RefDto {
  code?: string;
}

export interface UserRefDto {
  id: string;
  displayName: string;
  /** Chỉ có ở người chăm sóc chính/thành viên nhóm chăm sóc (v1.0.5). */
  isLocked?: boolean;
}

export interface StatusRefDto {
  id: string;
  code: string;
  label: string;
  listGroup: ListGroup;
  color: string | null;
}

// --- Danh mục ---------------------------------------------------------------------------------------------------------

export interface CustomerStatusDto extends StatusRefDto {
  order: number;
  isDefault: boolean;
  isSystem: boolean;
  isActive: boolean;
}

export interface LeadSourceDto {
  id: string;
  label: string;
  code: string;
  order: number;
  isActive: boolean;
}

export interface ContactResultDto extends LeadSourceDto {
  suggestedFollowUpDays: number | null;
  suggestionText: string;
}

export interface AreaDto {
  id: string;
  label: string;
  name: string;
  type: string;
  parentId: string | null;
  path: RefDto[];
  /** Mã bất biến (FR-40); thiếu ở bản ghi chưa migrate. */
  code?: string;
  adminCode: string | null;
  isLegacy: boolean;
  order: number;
  isActive: boolean;
}

export interface ProjectDto {
  id: string;
  name: string;
  code: string;
  developer: string | null;
  location: string | null;
  area: CatalogRefDto | null;
  /** Mã khu vực (`areas.code`), có cả khi `area.code` thiếu. */
  areaCode?: string | null;
  propertyTypes: string[];
  /** `value` lựa chọn `property_type` (FR-46); thiếu ở backend cũ. */
  propertyTypeCodes?: string[];
  /** Chữ loại hình cũ chưa ánh xạ được: Quản trị cần chọn lại. */
  unmappedPropertyTypes?: string[];
  priceFrom: number | null;
  priceTo: number | null;
  status: 'UPCOMING' | 'SELLING' | 'SOLD_OUT';
  isActive: boolean;
  customerCount: number;
  deletedAt: string | null;
  description?: string | null;
}

export interface TagDto extends RefDto {
  category: TagCategory;
  usageCount: number;
  color: string | null;
}

export interface PersonaOptionDto {
  value: string;
  label: string;
  isActive: boolean;
}

export interface PersonaFieldDto {
  id: string;
  key: string;
  label: string;
  helpText: string | null;
  placeholder: string | null;
  groupCode: string;
  type: PersonaFieldType;
  options: PersonaOptionDto[];
  order: number;
  weight: number;
  suggestPriority: number;
  isFilterable: boolean;
  isOccasion: boolean;
  occasionLabel: string | null;
  linkedCriterion: 'demand' | 'motivation' | 'finance' | 'timing' | null;
  isSensitive: boolean;
  isSystem: boolean;
  isActive: boolean;
}

// --- Người dùng, nhóm -------------------------------------------------------------------------------------------------

/**
 * `GET /crm/customer-assignees` (nguồn ô LỌC "Người phụ trách"): người xuất hiện trong careTeam của tập khách người xem thấy, kể cả
 * tài khoản đã khóa (`isLocked`) và ADMIN/EDITOR. `roles`/`teamIds`/`teams` là bản đủ.
 */
export interface CustomerAssigneeDto extends UserRefDto {
  role: 'ADMIN' | 'EDITOR' | 'MANAGER' | 'STAFF';
  roles?: ('ADMIN' | 'EDITOR' | 'MANAGER' | 'STAFF')[];
  team: RefDto | null;
  teamIds?: string[];
  teams?: RefDto[];
}

/** Phần tử `GET /crm/care-team-invitees`: chỉ tên + tên nhóm (FR-14), không email/SĐT/vai trò/id nhóm. */
export interface CareTeamInviteeDto {
  id: string;
  displayName: string;
  teamNames: string[];
}

export interface UserDto {
  _id: string;
  email: string;
  displayName: string;
  role: 'ADMIN' | 'EDITOR' | 'MANAGER' | 'STAFF';
  status: 'ACTIVE' | 'BLOCKED';
  teamId: string | null;
  /** Có từ khi hỗ trợ nhiều role/nhóm; bản ghi cũ có thể thiếu -> suy từ `role`/`teamId`. */
  roles?: ('ADMIN' | 'EDITOR' | 'MANAGER' | 'STAFF')[];
  teamIds?: string[];
}

export interface TeamMemberDto {
  id: string;
  displayName: string;
  role: 'ADMIN' | 'EDITOR' | 'MANAGER' | 'STAFF';
  roles: ('ADMIN' | 'EDITOR' | 'MANAGER' | 'STAFF')[];
  status: 'ACTIVE' | 'BLOCKED';
  isManager: boolean;
}

export interface TeamDto {
  id: string;
  name: string;
  code: string;
  managers: UserRefDto[];
  memberCount: number;
  isActive: boolean;
}

export interface CrmSettingsDto {
  staleCustomerDays: number;
  staleCheckTime: string;
  occasionNotifyTime: string;
  occasionLeadDays: number[];
  defaultAppointmentReminderMinutes: number[];
  careLogEditWindowHours: number;
  careLogNotifyDebounceMinutes: number;
  phoneViewAlertPerHour: number;
}

// --- Khách hàng -------------------------------------------------------------------------------------------------------

export interface CriteriaDoneDto {
  demand: boolean;
  motivation: boolean;
  finance: boolean;
  timing: boolean;
}

export interface CustomerListItemDto {
  id: string;
  fullName: string;
  /** `null` = khách chưa có SĐT (FR-02). */
  phoneMasked: string | null;
  /** Mã khách `KH-######`; `null` = bản ghi chưa cấp mã (mọi vai trò đều thấy mã khi có). */
  customerCode: string | null;
  /** Mã lựa chọn "Mục đích mua"; backend cũ chưa trả field này nên để optional (mapper mặc định `[]`). */
  purchasePurposes?: string[];
  status: StatusRefDto;
  source: CatalogRefDto | null;
  projects: CatalogRefDto[];
  area: CatalogRefDto | null;
  tags: RefDto[];
  progress: number;
  criteriaDone: CriteriaDoneDto;
  primaryAssignee: UserRefDto | null;
  careTeamSize: number;
  nextAppointmentAt: string | null;
  lastCareLogAt: string | null;
  lastUpdatedAt: string;
  personaCompleteness: number;
}

/** Phần tử của `GET /crm/deleted-customers`: khách + thông tin xóa. */
export interface DeletedCustomerDto extends CustomerListItemDto {
  deletedAt: string;
  deletedBy: UserRefDto | null;
  anonymizedAt: string | null;
  deleteReason: string | null;
  purgeInProgress: boolean;
}

export interface CriterionDto {
  isDone: boolean;
  description: string;
  updatedAt: string | null;
  updatedBy: UserRefDto | null;
}

export interface CareTeamMemberDto {
  /** `role` (vai trò tài khoản) tùy chọn: chỉ để suy ra chức danh hiển thị; vắng thì chức danh rỗng. */
  user: UserRefDto & { role?: 'ADMIN' | 'EDITOR' | 'MANAGER' | 'STAFF' | null };
  role: 'PRIMARY' | 'MEMBER';
  addedAt: string;
  addedBy: UserRefDto | null;
}

export interface CustomerDetailDto extends CustomerListItemDto {
  email: string | null;
  canViewPhone: boolean;
  criteria: Record<'demand' | 'motivation' | 'finance' | 'timing', CriterionDto>;
  careTeam: CareTeamMemberDto[];
  nationalIdMasked: string | null;
  hasNationalId: boolean;
  canRevealNationalId: boolean;
  dataConsent: { status: string; method: string | null; recordedBy: UserRefDto | null; recordedAt: string | null; note: string | null };
  lastUpdatedBy: UserRefDto | null;
  createdAt: string;
  createdBy: UserRefDto | null;
  createdVia: 'WEB' | 'MOBILE' | 'IMPORT';
  nextActionSuggestions: string[];
  permissions: { canEdit: boolean; canManageCareTeam: boolean; canSetInitialPrimary: boolean; canDelete: boolean };
  version: number;
}

export interface CareTeamDto {
  members: CareTeamMemberDto[];
  primary: UserRefDto | null;
}

export interface HistoryEntryDto {
  id: string;
  action: string;
  actor: UserRefDto | null;
  actorRole: string | null;
  changes: { field: string; from: unknown; to: unknown }[];
  reason: string | null;
  source: string;
  createdAt: string;
}

// --- Nhật ký, lịch hẹn ------------------------------------------------------------------------------------------------

export interface AttachmentDto {
  id: string;
  thumbUrl: string;
  url: string;
  mimeType: string;
  size: number;
}

export interface CareLogDto {
  id: string;
  customerId: string;
  author: UserRefDto;
  occurredAt: string;
  content: string;
  attachments: AttachmentDto[];
  contactChannel: ContactChannel;
  contactResult: CatalogRefDto | null;
  nextAction: { suggestion: string | null; dueAt: string | null; appointmentId: string | null } | null;
  source: 'MANUAL' | 'IMPORT' | 'SYSTEM';
  editedAt: string | null;
  canEdit: boolean;
}

export interface AppointmentDto {
  id: string;
  /** `phoneMasked`: "0912 ••• 678"; null = khách chưa có SĐT; "••••" = khách ẩn danh. */
  customer: { id: string; fullName: string; phoneMasked: string | null; status: StatusRefDto };
  type: AppointmentType;
  title: string;
  startAt: string;
  endAt: string | null;
  location: string;
  note: string;
  /** Có ở mọi response lịch hẹn; thiếu (backend cũ) hoặc null = không gắn dự án. */
  project?: CatalogRefDto | null;
  assignee: UserRefDto;
  remindBeforeMinutes: number[];
  status: AppointmentStatus;
  completedAt: string | null;
  outcome: string | null;
  createdBy: UserRefDto;
  version: number;
  canDelete: boolean;
  careLog?: CareLogDto;
}

export interface DailyTaskDto {
  id: string;
  kind: DailyTaskKind;
  dueAt: string;
  group: DailyTaskGroup;
  customer: { id: string; fullName: string; phoneMasked: string | null; status: StatusRefDto; projects: CatalogRefDto[] };
  /** Dự án của lịch hẹn (task APPOINTMENT có dự án); thiếu hoặc null = không có. */
  project?: CatalogRefDto | null;
  title: string;
  lastCareLog: { occurredAt: string; excerpt: string } | null;
  suggestion: string;
  appointmentId?: string;
  careLogId?: string;
  assignee: UserRefDto | null;
  isPrimary: boolean;
}

// --- Chân dung --------------------------------------------------------------------------------------------------------

export interface PersonaValueDto {
  valueText?: string;
  valueNumber?: number;
  valueNumberTo?: number;
  valueDate?: string;
  valueOptions?: string[];
  valueBoolean?: boolean;
}

export interface PersonaFieldValueDto {
  fieldKey: string;
  label: string;
  groupCode: string;
  type: PersonaFieldType;
  value: PersonaValueDto | null;
  source: 'CUSTOMER_SHARED' | 'STAFF_OBSERVED' | 'IMPORTED' | null;
  updatedAt: string | null;
  updatedBy: UserRefDto | null;
}

export interface CustomerPersonaDto {
  groups: { code: string; label: string; fields: PersonaFieldValueDto[] }[];
  completeness: number;
  missingSuggestions: { fieldKey: string; label: string; groupCode: string }[];
  version: number;
}

// --- Thông báo --------------------------------------------------------------------------------------------------------

export interface NotificationDto {
  id: string;
  type: string;
  title: string;
  body: string;
  data: { customerId?: string; appointmentId?: string; requestId?: string; deepLink: string };
  priority: string;
  readAt: string | null;
  createdAt: string;
}
