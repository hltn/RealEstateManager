/**
 * Quy tắc nghiệp vụ thuần của khách hàng (tài liệu 01 mục 4) — dùng chung store, lớp truy cập dữ liệu và UI.
 * Không đọc store, không side effect -> test trực tiếp.
 */
import { diffDateKeys, getMonthDay, getVnTodayKey, toVnDateKey } from './dateTime';
import { getPhoneSearchVariants } from './phone';
import { normalizeVietnamese } from './text';
import type {
  CareTeamMember,
  Criteria,
  CriterionKey,
  CrmUser,
  Customer,
  CustomerStatusItem,
  ListGroup,
  Occasion,
  PersonaFieldDefinition,
  PersonaValue,
} from '@crm/types/crm';

// ---------------------------------------------------------------------------
// 4 tiêu chí tương tác + tiến độ (C4, C5, QT1)
// ---------------------------------------------------------------------------

export const CRITERIA_KEYS: readonly CriterionKey[] = ['demand', 'motivation', 'finance', 'timing'];

export const CRITERION_LABELS: Record<CriterionKey, string> = {
  demand: 'Nhu cầu',
  motivation: 'Động cơ',
  finance: 'Tài chính',
  timing: 'Thời gian',
};

/** Mỗi tiêu chí hoàn thành = 25% tiến độ. */
export const CRITERION_PERCENT = 25;

export const createEmptyCriteria = (): Criteria => ({
  demand: { isDone: false, description: '', updatedAt: null, updatedBy: null },
  motivation: { isDone: false, description: '', updatedAt: null, updatedBy: null },
  finance: { isDone: false, description: '', updatedAt: null, updatedBy: null },
  timing: { isDone: false, description: '', updatedAt: null, updatedBy: null },
});

export const countDoneCriteria = (criteria: Criteria): number => CRITERIA_KEYS.filter((key) => criteria[key].isDone).length;

/**
 * NGUỒN DUY NHẤT tính tiến độ (QT1): số tiêu chí hoàn thành / 4 -> {0, 25, 50, 75, 100}.
 * Không lưu tiến độ; mọi màn (bảng, thẻ, chi tiết, báo cáo, bộ lọc) gọi hàm này.
 */
export const getProgressPercent = (criteria: Criteria): number => countDoneCriteria(criteria) * CRITERION_PERCENT;

export const PROGRESS_VALUES = [0, 25, 50, 75, 100] as const;

// ---------------------------------------------------------------------------
// Tình trạng & nhóm danh sách (C6, QT2)
// ---------------------------------------------------------------------------

export const LIST_GROUP_LABELS: Record<ListGroup, string> = {
  NOT_CONTACTED: 'Chưa tiếp cận',
  INTERESTED: 'Có quan tâm',
  NET: 'Khách net',
  DROPPED: 'Bỏ',
};

export const findStatus = (statuses: readonly CustomerStatusItem[], statusId: string): CustomerStatusItem | undefined =>
  statuses.find((status) => status.id === statusId);

/** Tình trạng mặc định khi tạo khách ("Chưa tiếp cận"). */
export const getDefaultStatus = (statuses: readonly CustomerStatusItem[]): CustomerStatusItem | undefined =>
  statuses.find((status) => status.isDefault && status.isActive) ?? statuses.find((status) => status.isActive);

export const getListGroupOfStatus = (statuses: readonly CustomerStatusItem[], statusId: string): ListGroup =>
  findStatus(statuses, statusId)?.listGroup ?? 'NOT_CONTACTED';

/** Tình trạng có mã DROPPED (hoặc nhóm DROPPED) -> cần hộp xác nhận + Hoàn tác (02 §5). */
export const isDroppedStatus = (status: Pick<CustomerStatusItem, 'listGroup'> | undefined): boolean =>
  status?.listGroup === 'DROPPED';

// ---------------------------------------------------------------------------
// Nhóm chăm sóc (C8, QT7): đúng 1 PRIMARY nếu không rỗng, không trùng người
// ---------------------------------------------------------------------------

export const getPrimaryUserId = (careTeam: readonly CareTeamMember[]): string | null =>
  careTeam.find((member) => member.role === 'PRIMARY')?.userId ?? null;

export const isCareTeamValid = (careTeam: readonly CareTeamMember[]): boolean => {
  if (careTeam.length === 0) return true;
  const userIds = careTeam.map((member) => member.userId);
  const primaryCount = careTeam.filter((member) => member.role === 'PRIMARY').length;
  return primaryCount === 1 && new Set(userIds).size === userIds.length;
};

/** Số ngày (theo NGÀY GIỜ VN) kể từ lần chăm sóc gần nhất (hoặc ngày tạo nếu chưa có nhật ký). */
export const getIdleDays = (customer: { lastCareLogAt: string | null; createdAt: string }, now: Date = new Date()): number =>
  diffDateKeys(toVnDateKey(customer.lastCareLogAt ?? customer.createdAt), getVnTodayKey(now));

/** "Khách lâu chưa chăm sóc": nhóm NOT_CONTACTED hoặc INTERESTED và quá `staleDays` ngày (giờ VN). MỘT định nghĩa dùng cho dashboard + Việc hôm nay (TB7). */
export const isStaleCustomer = (
  customer: Pick<Customer, 'lastCareLogAt' | 'createdAt' | 'statusId'>,
  statuses: readonly CustomerStatusItem[],
  staleDays: number,
  now: Date = new Date(),
): boolean => {
  const listGroup = getListGroupOfStatus(statuses, customer.statusId);
  return (listGroup === 'NOT_CONTACTED' || listGroup === 'INTERESTED') && getIdleDays(customer, now) >= staleDays;
};

/** Id người KHÔNG thể được phân chăm sóc: không tồn tại, đã khoá hoặc là Quản trị (QT6: Quản trị chỉ xem/quản lý, không chăm sóc). */
export const findNonAssignableUserIds = (users: readonly Pick<CrmUser, 'id' | 'isActive' | 'role'>[], userIds: readonly string[]): string[] =>
  [...new Set(userIds)].filter((userId) => !users.some((user) => user.id === userId && user.isActive && user.role !== 'ADMIN'));

/** Dựng nhóm chăm sóc: 1 PRIMARY + các MEMBER (bỏ trùng, bỏ người trùng PRIMARY). */
export const buildCareTeam = (
  primaryUserId: string | null,
  memberIds: readonly string[],
  addedBy: string,
  addedAt: string,
): CareTeamMember[] => {
  if (!primaryUserId) return [];
  const members = [...new Set(memberIds)].filter((userId) => userId && userId !== primaryUserId);
  return [
    { userId: primaryUserId, role: 'PRIMARY', addedBy, addedAt },
    ...members.map((userId) => ({ userId, role: 'MEMBER' as const, addedBy, addedAt })),
  ];
};

export const isInCareTeam = (careTeam: readonly CareTeamMember[], userId: string): boolean =>
  careTeam.some((member) => member.userId === userId);

// ---------------------------------------------------------------------------
// Chân dung (C10, C12, C13, QT9) — attribute pattern
// ---------------------------------------------------------------------------

export const findPersonaValue = (persona: readonly PersonaValue[], fieldKey: string): PersonaValue | undefined =>
  persona.find((value) => value.fieldKey === fieldKey);

export const getPersonaText = (persona: readonly PersonaValue[], fieldKey: string): string =>
  findPersonaValue(persona, fieldKey)?.valueText ?? '';

export const getPersonaDate = (persona: readonly PersonaValue[], fieldKey: string): string =>
  findPersonaValue(persona, fieldKey)?.valueDate ?? '';

/** Giá trị chân dung "có dữ liệu" (dùng cho độ đầy đủ + gợi ý còn thiếu). */
export const hasPersonaData = (value: PersonaValue | undefined): boolean => {
  if (!value) return false;
  return Boolean(
    value.valueText?.trim() ||
      value.valueDate ||
      (value.valueOptions && value.valueOptions.length > 0) ||
      (value.valueNumber ?? 0) > 0 ||
      (value.valueNumberTo ?? 0) > 0 ||
      value.valueBoolean === true,
  );
};

/** Phần cập nhật 1 trường: `null` = xoá giá trị. */
export type PersonaPatch = Omit<PersonaValue, 'source' | 'updatedBy' | 'updatedAt'>;

export interface PersonaUpdate {
  fieldKey: string;
  value: PersonaPatch | null;
  source: PersonaValue['source'];
}

/**
 * Áp các cập nhật chân dung: chỉ ghi lại người/ngày/nguồn cho trường THỰC SỰ đổi giá trị (QT9);
 * trường giữ nguyên thì giữ metadata cũ; giá trị rỗng -> xoá khỏi mảng.
 */
export const applyPersonaUpdates = (
  persona: readonly PersonaValue[],
  updates: readonly PersonaUpdate[],
  actorId: string,
  now: string,
): { persona: PersonaValue[]; changedKeys: string[] } => {
  const next = new Map(persona.map((value) => [value.fieldKey, value]));
  const changedKeys: string[] = [];
  updates.forEach(({ fieldKey, value, source }) => {
    const current = next.get(fieldKey);
    const candidate: PersonaValue | null =
      value && hasPersonaData({ ...value, source, updatedBy: actorId, updatedAt: now })
        ? { ...value, fieldKey, source, updatedBy: actorId, updatedAt: now }
        : null;
    const isSame = JSON.stringify(stripMeta(current)) === JSON.stringify(stripMeta(candidate ?? undefined));
    if (isSame) return;
    changedKeys.push(fieldKey);
    if (candidate) next.set(fieldKey, candidate);
    else next.delete(fieldKey);
  });
  return { persona: [...next.values()], changedKeys };
};

const stripMeta = (value: PersonaValue | undefined): Partial<PersonaPatch> | null => {
  if (!value || !hasPersonaData(value)) return null;
  const { fieldKey, valueText, valueNumber, valueNumberTo, valueDate, valueOptions, valueBoolean } = value;
  return {
    fieldKey,
    valueText: valueText?.trim() || undefined,
    valueNumber: valueNumber || undefined,
    valueNumberTo: valueNumberTo || undefined,
    valueDate: valueDate || undefined,
    valueOptions: valueOptions && valueOptions.length > 0 ? [...valueOptions] : undefined,
    valueBoolean: valueBoolean || undefined,
  };
};

/**
 * Độ đầy đủ chân dung (C12, 04 §3.2.2):
 * round(Σ weight các trường active đã có giá trị / Σ weight các trường active × 100).
 */
export const computePersonaCompleteness = (
  persona: readonly PersonaValue[],
  fields: readonly PersonaFieldDefinition[],
): number => {
  const activeFields = fields.filter((field) => field.isActive);
  const totalWeight = activeFields.reduce((total, field) => total + field.weight, 0);
  if (totalWeight === 0) return 0;
  const filledWeight = activeFields
    .filter((field) => hasPersonaData(findPersonaValue(persona, field.key)))
    .reduce((total, field) => total + field.weight, 0);
  return Math.round((filledWeight / totalWeight) * 100);
};

/** Gợi ý "nên hỏi ở lần chăm sóc tới": trường active chưa có giá trị, sắp theo `suggestPriority`, tối đa `limit`. */
export const getMissingPersonaFields = (
  persona: readonly PersonaValue[],
  fields: readonly PersonaFieldDefinition[],
  limit = 5,
): PersonaFieldDefinition[] =>
  fields
    .filter((field) => field.isActive && !hasPersonaData(findPersonaValue(persona, field.key)))
    .sort((first, second) => first.suggestPriority - second.suggestPriority)
    .slice(0, limit);

/** Sinh danh sách dịp đặc biệt từ các trường DATE `isOccasion` có giá trị (C13). */
export const computeOccasions = (
  persona: readonly PersonaValue[],
  fields: readonly PersonaFieldDefinition[],
): Occasion[] =>
  fields
    .filter((field) => field.isActive && field.isOccasion && field.type === 'DATE')
    .flatMap((field) => {
      const dateKey = getPersonaDate(persona, field.key);
      const monthDay = dateKey ? getMonthDay(dateKey) : null;
      return monthDay ? [{ fieldKey: field.key, month: monthDay.month, day: monthDay.day, year: Number(dateKey.slice(0, 4)) }] : [];
    });

// ---------------------------------------------------------------------------
// Tìm kiếm + hiển thị
// ---------------------------------------------------------------------------

/** `searchText` (04 §3.2): họ tên bỏ dấu + các biến thể SĐT + email. */
export const buildSearchText = (input: { fullName: string; phone: string; email?: string }): string =>
  [normalizeVietnamese(input.fullName), ...getPhoneSearchVariants(input.phone), input.email?.toLowerCase() ?? '']
    .filter(Boolean)
    .join(' ');

/** "1234" -> "••••1234" (C9: chỉ hiện 4 số cuối). */
export const maskNationalId = (last4: string | null): string => (last4 ? `••••${last4}` : '');

/** CCCD 12 số hoặc CMND 9 số (cho phép khoảng trắng). Rỗng = hợp lệ (không bắt buộc). */
export const isValidNationalId = (value: string): boolean => {
  const compact = value.replace(/\s/g, '');
  return compact === '' || /^(\d{9}|\d{12})$/.test(compact);
};

const ONE_BILLION = 1_000_000_000;
const ONE_MILLION = 1_000_000;

/** Tiền VNĐ theo cách nói quen thuộc (02 §9): 2_500_000_000 -> "2,5 tỷ"; 800_000_000 -> "800 triệu". */
export const formatMoneyVnd = (amount: number): string => {
  if (!Number.isFinite(amount) || amount <= 0) return '';
  if (amount >= ONE_BILLION) return `${(amount / ONE_BILLION).toLocaleString('vi-VN', { maximumFractionDigits: 2 })} tỷ`;
  return `${Math.round(amount / ONE_MILLION).toLocaleString('vi-VN')} triệu`;
};

/** Khoảng ngân sách: "5 – 7 tỷ" / "từ 5 tỷ" / "đến 7 tỷ" / "". */
export const formatBudgetRange = (from: number, to: number): string => {
  if (from > 0 && to > 0) return `${formatMoneyVnd(from)} – ${formatMoneyVnd(to)}`;
  if (from > 0) return `từ ${formatMoneyVnd(from)}`;
  if (to > 0) return `đến ${formatMoneyVnd(to)}`;
  return '';
};

/** Tỷ (đơn vị form) <-> VNĐ (đơn vị lưu). */
export const billionToVnd = (billion: number): number => Math.round(billion * ONE_BILLION);
export const vndToBillion = (vnd: number): number => Math.round((vnd / ONE_BILLION) * 100) / 100;
