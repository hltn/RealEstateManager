/**
 * Mô hình dữ liệu CRM hợp nhất (Admin + Mobile).
 *
 * Nguyên tắc: lấy kiểu giàu hơn của bản Admin làm gốc, bổ sung trường chỉ Mobile có.
 * Khi 2 bản đặt tên/kiểu khác nhau cho cùng khái niệm -> chọn MỘT dạng chuẩn ở đây,
 * dạng còn lại được suy ra qua adapter trong `src/lib/customerAdapters.ts`
 * và `src/lib/appointmentAdapters.ts`. Xem README mục "Quyết định hợp nhất dữ liệu".
 */

// ---------------------------------------------------------------------------
// Khách hàng
// ---------------------------------------------------------------------------

/** Trạng thái khách (chuẩn = nhãn tiếng Việt của Admin, đồng thời là `statusLabel` của Mobile). */
export const CUSTOMER_STATUSES = [
  'Có quan tâm',
  'Khách net',
  'Chưa tiếp cận',
  'Bỏ / Không nhu cầu',
] as const;
export type CustomerStatus = (typeof CUSTOMER_STATUSES)[number];

/** Mã trạng thái kiểu Mobile (dẫn xuất từ CustomerStatus qua `toLeadStatus`). */
export type LeadStatus = 'caring' | 'hot' | 'untouched' | 'dropped';

export type VipTier = 'VIP' | 'VIP Platinum' | 'VIP Diamond';

/** Người quyết định (chuẩn = nhãn Admin). Mobile dùng mã `DecisionMakerCode`. */
export type DecisionMaker = 'Vợ chồng cùng duyệt' | 'Khách tự quyết' | 'Tham khảo gia đình';
export type DecisionMakerCode = 'both' | 'self' | 'family';

/** Kênh liên hệ ưu tiên (chuẩn = nhãn Admin). Mobile dùng mã `ContactChannelCode`. */
export type ContactMethod = 'Zalo' | 'Điện thoại' | 'Gặp mặt';
export type ContactChannelCode = 'zalo' | 'phone' | 'meeting';

/** Tiêu chí chốt deal C4 (chuẩn = `c4Criteria` của Admin, có thêm `percent`). */
export type C4CriterionKey = 'demand' | 'motivation' | 'finance' | 'timing';
export interface C4Criterion {
  achieved: boolean;
  text: string;
  percent: number;
}
export type C4Criteria = Record<C4CriterionKey, C4Criterion>;

/** Dạng `dealCriteria` của Mobile - chỉ dùng làm output adapter (`toDealCriteria`). */
export type DealCriterionKey = 'demand' | 'motivation' | 'finance' | 'timeline';
export interface DealCriterion {
  met: boolean;
  text: string;
}
export type DealCriteria = Record<DealCriterionKey, DealCriterion>;

/** Dạng `investmentInfo` của Mobile - chỉ dùng làm output adapter (`toInvestmentInfo`). */
export interface InvestmentInfo {
  projects: string[];
  budgetMin: string;
  budgetMax: string;
  ownCapitalRatio: string;
  needsLoanSupport: boolean;
  propertyType: string;
  bedrooms: string;
  purposes: string[];
  priorityCriteria: string[];
  searchArea: string;
  specificLocation: string;
  source: string;
  targetTimeline: string;
}

/** Ảnh thư viện (chuẩn = `{src, caption}` của Admin; Mobile cũ dùng `{url, title}`). */
export interface GalleryImage {
  src: string;
  caption: string;
}

export interface Customer {
  id: string;
  /** Mã hiển thị kiểu Mobile, vd "#01". */
  code: string;
  name: string;
  /** Định dạng hiển thị có khoảng trắng "0912 345 678". Dùng `toTelHref` khi gọi. */
  phone: string;
  email: string;
  /** CCCD. Chuỗi rỗng nếu chưa có. */
  idNumber: string;
  isVip: boolean;
  vipTier?: VipTier;
  status: CustomerStatus;

  /** Tiến độ 0-100 (bội số 25). Bước 1-4 kiểu Mobile: `getProgressStepIndex`. */
  progressPercentage: number;
  /** Nhãn bước hiện tại, vd "Đã đi xem dự án". */
  progressStep: string;

  // ----- Chân dung (Persona / C10) -----
  currentResidence: string;
  hometown: string;
  /** dd/MM/yyyy */
  birthDate: string;
  remindBirthday?: boolean;
  maritalStatus: string;
  children: string;
  occupation: string;
  businessField: string;
  decisionMaker: DecisionMaker;
  /** Lưu KHÔNG có dấu '#'. Hiển thị dạng hashtag qua `toHashtag`. */
  lifestyleTags: string[];
  freeTimeSlot: string;
  preferredContactMethod: ContactMethod;
  preferredSalutation: string;

  // ----- Phân công -----
  staffLead: string;
  staffSupport: string[];
  teamGroup: string;

  // ----- Thông tin đầu tư -----
  interestedProjects: string[];
  /** Đơn vị: tỷ VNĐ. */
  budgetMin: number;
  /** Đơn vị: tỷ VNĐ. */
  budgetMax: number;
  equityRatio: string;
  loanIncentive: boolean;
  propertyType: string;
  bedroomType: string;
  purchasePurposes: string[];
  criteriaPriorities: string[];
  searchArea: string;
  specificLocation: string;
  leadSource: string;
  targetPurchaseTime: string;

  /** Ghi chú bổ sung (Admin `notes` = Mobile `additionalNotes`). */
  notes: string;
  /** Tóm tắt ghi chú gần nhất (Mobile). Cập nhật khi lưu Ghi chú nhanh. */
  notesSummary?: string;
  /** Gợi ý AI ở cấp khách hàng (Mobile). Gợi ý theo việc nằm ở `DailyTask.aiSuggestion`. */
  aiSuggestion?: string;

  c4Criteria: C4Criteria;

  nextAppointmentDate?: string;
  nextAppointmentTime?: string;
  nextAppointmentNote?: string;
}

// ---------------------------------------------------------------------------
// Nhật ký chăm sóc (chuẩn = mảng CareLog riêng, chuẩn hoá theo customerId)
// ---------------------------------------------------------------------------

export interface CareLog {
  id: string;
  customerId: string;
  author: string;
  authorRole: string;
  /** "dd/MM" hoặc "Hôm nay" (dữ liệu prototype). */
  date: string;
  /** "HH:mm" */
  time: string;
  content: string;
  contactMethod?: string;
  callResult?: string;
  tag?: string;
  images?: GalleryImage[];
}

/** Dạng `timelineLogs` nhúng của Mobile - output của adapter `toTimelineEntries`. */
export interface TimelineEntry {
  id: string;
  date: string;
  time: string;
  isLatest: boolean;
  author: string;
  content: string;
  images: GalleryImage[];
}

// ---------------------------------------------------------------------------
// Lịch hẹn
// ---------------------------------------------------------------------------

/** Loại lịch hẹn (chuẩn = mã của Mobile; nhãn Admin `purpose` lấy qua APPOINTMENT_TYPE_LABELS). */
export type AppointmentType = 'xem_nha' | 'ky_coc' | 'gap_truc_tiep' | 'nhac_goi' | 'khac';
export type DayPeriod = 'morning' | 'afternoon';

export interface Appointment {
  id: string;
  customerId: string;
  /** Snapshot tên/SĐT tại thời điểm tạo lịch. */
  customerName: string;
  customerPhone: string;
  /** Nhãn hiển thị trên thẻ lịch (Admin `customerStatus` / Mobile `customerTag`). */
  customerTag: string;
  projectName: string;
  type: AppointmentType;
  /** Tiêu đề tuỳ chỉnh; nếu trống dùng `getAppointmentTitle`. */
  title?: string;
  /** ISO "YYYY-MM-DD". */
  date: string;
  /** 24h "HH:mm". Dạng "09:30 AM" lấy qua `formatTime12h`. */
  time: string;
  location: string;
  /** Admin `details` / Mobile `note`. */
  details: string;
  leadStaffInitials: string;
  leadStaffName: string;
  supportStaff?: string;
  reminderBefore: string;
  smsZnsAuto: boolean;
  calendarSync: boolean;
  isCompleted: boolean;
  unitCode?: string;
  unitPrice?: string;
}

// ---------------------------------------------------------------------------
// Việc hôm nay (chuẩn = DailyTask riêng của Admin; Mobile cũ suy từ Customer.category)
// ---------------------------------------------------------------------------

export type TaskCategory = 'overdue' | 'today' | 'upcoming';

export interface DailyTask {
  id: string;
  customerId: string;
  customerName: string;
  customerPhone: string;
  statusTag: CustomerStatus;
  projectName: string;
  category: TaskCategory;
  overdueText?: string;
  timeText?: string;
  dateText?: string;
  content: string;
  aiSuggestion?: string;
  assignee: string;
  /** Việc sinh ra từ lịch hẹn (nếu có). */
  appointmentId?: string;
}

// ---------------------------------------------------------------------------
// Danh mục / báo cáo
// ---------------------------------------------------------------------------

export interface StaffPerformance {
  rank: number;
  name: string;
  role: string;
  avatarText: string;
  avatarBg: string;
  customersHandled: number;
  hotLeads: number;
  appointmentsCompleted: number;
  salesOrDeposits: string;
  projectName: string;
  kpiRate: number;
}

export interface Project {
  id: string;
  /** Tên ngắn dùng xuyên suốt dữ liệu khách/lịch, vd "Q'Terra". */
  name: string;
  /** Tên đầy đủ hiển thị ở trang Dự án. */
  fullName: string;
  location: string;
  price: string;
  status: string;
  segment: string;
}

export interface StaffMember {
  id: string;
  name: string;
  role: string;
}

// ---------------------------------------------------------------------------
// Bộ lọc (Mobile)
// ---------------------------------------------------------------------------

export type FilterTimeRange = 'week' | 'month' | 'quarter' | 'year';

export interface FilterOptions {
  search: string;
  status: 'all' | LeadStatus;
  /** 'all' hoặc tên dự án. */
  project: string;
  projectsSelected: string[];
  /** 'all' hoặc id nhân viên. */
  staff: string;
  timeRange: FilterTimeRange;
}
