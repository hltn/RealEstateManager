/**
 * Adapter giữa mô hình Customer chuẩn (gốc Admin) và các dạng dữ liệu mà view Mobile cũ dùng.
 * Mọi hàm đều thuần (pure) - không đọc store, dễ test.
 */
import type {
  C4Criteria,
  CareLog,
  Customer,
  CustomerStatus,
  DealCriteria,
  InvestmentInfo,
  LeadStatus,
  TimelineEntry,
} from '@crm/types/crm';

// ---------------------------------------------------------------------------
// Trạng thái
// ---------------------------------------------------------------------------

const LEAD_STATUS_BY_CUSTOMER_STATUS: Record<CustomerStatus, LeadStatus> = {
  'Có quan tâm': 'caring',
  'Khách net': 'hot',
  'Chưa tiếp cận': 'untouched',
  'Bỏ / Không nhu cầu': 'dropped',
};

/** "Khách net" -> "hot" (mã trạng thái kiểu Mobile). */
export const toLeadStatus = (status: CustomerStatus): LeadStatus => LEAD_STATUS_BY_CUSTOMER_STATUS[status];

// ---------------------------------------------------------------------------
// Tiến độ
// ---------------------------------------------------------------------------

export const PROGRESS_STEP_COUNT = 4;

/** 50 (%) -> bước 2 trên 4 (dạng `progressStep: number` của Mobile). Luôn trong [1, 4]. */
export const getProgressStepIndex = (progressPercentage: number): number => {
  const step = Math.round((progressPercentage / 100) * PROGRESS_STEP_COUNT);
  return Math.min(PROGRESS_STEP_COUNT, Math.max(1, step));
};

// ---------------------------------------------------------------------------
// Persona: hashtag
// ---------------------------------------------------------------------------

/** "Golf" -> "#Golf" (Admin hiển thị tag có dấu #). */
export const toHashtag = (tag: string): string => (tag.startsWith('#') ? tag : `#${tag}`);

/** "#Golf" -> "Golf" (chuẩn hoá trước khi lưu). */
export const stripHashtag = (tag: string): string => tag.replace(/^#+/, '').trim();

// ---------------------------------------------------------------------------
// Ngân sách
// ---------------------------------------------------------------------------

/** 5 -> "5 tỷ"; 3.2 -> "3.2 tỷ". */
export const formatBudget = (budgetInBillion: number): string => `${budgetInBillion} tỷ`;

/** "5 tỷ" | "3,5 tỷ" | "4.8" -> số tỷ. Trả 0 nếu không đọc được. */
export const parseBudget = (text: string): number => {
  const match = /(\d+(?:[.,]\d+)?)/.exec(text);
  return match ? Number(match[1].replace(',', '.')) : 0;
};

// ---------------------------------------------------------------------------
// Thông tin đầu tư (Customer phẳng <-> investmentInfo lồng của Mobile)
// ---------------------------------------------------------------------------

export const toInvestmentInfo = (customer: Customer): InvestmentInfo => ({
  projects: customer.interestedProjects,
  budgetMin: formatBudget(customer.budgetMin),
  budgetMax: formatBudget(customer.budgetMax),
  ownCapitalRatio: customer.equityRatio,
  needsLoanSupport: customer.loanIncentive,
  propertyType: customer.propertyType,
  bedrooms: customer.bedroomType,
  purposes: customer.purchasePurposes,
  priorityCriteria: customer.criteriaPriorities,
  searchArea: customer.searchArea,
  specificLocation: customer.specificLocation,
  source: customer.leadSource,
  targetTimeline: customer.targetPurchaseTime,
});

/** Dự án chính của khách (Mobile `customer.project`). */
export const getPrimaryProject = (customer: Customer): string => customer.interestedProjects[0] ?? '';

// ---------------------------------------------------------------------------
// Tiêu chí C4 <-> dealCriteria
// ---------------------------------------------------------------------------

export const toDealCriteria = (c4: C4Criteria): DealCriteria => ({
  demand: { met: c4.demand.achieved, text: c4.demand.text },
  motivation: { met: c4.motivation.achieved, text: c4.motivation.text },
  finance: { met: c4.finance.achieved, text: c4.finance.text },
  timeline: { met: c4.timing.achieved, text: c4.timing.text },
});

/** Mỗi tiêu chí chiếm 25% (theo dữ liệu Admin). */
export const C4_CRITERION_PERCENT = 25;

/** Tổng % C4 đã đạt (vd 2 tiêu chí đạt -> 50). */
export const getC4AchievedPercent = (c4: C4Criteria): number =>
  Object.values(c4).reduce((total, criterion) => total + (criterion.achieved ? criterion.percent : 0), 0);

// ---------------------------------------------------------------------------
// Nhật ký chăm sóc -> timeline nhúng kiểu Mobile
// ---------------------------------------------------------------------------

/**
 * Chuyển danh sách CareLog (đã lọc theo khách, mới nhất trước) thành timeline Mobile.
 * Bản ghi đầu tiên được đánh dấu `isLatest`.
 */
export const toTimelineEntries = (careLogs: CareLog[]): TimelineEntry[] =>
  careLogs.map((log, index) => ({
    id: log.id,
    date: log.date,
    time: log.time,
    isLatest: index === 0,
    author: log.author,
    content: log.content,
    images: log.images ?? [],
  }));

/** Nhãn ngày giờ gộp kiểu Admin: "06/10 14:15". */
export const formatCareLogStamp = (log: Pick<CareLog, 'date' | 'time'>): string =>
  [log.date, log.time].filter(Boolean).join(' ');
