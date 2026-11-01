import { Types } from 'mongoose';
import {
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
