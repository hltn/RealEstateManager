/**
 * Mô hình dữ liệu CRM phía frontend — bám data model MongoDB của tài liệu 04 mục 3 và kiểu response của 05 §1.6.
 * Mục tiêu: khi có backend chỉ thay lớp dữ liệu mock bằng API thật, KHÔNG sửa UI.
 * [Prototype] Trường thêm so với app chính đều đánh dấu `[Prototype]` và là TÙY CHỌN (dữ liệu cũ vẫn hợp lệ): xóa mềm khách, `projectId/outcome/version`
 * của lịch hẹn, `editedAt/createdAt` của nhật ký, `email` của tài khoản. Riêng `Team.code/isActive` là BẮT BUỘC (app chính gắn chúng vào kiểu trả về của
 * `GET /teams`, prototype lưu thẳng trong `Team`), cùng kiểu `NotificationItem/StoredNotification` (thông báo trong app) ở cuối tệp.
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
  /** Tên nhóm (có khi lấy từ `careTeam[].user`). */
  teamName?: string;
  isActive: boolean;
  avatarUrl?: string;
  /** [Prototype] Email tài khoản (mock `/users` + đăng nhập giả); backend trả ở `GET /users`, không có trong `care-team-invitees`/`customer-assignees`. */
  email?: string;
}

/** Role của tài khoản trong `/users`: ngoài 3 role CRM còn EDITOR (quyền nội dung/tin tức, ngang STAFF, không có quyền CRM). */
export type AccountRole = UserRole | 'EDITOR';

/** Tài khoản từ `GET /users` (Quản trị): thêm mọi role + mọi nhóm; `role`/`teamId` là trường suy ra (role cao nhất, nhóm chính). */
export interface AdminUser extends CrmUser {
  /** Mọi role (≥1), sắp ADMIN > MANAGER > STAFF > EDITOR. */
  roles: AccountRole[];
  /** Mọi nhóm; phần tử đầu là nhóm chính. Rỗng nếu không có MANAGER/STAFF. */
  teamIds: string[];
}

/** Thành viên của một nhóm (`GET /teams/:id/members`) — không có email. */
export interface TeamMember {
  id: string;
  displayName: string;
  /** Role cao nhất (trường suy ra). */
  role: AccountRole;
  roles: AccountRole[];
  isActive: boolean;
  /** Người này là Quản lý CỦA NHÓM (`Team.managerIds`) — khác với có role MANAGER. */
  isManager: boolean;
}

export interface Team {
  id: string;
  name: string;
  managerIds: string[];
  /** Mã nhóm bất biến (chữ, số, - hoặc _, ≤ 20 ký tự). */
  code: string;
  /** Ngừng hoạt động: không thêm thành viên mới. Xóa mềm = bỏ khỏi danh sách. */
  isActive: boolean;
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
  /** Mã bất biến của backend (chữ HOA, số, `_`). */
  code?: string;
  label: string;
  order: number;
  isActive: boolean;
}

/** Khu vực (nơi khách đang ở). Prototype: danh sách phẳng, chưa có cây tỉnh/quận. */
export interface Area {
  id: string;
  name: string;
  /** Tên gốc của khu vực (không kèm tên khu vực cha) — dùng khi sửa. */
  rawName?: string;
  /** Loại khu vực của backend (PROVINCE/DISTRICT/WARD/OTHER). */
  type?: string;
  parentId?: string | null;
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
  /** Nhãn lựa chọn đang dùng (UI chọn/hiển thị theo nhãn). */
  options?: string[];
  /** Cặp mã/nhãn từ API (kể cả lựa chọn đã tắt) để đổi nhãn <-> mã khi gọi API. */
  optionItems?: { value: string; label: string; isActive: boolean }[];
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
  /** Trường nhạy cảm: chỉ ghi khi khách tự nguyện chia sẻ + xác nhận (QT9). */
  isSensitive?: boolean;
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
  /** Mã hiển thị `KH-000123` (v1.0.5, FR-02). Khách tạo trước v1.0.5 có thể chưa có mã -> null. */
  customerCode: string | null;
  /**
   * E.164, vd "+84912345678" (đã chuẩn hoá trước khi lưu). v1.0.5: có thể null (khách chưa có SĐT) và KHÔNG còn duy nhất
   * toàn hệ thống (cho phép trùng SĐT; định danh bằng `customerCode`).
   */
  phone: string | null;
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
  /**
   * [Prototype] Xóa mềm (Sửa đổi D): `deletedAt` != null = khách đã xóa (ẩn khỏi mọi danh sách, chỉ Quản trị thấy ở "Khách đã xóa").
   * Backend là `customers.deletedAt/deletedBy/deleteReason/anonymizedAt/purgingAt`; thêm field tùy chọn nên dữ liệu cũ vẫn hợp lệ.
   */
  deletedAt?: string | null;
  deletedBy?: string | null;
  deleteReason?: string | null;
  /** [Prototype] Đã ẩn danh hóa (không hoàn tác): không khôi phục được, lý do xóa bị xóa. */
  anonymizedAt?: string | null;
  /** [Prototype] Đang xóa vĩnh viễn dở dang (lỗi kho tệp): chỉ còn nút Xóa vĩnh viễn. */
  isPurgeInProgress?: boolean;
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
  /** [Prototype] Lần sửa cuối (ISO); null/thiếu = chưa sửa. */
  editedAt?: string | null;
  /** [Prototype] Thời điểm ghi nhật ký (khác `occurredAt` khi nhập bù giờ); thiếu thì lấy `occurredAt`. Tính hạn sửa/xóa của tác giả. */
  createdAt?: string;
}

export type AppointmentType = 'SITE_VISIT' | 'MEETING' | 'DEPOSIT_CONTRACT' | 'CALLBACK' | 'OTHER';
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
  /** [Prototype] Dự án gắn với lịch (backend `appointments.projectId`, G7); null/thiếu = không gắn. */
  projectId?: string | null;
  /** [Prototype] Kết quả buổi hẹn khi hoàn thành/hủy (backend `outcome`). */
  outcome?: string | null;
  /** [Prototype] Khóa lạc quan của lịch (backend `__v`); thiếu coi như 1. */
  version?: number;
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
export type AuditAction = 'PROJECT_CREATED' | 'PROJECT_UPDATED' | 'PROJECT_DEACTIVATED' | 'PROJECT_DELETED' | 'PROJECT_RESTORED' | 'CUSTOMER_EXPORTED' | 'CUSTOMER_PURGED';

/** `crm_audit_logs` cho thao tác không thuộc riêng 1 khách (ai làm, lúc nào, đổi gì). */
export interface AuditLog {
  id: string;
  action: AuditAction;
  entityType: 'PROJECT' | 'CUSTOMER_EXPORT' | 'CUSTOMER';
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
  | 'CUSTOMER_IMPORTED'
  // [Prototype] Mã hành động của backend mà store mock cũng ghi (xóa/khôi phục khách, sửa/xóa nhật ký, xóa lịch hẹn).
  | 'CUSTOMER_DELETED'
  | 'CUSTOMER_RESTORED'
  | 'CARE_LOG_UPDATED'
  | 'CARE_LOG_DELETED'
  | 'APPOINTMENT_STATUS_CHANGED'
  | 'APPOINTMENT_DELETED';

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

/** Cấu hình CRM (05 §2.14 `GET /crm/settings`). */
export interface CrmSettings {
  /** Khách nhóm "Chưa tiếp cận" / "Có quan tâm" quá N ngày chưa có nhật ký -> việc "khách lâu chưa chăm sóc". */
  staleCustomerDays: number;
  /** Giờ quét khách lâu chưa chăm sóc (HH:mm, giờ VN). */
  staleCheckTime: string;
  /** Giờ gửi nhắc dịp đặc biệt (HH:mm, giờ VN). */
  occasionNotifyTime: string;
  /** Nhắc dịp đặc biệt trước N ngày (0 = đúng ngày). */
  occasionLeadDays: number[];
  /** Mốc nhắc lịch hẹn mặc định (phút trước giờ hẹn). */
  defaultAppointmentReminderMinutes: number[];
  careLogEditWindowHours: number;
  careLogNotifyDebounceMinutes: number;
  phoneViewAlertPerHour: number;
}

// ---------------------------------------------------------------------------
// Việc hôm nay (05 §1.6 `DailyTask`) — luôn TÍNH từ dữ liệu, không lưu
// ---------------------------------------------------------------------------

export type DailyTaskKind = 'APPOINTMENT' | 'FOLLOW_UP' | 'OCCASION' | 'STALE_CUSTOMER';
export type DailyTaskGroup = 'OVERDUE' | 'TODAY' | 'UPCOMING';

// ---------------------------------------------------------------------------
// [Prototype] Hộp thông báo trong app (05 §2.10) — backend `notifications` của từng người nhận
// ---------------------------------------------------------------------------

export interface NotificationItem {
  id: string;
  /** Mã loại (xem `lib/notifications.ts`): CUSTOMER_ASSIGNED, APPOINTMENT_DUE, FOLLOW_UP_DUE... */
  type: string;
  title: string;
  body: string;
  customerId?: string;
  appointmentId?: string;
  /** Đường dẫn backend (vd `/crm/customers/:id`), quy đổi sang route Web Admin ở `resolveNotificationPath`. */
  deepLink: string;
  priority: string;
  isRead: boolean;
  createdAt: string;
}

/** Thông báo trong store mock: gắn người nhận (`GET /notifications` chỉ trả của người đang đăng nhập). */
export interface StoredNotification extends NotificationItem {
  userId: string;
}
