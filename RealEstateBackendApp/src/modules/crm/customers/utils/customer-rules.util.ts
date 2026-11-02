import { Types } from 'mongoose';
import { ListGroup } from '../../catalogs/catalog.enums';
import {
  AUTO_STATUS_PROGRESS_THRESHOLD,
  CRITERIA_KEYS,
  CriteriaKey,
  NATIONAL_ID_MASK_PREFIX,
} from '../customer.constants';

/** CCCD 12 số hoặc CMND cũ 9 số (tài liệu 05 mục 2.4). */
export const NATIONAL_ID_PATTERN = /^(?:\d{9}|\d{12})$/;

/** Tiến độ = số tiêu chí hoàn thành x 25 (C5, QT1). Server tính, không nhận từ client. */
export const computeProgress = (
  criteria: Partial<
    Record<(typeof CRITERIA_KEYS)[number], { isDone?: boolean }>
  >,
): number =>
  CRITERIA_KEYS.filter((key) => criteria[key]?.isDone === true).length * 25;

/** `••••1234` từ CCCD đầy đủ; chỉ dùng khi vừa nhập, không bao giờ log. */
export const lastFourDigits = (nationalId: string): string =>
  nationalId.slice(-4);

export const maskNationalId = (
  last4: string | null | undefined,
): string | null => (last4 ? `${NATIONAL_ID_MASK_PREFIX}${last4}` : null);

/** AAD gắn bản mã CCCD với đúng khách và đúng trường (tài liệu: bắt buộc từ M2). */
export const nationalIdAad = (customerId: string): string =>
  `${customerId}:nationalId`;

export interface CriterionValue {
  isDone: boolean;
  description: string;
  updatedBy: Types.ObjectId | null;
  updatedAt: Date | null;
}
export type CriteriaValue = Record<CriteriaKey, CriterionValue>;
export type CriteriaInput = Partial<
  Record<CriteriaKey, { isDone?: boolean; description?: string }>
>;

const emptyCriterion = (): CriterionValue => ({
  isDone: false,
  description: '',
  updatedBy: null,
  updatedAt: null,
});

/**
 * Áp dữ liệu tiêu chí gửi lên lên giá trị hiện có. Chỉ tiêu chí THỰC SỰ đổi mới được ghi `updatedBy/updatedAt`
 * (và nằm trong `changedKeys`); tiêu chí gửi lên giống hệt giá trị cũ giữ nguyên.
 */
export const mergeCriteria = (
  current: Partial<Record<CriteriaKey, Partial<CriterionValue>>> | undefined,
  input: CriteriaInput,
  actorId: Types.ObjectId,
  now: Date,
): { next: CriteriaValue; changedKeys: CriteriaKey[] } => {
  const next = {} as CriteriaValue;
  const changedKeys: CriteriaKey[] = [];
  for (const key of CRITERIA_KEYS) {
    const existing = { ...emptyCriterion(), ...(current?.[key] ?? {}) };
    const patch = input[key];
    const isDone = patch?.isDone ?? existing.isDone;
    const description = patch?.description ?? existing.description;
    if (isDone !== existing.isDone || description !== existing.description) {
      next[key] = { isDone, description, updatedBy: actorId, updatedAt: now };
      changedKeys.push(key);
    } else {
      next[key] = existing;
    }
  }
  return { next, changedKeys };
};

/** Mã tình trạng hệ thống mà cơ chế tự chuyển (PT-023) có thể đặt. */
export type AutoStatusTarget = 'NET' | 'INTERESTED';

export interface AutoStatusInput {
  prevProgress: number;
  nextProgress: number;
  currentGroup: ListGroup;
  currentCode: string;
  /** Tình trạng NET hiện tại do cơ chế tự động đặt (`statusAutoSource` có giá trị). */
  isAutoSet: boolean;
}

/**
 * PT-023: tiến độ có đi qua mốc 3/4 (75) không (về đúng 75 từ giá trị khác 75, kể cả 100 -> 75; hoặc từ >= 75 xuống
 * dưới 75). Dùng để bỏ qua sớm, không tốn truy vấn tra tình trạng khi chắc chắn không có gì để tự chuyển
 * (vd 0 -> 25, 75 -> 100, 75 -> 75).
 */
export const crossesAutoStatusThreshold = (
  prevProgress: number,
  nextProgress: number,
): boolean =>
  (nextProgress === AUTO_STATUS_PROGRESS_THRESHOLD &&
    prevProgress !== AUTO_STATUS_PROGRESS_THRESHOLD) ||
  (nextProgress < AUTO_STATUS_PROGRESS_THRESHOLD &&
    prevProgress >= AUTO_STATUS_PROGRESS_THRESHOLD);

/**
 * PT-023: quyết định tự chuyển tình trạng khi tiến độ đổi. Hàm thuần, không đụng DB.
 * - Tiến độ MỚI bằng đúng 75 và tiến độ cũ khác 75 (từ dưới 75 lên, hoặc 100 -> 75) và khách đang ở nhóm
 *   Chưa tiếp cận/Có quan tâm -> `NET`. 4/4 (next = 100) không kích hoạt.
 * - Xuống dưới 75 (từ >= 75) và khách đang NET do cơ chế tự động đặt -> `INTERESTED`.
 * - Còn lại (DROPPED, nhóm cao hơn, NET đổi tay/có sẵn không marker, tiến độ không đổi...) -> `null` (không đổi).
 */
export const decideAutoStatus = ({
  prevProgress,
  nextProgress,
  currentGroup,
  currentCode,
  isAutoSet,
}: AutoStatusInput): AutoStatusTarget | null => {
  const threshold = AUTO_STATUS_PROGRESS_THRESHOLD;
  if (
    nextProgress === threshold &&
    prevProgress !== threshold &&
    (currentGroup === ListGroup.NOT_CONTACTED ||
      currentGroup === ListGroup.INTERESTED)
  ) {
    return 'NET';
  }
  if (
    nextProgress < threshold &&
    prevProgress >= threshold &&
    currentCode === 'NET' &&
    isAutoSet
  ) {
    return 'INTERESTED';
  }
  return null;
};
