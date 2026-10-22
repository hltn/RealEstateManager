/**
 * Kiểu request/response của lớp truy cập dữ liệu CRM — bám tài liệu 05 (§1.2–1.6).
 * UI chỉ làm việc với các kiểu này; bản mock (`mockCrmApi.ts`) và bản API thật sau này cùng trả đúng shape.
 */
import type { CustomerFilters } from '@crm/types/app';
import type {
  AppointmentStatus,
  AppointmentType,
  CareTeamRequestStatus,
  CareTeamRole,
  ChangeAction,
  ContactChannel,
  CreatedVia,
  CriterionKey,
  DailyTaskGroup,
  DailyTaskKind,
  FieldChange,
  GalleryImage,
  NextAction,
  PersonaFieldType,
  PersonaGroupCode,
  PersonaSource,
  PersonaValue,
  Ref,
  StatusRef,
  UserRef,
  UserRole,
} from '@crm/types/crm';
import type { PaginationMeta } from '../../../types/pagination';

export type { PaginationMeta };

export interface Paginated<T> {
  data: T[];
  meta: PaginationMeta;
}

/** Lỗi theo `GlobalExceptionFilter` mở rộng (05 §1.3). */
export interface ApiError {
  statusCode: number;
  errorCode: string;
  message: string;
  details?: Record<string, unknown>;
}

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: ApiError };

// ---------------------------------------------------------------------------
// Khách hàng (05 §2.3)
// ---------------------------------------------------------------------------

export type CustomerSortField =
  | 'lastUpdatedAt'
  | 'fullName'
  | 'progress'
  | 'createdAt'
  | 'nextAppointmentAt'
  | 'lastCareLogAt'
  | 'personaCompleteness';

/** `sort` của 05 §1.4: tiền tố `-` = giảm dần. */
export type CustomerSort = CustomerSortField | `-${CustomerSortField}`;

export interface CustomerListQuery extends Partial<CustomerFilters> {
  page?: number;
  limit?: number;
  sort?: CustomerSort;
  /** Chỉ lấy các khách này (xuất CSV các dòng đã chọn). */
  customerIds?: string[];
}

export interface CustomerListItem {
  id: string;
  fullName: string;
  /** SĐT đã che ("0912 345 •••"). Số đầy đủ CHỈ lấy qua `createPhoneView` (kiểm phạm vi + ghi log PHONE_VIEWED). */
  phoneMasked: string;
  status: StatusRef;
  source: Ref | null;
  projects: Ref[];
  area: Ref | null;
  tags: Ref[];
  progress: number;
  criteriaDone: Record<CriterionKey, boolean>;
  primaryAssignee: UserRef | null;
  careTeamSize: number;
  nextAppointmentAt: string | null;
  lastCareLogAt: string | null;
  lastUpdatedAt: string;
  createdAt: string;
  personaCompleteness: number;
}

export interface CriterionView {
  isDone: boolean;
  description: string;
  updatedAt: string | null;
  updatedBy: UserRef | null;
}

export interface CareTeamMemberView {
  user: UserRef & { fullName: string; jobTitle: string; avatarUrl?: string };
  role: CareTeamRole;
  addedAt: string;
  addedBy: UserRef;
}

export interface CustomerPermissions {
  canEdit: boolean;
  /** Thêm/bớt thành viên (không phải phụ trách chính): Quản trị, Quản lý, phụ trách chính. */
  canManageCareTeam: boolean;
  /** Đổi/gỡ phụ trách chính: chỉ Quản trị, Quản lý. */
  canChangePrimary: boolean;
  canDelete: boolean;
  /** Xem CCCD đầy đủ (giả định D2: Quản trị, Quản lý, phụ trách chính). */
  canRevealNationalId: boolean;
  /** Duyệt đề nghị tham gia nhóm chăm sóc: Quản trị, Quản lý, phụ trách chính. */
  canReviewJoinRequests: boolean;
}

export interface CustomerDetail extends CustomerListItem {
  email: string;
  criteria: Record<CriterionKey, CriterionView>;
  careTeam: CareTeamMemberView[];
  nationalIdMasked: string | null;
  hasNationalId: boolean;
  notes: string;
  shouldRemindOccasions: boolean;
  lastUpdatedBy: UserRef;
  createdBy: UserRef;
  createdVia: CreatedVia;
  /** Gợi ý bước tiếp theo THẬT (từ nhật ký); rỗng = giao diện ẩn khối gợi ý. */
  nextActionSuggestions: string[];
  permissions: CustomerPermissions;
  version: number;
}

export interface ListCounts {
  NOT_CONTACTED: number;
  INTERESTED: number;
  NET: number;
  DROPPED: number;
  ALL: number;
  byStatus: { statusId: string; count: number }[];
}

export interface PhoneLookupResult {
  normalizedPhone: string;
  exists: boolean;
  isAccessible: boolean;
  /** Chỉ có khi người dùng truy cập được khách. */
  customerId?: string;
  /** Mã tham chiếu để đề nghị tham gia (không lộ thông tin khách). */
  customerRef?: string;
  /** Tên hiển thị phụ trách chính; null nếu khách chưa được phân. */
  caredByName: string | null;
  canRequestJoin: boolean;
  hasPendingRequest: boolean;
}

export interface CreateCustomerInput {
  fullName: string;
  phone: string;
  email?: string;
  statusId?: string;
  sourceId?: string | null;
  interestedProjectIds?: string[];
  areaId?: string | null;
  tagIds?: string[];
  nationalId?: string;
  careTeam?: { memberIds: string[]; primaryUserId: string };
  notes?: string;
  createdVia?: CreatedVia;
}

export interface UpdateCustomerInput {
  version: number;
  fullName?: string;
  phone?: string;
  email?: string;
  sourceId?: string | null;
  interestedProjectIds?: string[];
  areaId?: string | null;
  tagIds?: string[];
  notes?: string;
  shouldRemindOccasions?: boolean;
}

export interface UpdateStatusResult {
  status: StatusRef;
  previousStatusId: string;
  version: number;
  lastUpdatedAt: string;
}

export type CriteriaPatch = Partial<Record<CriterionKey, { isDone?: boolean; description?: string }>>;

// ---------------------------------------------------------------------------
// Chân dung (05 §2.7)
// ---------------------------------------------------------------------------

export interface PersonaFieldValueView {
  fieldKey: string;
  label: string;
  groupCode: PersonaGroupCode;
  type: PersonaFieldType;
  value: PersonaValue | null;
  source: PersonaSource | null;
  updatedAt: string | null;
  updatedBy: UserRef | null;
}

export interface CustomerPersonaView {
  groups: { code: PersonaGroupCode; label: string; fields: PersonaFieldValueView[] }[];
  completeness: number;
  missingSuggestions: { fieldKey: string; label: string; groupCode: PersonaGroupCode }[];
  /** Giá trị thô (để dựng form sửa). */
  values: PersonaValue[];
}

export interface PersonaValueInput {
  fieldKey: string;
  /** null = xoá giá trị. */
  value: Omit<PersonaValue, 'fieldKey' | 'source' | 'updatedBy' | 'updatedAt'> | null;
  source: Exclude<PersonaSource, 'IMPORTED'>;
}

// ---------------------------------------------------------------------------
// Nhật ký, lịch hẹn, việc hôm nay (05 §2.6, §2.9)
// ---------------------------------------------------------------------------

export interface CareLogView {
  id: string;
  customerId: string;
  author: UserRef;
  /** Tác giả đúng là phụ trách chính HIỆN TẠI của khách -> hiện dấu "Chính". */
  isPrimaryAuthor: boolean;
  occurredAt: string;
  content: string;
  contactChannel: ContactChannel;
  contactResult: Ref | null;
  nextAction: NextAction | null;
  source: 'MANUAL' | 'IMPORT' | 'SYSTEM';
  images: GalleryImage[];
}

export interface CreateCareLogInput {
  content: string;
  contactChannel: ContactChannel;
  occurredAt?: string;
  contactResultId?: string | null;
  nextAction?: {
    suggestion?: string;
    dueAt?: string | null;
    /** Tạo kèm lịch hẹn tại `dueAt`. */
    appointment?: { type: AppointmentType; location?: string };
  };
  images?: GalleryImage[];
}

export interface AppointmentView {
  id: string;
  customer: { id: string; fullName: string; phoneMasked: string; status: StatusRef; projects: Ref[] };
  type: AppointmentType;
  title: string;
  startAt: string;
  endAt: string | null;
  location: string;
  note: string;
  assignee: UserRef;
  remindBeforeMinutes: number[];
  status: AppointmentStatus;
  completedAt: string | null;
  createdBy: UserRef;
  smsZnsAuto: boolean;
  calendarSync: boolean;
}

export interface AppointmentListQuery {
  /** Khoá ngày VN "YYYY-MM-DD" (bao gồm). */
  from?: string;
  to?: string;
  customerId?: string;
  status?: AppointmentStatus;
}

export interface CreateAppointmentInput {
  customerId: string;
  type: AppointmentType;
  startAt: string;
  title?: string;
  location?: string;
  note?: string;
  assigneeId?: string;
  remindBeforeMinutes?: number[];
  smsZnsAuto?: boolean;
  calendarSync?: boolean;
  sourceCareLogId?: string | null;
}

export interface DailyTask {
  id: string;
  kind: DailyTaskKind;
  dueAt: string;
  group: DailyTaskGroup;
  customer: { id: string; fullName: string; phoneMasked: string; status: StatusRef; projects: Ref[] };
  title: string;
  lastCareLog: { occurredAt: string; excerpt: string } | null;
  suggestion: string;
  appointmentId?: string;
  careLogId?: string;
  assignee: UserRef | null;
  /** Người dùng hiện tại là phụ trách chính của khách. */
  isPrimary: boolean;
}

export type DailyTaskScope = 'mine' | 'team';

export interface DailyTaskQuery {
  scope?: DailyTaskScope;
  /** Từ khoá tìm (không dấu): tên khách, nội dung việc, SĐT (≥ 3 chữ số, như tìm khách), email. */
  q?: string;
}

// ---------------------------------------------------------------------------
// Lịch sử, CCCD, nhóm chăm sóc (05 §2.4, §2.5, §2.11)
// ---------------------------------------------------------------------------

export interface HistoryEntry {
  id: string;
  action: ChangeAction;
  actor: UserRef;
  actorRole: UserRole;
  changes: FieldChange[];
  reason?: string;
  source: string;
  createdAt: string;
}

export interface NationalIdViewEntry {
  viewer: UserRef;
  viewedAt: string;
}

export interface CareTeamRequestView {
  id: string;
  customer: { id: string; fullName: string } | null;
  requester: UserRef;
  message: string;
  status: CareTeamRequestStatus;
  createdAt: string;
  resolvedBy: UserRef | null;
  resolvedAt: string | null;
}

export interface AssignableUser extends UserRef {
  fullName: string;
  role: UserRole;
  team: Ref | null;
}
