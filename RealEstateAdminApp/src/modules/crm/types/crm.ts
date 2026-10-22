/**
 * Mô hình dữ liệu CRM phía frontend — bám data model MongoDB của tài liệu 04 mục 3 và kiểu response của 05 §1.6.
 * Mục tiêu: khi có backend chỉ thay lớp dữ liệu mock (`api/mockCrmApi.ts`) bằng API thật, KHÔNG sửa UI.
 *
 * Quy ước: id là chuỗi (ObjectId khi có backend); thời điểm = ISO UTC; ngày không giờ = "YYYY-MM-DD";
 * tham chiếu danh mục/người dùng luôn bằng id (không lưu tên).
 */

// ---------------------------------------------------------------------------
// Người dùng, nhóm, phân quyền (04 §4.1)
// ---------------------------------------------------------------------------

export type UserRole = 'ADMIN' | 'MANAGER' | 'STAFF';

export interface CrmUser {
  id: string;
  /** Họ tên đầy đủ, vd "Trần Mỹ Hạnh". */
  fullName: string;
  /** Tên hiển thị ngắn trên chip/nhật ký, vd "Hạnh". */
  displayName: string;
  role: UserRole;
  /** Chức danh hiển thị (không dùng để phân quyền). */
  jobTitle: string;
  teamId: string | null;
  isActive: boolean;
  avatarUrl?: string;
}

export interface Team {
  id: string;
  name: string;
  managerIds: string[];
}

/** `UserRef` của 05 §1.6. */
export interface UserRef {
  id: string;
  displayName: string;
}

// ---------------------------------------------------------------------------
// Danh mục (X7, 04 §3.3)
// ---------------------------------------------------------------------------

/** 4 nhóm danh sách khách (C6): Chưa tiếp cận, Có quan tâm, Khách net, Bỏ. */
export type ListGroup = 'NOT_CONTACTED' | 'INTERESTED' | 'NET' | 'DROPPED';

/** Mã 4 tình trạng hệ thống (seed). Quản trị thêm tình trạng mới thì `code` là chuỗi tuỳ ý. */
export type SystemStatusCode = 'NOT_CONTACTED' | 'INTERESTED' | 'NET' | 'DROPPED';

export type StatusTone = 'gray' | 'success' | 'warning' | 'error' | 'brand';

export interface CustomerStatusItem {
  id: string;
  code: string;
  label: string;
  listGroup: ListGroup;
  tone: StatusTone;
  order: number;
  isDefault: boolean;
  isSystem: boolean;
  isActive: boolean;
}

/** Danh mục phẳng (nguồn khách...). */
export interface CatalogItem {
  id: string;
  label: string;
  order: number;
  isActive: boolean;
}

/** Khu vực (nơi khách đang ở). Prototype: danh sách phẳng, chưa có cây tỉnh/quận. */
export interface Area {
  id: string;
  name: string;
  order: number;
  isActive: boolean;
}

export interface Project {
  id: string;
  code: string;
  /** Tên ngắn hiển thị trên chip, vd "Q'Terra". */
  name: string;
  /** Tên đầy đủ ở trang Dự án. */
  fullName: string;
  /** Chủ đầu tư (không bắt buộc). */
  developer: string;
  location: string;
  areaId: string | null;
  /** Loại hình sản phẩm, vd ["Căn hộ", "Shophouse"] (không bắt buộc; 04 §3.3 `propertyTypes[]`). */
  propertyTypes: string[];
  /** Khoảng giá (VNĐ, theo `priceUnit`); null = chưa nhập. Khi có cả hai thì `priceFrom <= priceTo`. */
  priceFrom: number | null;
  priceTo: number | null;
  /** `TOTAL` = giá cả căn/lô; `PER_SQM` = giá mỗi m² (mở rộng prototype, thêm field = tương thích ngược). */
  priceUnit: ProjectPriceUnit;
  /** Trạng thái bán hàng (04 §3.3); null = chưa cập nhật. */
  status: ProjectStatus | null;
  segment: string;
  /** Ngừng hoạt động = ẩn khỏi ô chọn mới, khách cũ giữ liên kết. Xoá mềm luôn kéo theo `isActive = false`. */
  isActive: boolean;
  /** Xoá mềm (ISO); null = chưa xoá. Khôi phục = đặt lại null (chỉ Quản trị). */
  deletedAt: string | null;
}

export type ProjectStatus = 'UPCOMING' | 'SELLING' | 'SOLD_OUT';
export type ProjectPriceUnit = 'TOTAL' | 'PER_SQM';

export type TagCategory = 'INTEREST' | 'OCCUPATION' | 'OTHER';

export interface Tag {
  id: string;
  name: string;
  category: TagCategory;
  isActive: boolean;
}

/** Kết quả liên hệ + mốc hẹn gợi ý (04 §3.3 `CONTACT_RESULT`). */
export interface ContactResult {
  id: string;
  label: string;
  /** Số ngày gợi ý hẹn lại; null = không gợi ý. */
  suggestedFollowUpDays: number | null;
  suggestionText: string;
  order: number;
  isActive: boolean;
}

export interface CrmCatalogs {
  statuses: CustomerStatusItem[];
  leadSources: CatalogItem[];
  areas: Area[];
  projects: Project[];
  tags: Tag[];
  contactResults: ContactResult[];
}

/** `Ref` của 05 §1.6. */
export interface Ref {
  id: string;
  label: string;
}

/** `StatusRef` của 05 §1.6. */
export interface StatusRef extends Ref {
  code: string;
  listGroup: ListGroup;
  tone: StatusTone;
}

// ---------------------------------------------------------------------------
// Chân dung động (C10, X10 — 04 §3.2.2, §3.4)
// ---------------------------------------------------------------------------

export type PersonaFieldType = 'TEXT' | 'TEXTAREA' | 'NUMBER_RANGE' | 'DATE' | 'SELECT' | 'MULTI_SELECT' | 'BOOLEAN';

export type PersonaGroupCode = 'PERSONAL' | 'OCCUPATION' | 'LIFESTYLE' | 'OCCASION' | 'FAMILY' | 'CONTACT' | 'REAL_ESTATE';

export type CriterionKey = 'demand' | 'motivation' | 'finance' | 'timing';

export interface PersonaFieldDefinition {
  /** Khoá bất biến, vd "birthday". */
  key: string;
  label: string;
  groupCode: PersonaGroupCode;
  type: PersonaFieldType;
  options?: string[];
  placeholder?: string;
  /** Trọng số độ đầy đủ (C12). */
  weight: number;
  /** Ưu tiên gợi ý "nên hỏi" (số nhỏ = hỏi trước). */
  suggestPriority: number;
  isFilterable: boolean;
  /** Chỉ với DATE: sinh dịp nhắc hằng năm (C13). */
  isOccasion: boolean;
  occasionLabel?: string;
  /** Hiển thị cạnh tiêu chí tương ứng; KHÔNG tự đánh dấu hoàn thành tiêu chí. */
  linkedCriterion: CriterionKey | null;
  isActive: boolean;
}

export type PersonaSource = 'CUSTOMER_SHARED' | 'STAFF_OBSERVED' | 'IMPORTED';

export interface PersonaValue {
  fieldKey: string;
  valueText?: string;
  /** NUMBER_RANGE: đơn vị VNĐ. */
  valueNumber?: number;
  valueNumberTo?: number;
  /** DATE: "YYYY-MM-DD". */
  valueDate?: string;
  valueOptions?: string[];
  valueBoolean?: boolean;
  source: PersonaSource;
  updatedBy: string;
  updatedAt: string;
}

/** Dịp đặc biệt sinh ra từ trường chân dung `isOccasion` (04 §3.2 `occasions`). */
export interface Occasion {
  fieldKey: string;
  month: number;
  day: number;
  year?: number;
}

// ---------------------------------------------------------------------------
// Khách hàng (04 §3.2)
// ---------------------------------------------------------------------------

export interface Criterion {
  isDone: boolean;
  description: string;
  updatedAt: string | null;
  updatedBy: string | null;
}

export type Criteria = Record<CriterionKey, Criterion>;

export type CareTeamRole = 'PRIMARY' | 'MEMBER';

export interface CareTeamMember {
  userId: string;
  role: CareTeamRole;
  addedBy: string;
  addedAt: string;
}

export type CreatedVia = 'WEB' | 'MOBILE' | 'IMPORT';

export interface Customer {
  id: string;
  fullName: string;
  /** E.164, vd "+84912345678" (đã chuẩn hoá trước khi lưu). Duy nhất toàn hệ thống. */
  phone: string;
  /** Không bắt buộc; nếu có nhập thì phải đúng định dạng email. */
  email: string;
  statusId: string;
  statusChangedAt: string;
  sourceId: string | null;
  interestedProjectIds: string[];
  /** Khu vực = nơi khách đang ở (C1). */
  areaId: string | null;
  tagIds: string[];
  /** 4 số cuối CCCD để hiển thị "••••1234". Bản đầy đủ KHÔNG lưu ở đây (xem `nationalIdVault`). */
  nationalIdLast4: string | null;
  /** Lần cuối đổi số CCCD (để ghi lịch sử/tăng version cả khi 4 số cuối không đổi). */
  nationalIdUpdatedAt?: string | null;
  hasNationalId: boolean;
  criteria: Criteria;
  careTeam: CareTeamMember[];
  /** Phi chuẩn hoá từ `careTeam` (đúng 1 PRIMARY nếu careTeam không rỗng). */
  primaryAssigneeId: string | null;
  persona: PersonaValue[];
  occasions: Occasion[];
  /** 0–100, tính lại mỗi lần sửa chân dung (C12). */
  personaCompleteness: number;
  /** Bật/tắt nhắc dịp đặc biệt cho khách này (C13). */
  shouldRemindOccasions: boolean;
  /** Ghi chú chung. */
  notes: string;
  lastCareLogAt: string | null;
  nextAppointmentAt: string | null;
  /** Chuỗi bỏ dấu + biến thể SĐT để tìm kiếm (không hiển thị, backend không trả ra API). */
  searchText: string;
  createdAt: string;
  createdBy: string;
  createdVia: CreatedVia;
  /** Tự ghi mỗi khi bất kỳ thông tin nào của khách thay đổi (C7) — không nhập tay. */
  lastUpdatedAt: string;
  lastUpdatedBy: string;
  /** Optimistic concurrency (`__v`): tăng 1 mỗi lần cập nhật. */
  version: number;
}

// ---------------------------------------------------------------------------
// Nhật ký chăm sóc, lịch hẹn (04 §3.5)
// ---------------------------------------------------------------------------

export type ContactChannel = 'CALL' | 'ZALO' | 'SMS' | 'MEETING' | 'SITE_VISIT' | 'OTHER';

export interface NextAction {
  suggestion: string;
  /** ISO; null = chỉ có gợi ý, không có hạn. */
  dueAt: string | null;
  appointmentId: string | null;
  /** Người phụ trách việc này; trống = tác giả nhật ký (hoặc PRIMARY nếu nhật ký hệ thống). Đổi khi gỡ người khỏi nhóm. */
  assigneeId?: string | null;
  /** Đánh dấu đã xử lý bước tiếp theo (mở rộng prototype để việc "Quá hạn" có thể đóng lại). */
  completedAt?: string | null;
}

/** Ảnh đính kèm nhật ký. */
export interface GalleryImage {
  src: string;
  caption: string;
}

export interface CareLog {
  id: string;
  customerId: string;
  authorId: string;
  /** Snapshot tên tác giả lúc ghi. */
  authorName: string;
  occurredAt: string;
  content: string;
  contactChannel: ContactChannel;
  contactResultId: string | null;
  nextAction: NextAction | null;
  source: 'MANUAL' | 'IMPORT' | 'SYSTEM';
  images?: GalleryImage[];
}

export type AppointmentType = 'SITE_VISIT' | 'MEETING' | 'DEPOSIT' | 'CALLBACK' | 'OTHER';
export type AppointmentStatus = 'SCHEDULED' | 'DONE' | 'CANCELED';
export type DayPeriod = 'morning' | 'afternoon';

export interface Appointment {
  id: string;
  customerId: string;
  type: AppointmentType;
  title: string;
  startAt: string;
  endAt: string | null;
  location: string;
  note: string;
  /** Người thực hiện (phải thuộc nhóm chăm sóc). */
  assigneeId: string;
  remindBeforeMinutes: number[];
  status: AppointmentStatus;
  completedAt: string | null;
  createdBy: string;
  sourceCareLogId: string | null;
  /** Tính năng cờ `isAppointmentNotifySyncEnabled` (mặc định tắt). */
  smsZnsAuto: boolean;
  calendarSync: boolean;
}

// ---------------------------------------------------------------------------
// Đề nghị tham gia nhóm chăm sóc (X2), nhật ký xem CCCD (C9), lịch sử thay đổi (X4)
// ---------------------------------------------------------------------------

export type CareTeamRequestStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELED';

export interface CareTeamRequest {
  id: string;
  customerId: string;
  requesterId: string;
  message: string;
  status: CareTeamRequestStatus;
  createdAt: string;
  resolvedBy: string | null;
  resolvedAt: string | null;
}

export interface NationalIdView {
  id: string;
  customerId: string;
  viewerId: string;
  viewedAt: string;
}

/** Hành động ghi vào `auditLogs` (không gắn với 1 khách): thao tác dự án, xuất danh sách khách (04 §3.7). */
export type AuditAction = 'PROJECT_CREATED' | 'PROJECT_UPDATED' | 'PROJECT_DEACTIVATED' | 'PROJECT_DELETED' | 'PROJECT_RESTORED' | 'CUSTOMER_EXPORTED';

/** `crm_audit_logs` cho thao tác không thuộc riêng 1 khách (ai làm, lúc nào, đổi gì). */
export interface AuditLog {
  id: string;
  action: AuditAction;
  entityType: 'PROJECT' | 'CUSTOMER_EXPORT';
  entityId: string | null;
  actorId: string;
  actorName: string;
  actorRole: UserRole;
  changes: FieldChange[];
  reason?: string;
  createdAt: string;
}

export type ChangeAction =
  | 'CUSTOMER_CREATED'
  | 'CUSTOMER_UPDATED'
  | 'STATUS_CHANGED'
  | 'CRITERIA_UPDATED'
  | 'PERSONA_UPDATED'
  | 'CARE_TEAM_MEMBER_ADDED'
  | 'CARE_TEAM_MEMBER_REMOVED'
  | 'PRIMARY_CHANGED'
  | 'NATIONAL_ID_UPDATED'
  | 'NATIONAL_ID_VIEWED'
  | 'PHONE_VIEWED'
  | 'CARE_LOG_CREATED'
  | 'FOLLOW_UP_COMPLETED'
  | 'APPOINTMENT_CREATED'
  | 'APPOINTMENT_UPDATED'
  | 'JOIN_REQUEST_CREATED'
  | 'JOIN_REQUEST_RESOLVED'
  | 'CUSTOMER_IMPORTED';

export interface FieldChange {
  field: string;
  /** Giá trị đã chuyển sang chữ hiển thị (CCCD luôn che). */
  from: string;
  to: string;
}

/** `crm_audit_logs` thu gọn cho lịch sử khách (X4, 04 §3.7). */
export interface ChangeLog {
  id: string;
  customerId: string;
  action: ChangeAction;
  actorId: string;
  actorName: string;
  actorRole: UserRole;
  changes: FieldChange[];
  reason?: string;
  source: 'WEB' | 'MOBILE' | 'IMPORT' | 'SYSTEM';
  createdAt: string;
}

/** Cấu hình CRM (04 §3.7 `crm_settings`) — prototype giữ các ngưỡng dùng ở client. */
export interface CrmSettings {
  /** Khách nhóm "Chưa tiếp cận" / "Có quan tâm" quá N ngày chưa có nhật ký -> việc "khách lâu chưa chăm sóc". */
  staleCustomerDays: number;
  /** Nhắc dịp đặc biệt trước N ngày (C13). */
  occasionLeadDays: number;
  /** Số ngày hiển thị ở nhóm "Sắp tới". */
  upcomingDays: number;
}

// ---------------------------------------------------------------------------
// Việc hôm nay (05 §1.6 `DailyTask`) — luôn TÍNH từ dữ liệu, không lưu
// ---------------------------------------------------------------------------

export type DailyTaskKind = 'APPOINTMENT' | 'FOLLOW_UP' | 'OCCASION' | 'STALE_CUSTOMER';
export type DailyTaskGroup = 'OVERDUE' | 'TODAY' | 'UPCOMING';
