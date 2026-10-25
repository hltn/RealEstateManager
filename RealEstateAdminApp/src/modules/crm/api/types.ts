/**
 * Kiểu request/response (view-type) của lớp truy cập dữ liệu CRM — bám tài liệu 05 (§1.2–1.6).
 * UI chỉ làm việc với các kiểu này; mapper ở `api/http/*` đổi response thô của backend sang các kiểu này.
 */
import type { CustomerFilters } from '@crm/types/app';
import type {
  AppointmentStatus,
  AppointmentType,
  CareTeamRequestStatus,
  CareTeamRole,
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
  /** Chỉ có ở chi tiết; danh sách của backend không trả `createdAt`. */
  createdAt?: string;
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
  /** Chuỗi rỗng khi chưa có email. */
  email: string;
  createdAt: string;
  criteria: Record<CriterionKey, CriterionView>;
  careTeam: CareTeamMemberView[];
  nationalIdMasked: string | null;
  hasNationalId: boolean;
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
  criteria?: CriteriaPatch;
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
}

export interface UpdateStatusResult {
  status: StatusRef;
  previousStatusId: string;
  version: number;
  lastUpdatedAt: string;
}

/** Thao tác hàng loạt (`POST /crm/customer-bulk-operations`, 05 §2.3). `primaryUserId` bắt buộc với khách chưa có phụ trách chính. */
export type BulkOperation =
  | { type: 'CHANGE_STATUS'; customerIds: string[]; statusId: string }
  | { type: 'ADD_TAGS'; customerIds: string[]; tagIds: string[] }
  | { type: 'REMOVE_TAGS'; customerIds: string[]; tagIds: string[] }
  | { type: 'ASSIGN'; customerIds: string[]; memberIds: string[]; primaryUserId?: string };

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
  /** Giá trị thô (để dựng form sửa; `updatedBy` là id người sửa). */
  values: PersonaValue[];
  /** Version hồ sơ để gửi kèm PATCH (khóa lạc quan). */
  version: number;
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
  /** Ảnh đính kèm: `src` là URL có chữ ký (hết hạn 15 phút), không phải dữ liệu nhúng. */
  images: GalleryImage[];
  attachmentIds: string[];
  editedAt: string | null;
  /** Người gọi còn quyền sửa/xóa (tác giả trong 24 giờ, Quản trị, Quản lý trong phạm vi). */
  canEdit: boolean;
}

export interface CreateCareLogInput {
  content: string;
  contactChannel: ContactChannel;
  occurredAt?: string;
  contactResultId?: string | null;
  nextAction?: {
    suggestion?: string;
    dueAt?: string | null;
    /** Tạo kèm lịch hẹn tại `dueAt` (bắt buộc có `dueAt`). */
    appointment?: { type: AppointmentType; location?: string; remindBeforeMinutes?: number[]; /** Dự án của lịch (không bắt buộc; dự án phải còn hoạt động). */ projectId?: string | null };
  };
  /** Id ảnh đã tải lên (`POST care-log-attachments`), tối đa 5. */
  attachmentIds?: string[];
}

export interface AppointmentView {
  id: string;
  /** `phoneMasked`/`projects` không có trong response lịch hẹn của backend. */
  customer: { id: string; fullName: string; phoneMasked?: string; status: StatusRef; projects?: Ref[] };
  type: AppointmentType;
  title: string;
  startAt: string;
  endAt: string | null;
  location: string;
  note: string;
  /** Dự án gắn với lịch (vd dự án khách đi xem); null = lịch không gắn dự án (kể cả lịch cũ). */
  project: Ref | null;
  assignee: UserRef;
  remindBeforeMinutes: number[];
  status: AppointmentStatus;
  completedAt: string | null;
  outcome: string | null;
  createdBy: UserRef;
  /** Khóa lạc quan, gửi kèm khi sửa/đổi trạng thái. */
  version: number;
  /** Người gọi được xóa lịch này (Quản trị/Quản lý trong phạm vi; Nhân viên: lịch do mình tạo). */
  canDelete: boolean;
}

export interface AppointmentListQuery {
  /** Khoá ngày VN "YYYY-MM-DD" (bao gồm). */
  from?: string;
  to?: string;
  customerId?: string;
  /** Lọc theo dự án của lịch (dự án không tồn tại/ngừng hoạt động: backend trả 400). */
  projectId?: string;
  status?: AppointmentStatus;
  /** Giới hạn tối đa 100/trang; hook tự gom trang cho cửa sổ ≤ 62 ngày. */
  assigneeIds?: string[];
  types?: AppointmentType[];
}

export interface CreateAppointmentInput {
  customerId: string;
  type: AppointmentType;
  startAt: string;
  title?: string;
  location?: string;
  note?: string;
  assigneeId?: string;
  endAt?: string;
  remindBeforeMinutes?: number[];
  /** Dự án của lịch: id = gắn, null = không gắn; bỏ trống = không gửi. */
  projectId?: string | null;
}

export interface DailyTask {
  id: string;
  kind: DailyTaskKind;
  dueAt: string;
  group: DailyTaskGroup;
  /** `projects` = dự án khách quan tâm (mọi loại việc). */
  customer: { id: string; fullName: string; phoneMasked?: string; status: StatusRef; projects: Ref[] };
  /** Dự án của lịch hẹn: chỉ có khi việc là APPOINTMENT và lịch có dự án; ngược lại null. */
  project: Ref | null;
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
  /** Từ khoá tìm; lọc phía giao diện trên các việc đã tải (API không có tham số tìm). */
  q?: string;
}

// ---------------------------------------------------------------------------
// Lịch sử, CCCD, nhóm chăm sóc (05 §2.4, §2.5, §2.11)
// ---------------------------------------------------------------------------

export interface HistoryEntry {
  id: string;
  /** Mã hành động của audit (vd `STATUS_CHANGED`); mã lạ hiển thị nguyên văn. */
  action: string;
  actor: UserRef;
  actorRole: string;
  changes: FieldChange[];
  reason?: string;
  source: string;
  createdAt: string;
}

export interface NationalIdViewEntry {
  viewer: UserRef;
  viewedAt: string;
  purpose: string | null;
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
  resolutionNote: string | null;
}

export interface AssignableUser extends UserRef {
  fullName: string;
  role: UserRole;
  team: Ref | null;
}
