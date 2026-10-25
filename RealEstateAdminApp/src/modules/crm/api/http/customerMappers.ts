/**
 * Mapper khách hàng, nhóm chăm sóc, nhật ký, lịch hẹn, việc hôm nay, lịch sử: response backend -> view-type của UI.
 * Hàm thuần, không đọc mạng/store -> test được. Không log dữ liệu (có PII).
 */
import type { PersonaFieldDefinition, PersonaValue, UserRef, UserRole } from '@crm/types/crm';
import type {
  AppointmentView,
  CareLogView,
  CareTeamMemberView,
  CareTeamRequestView,
  CriterionView,
  CustomerDetail,
  CustomerListItem,
  CustomerPersonaView,
  DailyTask,
  HistoryEntry,
  NationalIdViewEntry,
} from '../types';
import type {
  AppointmentDto,
  CareLogDto,
  CareTeamMemberDto,
  CareTeamRequestDto,
  CriterionDto,
  CustomerDetailDto,
  CustomerListItemDto,
  CustomerPersonaDto,
  DailyTaskDto,
  HistoryEntryDto,
  PersonaValueDto,
  UserRefDto,
} from './dto';
import { optionLabelToValue, optionValueToLabel, toPersonaGroupCode, toStatusRef } from './catalogMappers';

/** Người không xác định (bản ghi hệ thống/đã xóa). */
export const SYSTEM_USER: UserRef = { id: '', displayName: 'Hệ thống' };

export const toUserRef = (dto: UserRefDto | null | undefined): UserRef => (dto ? { id: dto.id, displayName: dto.displayName } : SYSTEM_USER);

export const toCustomerListItem = (dto: CustomerListItemDto): CustomerListItem => ({
  id: dto.id,
  fullName: dto.fullName,
  phoneMasked: dto.phoneMasked,
  status: toStatusRef(dto.status),
  source: dto.source,
  projects: dto.projects,
  area: dto.area,
  tags: dto.tags,
  progress: dto.progress,
  criteriaDone: dto.criteriaDone,
  primaryAssignee: dto.primaryAssignee ? toUserRef(dto.primaryAssignee) : null,
  careTeamSize: dto.careTeamSize,
  nextAppointmentAt: dto.nextAppointmentAt,
  lastCareLogAt: dto.lastCareLogAt,
  lastUpdatedAt: dto.lastUpdatedAt,
  personaCompleteness: dto.personaCompleteness,
});

const toCriterion = (dto: CriterionDto): CriterionView => ({
  isDone: dto.isDone,
  description: dto.description ?? '',
  updatedAt: dto.updatedAt,
  updatedBy: dto.updatedBy ? toUserRef(dto.updatedBy) : null,
});

/** Chức danh hiển thị theo vai trò (backend không có chức danh riêng). */
export const ROLE_JOB_TITLES: Record<string, string> = { MANAGER: 'Quản lý', STAFF: 'Nhân viên kinh doanh', ADMIN: 'Quản trị' };

export const toCareTeamMember = (dto: CareTeamMemberDto, roleOf?: (userId: string) => UserRole | undefined): CareTeamMemberView => {
  const role = roleOf?.(dto.user.id);
  return {
    user: { id: dto.user.id, displayName: dto.user.displayName, fullName: dto.user.displayName, jobTitle: role ? (ROLE_JOB_TITLES[role] ?? '') : '' },
    role: dto.role,
    addedAt: dto.addedAt,
    addedBy: toUserRef(dto.addedBy),
  };
};

export interface DetailMappingContext {
  /** Người đang đăng nhập (suy ra quyền duyệt đề nghị tham gia). */
  actor: { userId: string; role: UserRole };
  roleOf?: (userId: string) => UserRole | undefined;
}

/**
 * `canReviewJoinRequests` không có trong response: Quản trị/Quản lý (đã nằm trong phạm vi khách) hoặc phụ trách chính được duyệt (05 §2.5).
 * Chỉ để ẩn/hiện nút — backend vẫn kiểm quyền.
 */
export const toCustomerDetail = (dto: CustomerDetailDto, context: DetailMappingContext): CustomerDetail => {
  const isPrimary = dto.careTeam.some((member) => member.role === 'PRIMARY' && member.user.id === context.actor.userId);
  return {
    ...toCustomerListItem(dto),
    createdAt: dto.createdAt,
    email: dto.email ?? '',
    criteria: {
      demand: toCriterion(dto.criteria.demand),
      motivation: toCriterion(dto.criteria.motivation),
      finance: toCriterion(dto.criteria.finance),
      timing: toCriterion(dto.criteria.timing),
    },
    careTeam: dto.careTeam.map((member) => toCareTeamMember(member, context.roleOf)),
    nationalIdMasked: dto.nationalIdMasked,
    hasNationalId: dto.hasNationalId,
    lastUpdatedBy: toUserRef(dto.lastUpdatedBy),
    createdBy: toUserRef(dto.createdBy),
    createdVia: dto.createdVia,
    nextActionSuggestions: dto.nextActionSuggestions ?? [],
    permissions: {
      canEdit: dto.permissions.canEdit,
      canManageCareTeam: dto.permissions.canManageCareTeam,
      canChangePrimary: dto.permissions.canChangePrimary,
      canDelete: dto.permissions.canDelete,
      canRevealNationalId: dto.canRevealNationalId,
      canReviewJoinRequests: context.actor.role === 'ADMIN' || context.actor.role === 'MANAGER' || isPrimary,
    },
    version: dto.version,
  };
};

export const toCareTeamRequest = (dto: CareTeamRequestDto): CareTeamRequestView => ({
  id: dto.id,
  customer: dto.customer.fullName ? { id: dto.customer.id, fullName: dto.customer.fullName } : null,
  requester: toUserRef(dto.requester),
  message: dto.message ?? '',
  status: dto.status,
  createdAt: dto.createdAt,
  resolvedBy: dto.resolvedBy ? toUserRef(dto.resolvedBy) : null,
  resolvedAt: dto.resolvedAt,
  resolutionNote: dto.resolutionNote,
});

/** `id` khách của đề nghị (có cả khi người xem không thấy tên). */
export const getRequestCustomerId = (dto: CareTeamRequestDto): string => dto.customer.id;

export const toCareLog = (dto: CareLogDto, primaryUserId: string | null): CareLogView => ({
  id: dto.id,
  customerId: dto.customerId,
  author: toUserRef(dto.author),
  isPrimaryAuthor: primaryUserId !== null && dto.author.id === primaryUserId,
  occurredAt: dto.occurredAt,
  content: dto.content,
  contactChannel: dto.contactChannel,
  contactResult: dto.contactResult,
  nextAction: dto.nextAction
    ? { suggestion: dto.nextAction.suggestion ?? '', dueAt: dto.nextAction.dueAt, appointmentId: dto.nextAction.appointmentId }
    : null,
  source: dto.source,
  images: dto.attachments.map((attachment, index) => ({ src: attachment.url, caption: `Ảnh ${index + 1}` })),
  attachmentIds: dto.attachments.map((attachment) => attachment.id),
  editedAt: dto.editedAt,
  canEdit: dto.canEdit,
});

export const toAppointment = (dto: AppointmentDto): AppointmentView => ({
  id: dto.id,
  customer: { id: dto.customer.id, fullName: dto.customer.fullName, status: toStatusRef(dto.customer.status) },
  type: dto.type,
  title: dto.title,
  startAt: dto.startAt,
  endAt: dto.endAt,
  location: dto.location,
  note: dto.note,
  project: dto.project ? { id: dto.project.id, label: dto.project.label } : null,
  assignee: toUserRef(dto.assignee),
  remindBeforeMinutes: dto.remindBeforeMinutes,
  status: dto.status,
  completedAt: dto.completedAt,
  outcome: dto.outcome,
  createdBy: toUserRef(dto.createdBy),
  version: dto.version,
  canDelete: dto.canDelete,
});

export const toDailyTask = (dto: DailyTaskDto): DailyTask => ({
  id: dto.id,
  kind: dto.kind,
  dueAt: dto.dueAt,
  group: dto.group,
  customer: { id: dto.customer.id, fullName: dto.customer.fullName, status: toStatusRef(dto.customer.status), projects: dto.customer.projects },
  project: dto.project ? { id: dto.project.id, label: dto.project.label } : null,
  title: dto.title,
  lastCareLog: dto.lastCareLog,
  suggestion: dto.suggestion,
  appointmentId: dto.appointmentId,
  careLogId: dto.careLogId,
  assignee: dto.assignee ? toUserRef(dto.assignee) : null,
  isPrimary: dto.isPrimary,
});

/** Giá trị before/after của lịch sử có thể là object/mảng/null -> chuỗi hiển thị. */
export const formatChangeValue = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'boolean') return value ? 'Có' : 'Không';
  if (typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.map(formatChangeValue).filter(Boolean).join(', ');
  return JSON.stringify(value);
};

export const toHistoryEntry = (dto: HistoryEntryDto): HistoryEntry => ({
  id: dto.id,
  action: dto.action,
  actor: toUserRef(dto.actor),
  actorRole: dto.actorRole ?? '',
  changes: (dto.changes ?? []).map((change) => ({ field: change.field, from: formatChangeValue(change.from), to: formatChangeValue(change.to) })),
  reason: dto.reason ?? undefined,
  source: dto.source,
  createdAt: dto.createdAt,
});

export const toNationalIdView = (dto: { viewer: UserRefDto; viewedAt: string; purpose: string | null }): NationalIdViewEntry => ({
  viewer: toUserRef(dto.viewer),
  viewedAt: dto.viewedAt,
  purpose: dto.purpose,
});

// ---------------------------------------------------------------------------------------------------------------------
// Chân dung: backend lưu MÃ lựa chọn, UI làm việc với NHÃN.
// ---------------------------------------------------------------------------------------------------------------------

type PersonaFieldLookup = ReadonlyMap<string, PersonaFieldDefinition>;

/** Giá trị API -> giá trị UI (mã lựa chọn -> nhãn). `source`/`updatedBy`/`updatedAt` do caller gắn. */
export const toPersonaValue = (fieldKey: string, value: PersonaValueDto, field: PersonaFieldDefinition | undefined, meta: Pick<PersonaValue, 'source' | 'updatedBy' | 'updatedAt'>): PersonaValue => ({
  fieldKey,
  ...(value.valueText !== undefined ? { valueText: value.valueText } : {}),
  ...(value.valueNumber !== undefined ? { valueNumber: value.valueNumber } : {}),
  ...(value.valueNumberTo !== undefined ? { valueNumberTo: value.valueNumberTo } : {}),
  ...(value.valueDate !== undefined ? { valueDate: value.valueDate } : {}),
  ...(value.valueBoolean !== undefined ? { valueBoolean: value.valueBoolean } : {}),
  ...(value.valueOptions !== undefined ? { valueOptions: value.valueOptions.map((code) => (field ? optionValueToLabel(field, code) : code)) } : {}),
  ...meta,
});

/** Giá trị UI -> body API (nhãn -> mã lựa chọn). Nhãn không có trong định nghĩa -> bỏ qua (backend sẽ báo `PERSONA_VALUE_INVALID` nếu thiếu). */
export const toPersonaValueBody = (value: Omit<PersonaValue, 'fieldKey' | 'source' | 'updatedBy' | 'updatedAt'>, field: PersonaFieldDefinition | undefined): PersonaValueDto => {
  const body: PersonaValueDto = {};
  if (value.valueText !== undefined) body.valueText = value.valueText;
  if (value.valueNumber !== undefined) body.valueNumber = value.valueNumber;
  if (value.valueNumberTo !== undefined) body.valueNumberTo = value.valueNumberTo;
  if (value.valueDate !== undefined) body.valueDate = value.valueDate;
  if (value.valueBoolean !== undefined) body.valueBoolean = value.valueBoolean;
  if (value.valueOptions !== undefined) {
    body.valueOptions = value.valueOptions.map((label) => (field ? (optionLabelToValue(field, label) ?? label) : label));
  }
  return body;
};

/** `GET /crm/customers/:id/persona` -> view của UI (kèm `values` thô để dựng form). */
export const toCustomerPersona = (dto: CustomerPersonaDto, fields: PersonaFieldLookup): CustomerPersonaView => {
  const values: PersonaValue[] = [];
  const groups = dto.groups.map((group) => ({
    code: toPersonaGroupCode(group.code),
    label: group.label,
    fields: group.fields.map((item) => {
      const field = fields.get(item.fieldKey);
      const meta = { source: item.source ?? 'STAFF_OBSERVED', updatedBy: item.updatedBy?.id ?? '', updatedAt: item.updatedAt ?? '' } as const;
      const value = item.value ? toPersonaValue(item.fieldKey, item.value, field, meta) : null;
      if (value) values.push(value);
      return {
        fieldKey: item.fieldKey,
        label: item.label,
        groupCode: toPersonaGroupCode(item.groupCode),
        type: item.type,
        value,
        source: item.value ? (item.source ?? null) : null,
        updatedAt: item.value ? item.updatedAt : null,
        updatedBy: item.value && item.updatedBy ? toUserRef(item.updatedBy) : null,
      };
    }),
  }));
  return { groups, completeness: dto.completeness, missingSuggestions: dto.missingSuggestions.map((item) => ({ ...item, groupCode: toPersonaGroupCode(item.groupCode) })), values, version: dto.version };
};
