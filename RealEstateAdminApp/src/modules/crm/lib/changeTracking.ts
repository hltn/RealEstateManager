/**
 * So sánh 2 phiên bản hồ sơ khách -> danh sách thay đổi "trường nào, cũ -> mới" bằng chữ hiển thị (X4).
 * CCCD luôn che (04 §3.7 "changes ... CCCD luôn che"). Hàm thuần, reducer gọi cho MỌI cập nhật khách.
 */
import { PERSONA_FIELDS } from '@crm/data/personaFields';
import type { CareTeamMember, CrmCatalogs, CrmUser, Customer, FieldChange, PersonaValue } from '@crm/types/crm';
import { CRITERIA_KEYS, CRITERION_LABELS, findPersonaValue, formatBudgetRange, maskNationalId } from './customerRules';
import { formatIsoDateVi } from './dateTime';
import { formatPhoneDisplay } from './phone';

const EMPTY = '(trống)';


const orEmpty = (value: string): string => (value.trim() ? value : EMPTY);

const labelOf = <T extends { id: string }>(items: readonly T[], id: string | null, getLabel: (item: T) => string): string => {
  if (!id) return EMPTY;
  const item = items.find((candidate) => candidate.id === id);
  return item ? getLabel(item) : id;
};

const labelsOf = <T extends { id: string }>(items: readonly T[], ids: readonly string[], getLabel: (item: T) => string): string =>
  ids.length === 0 ? EMPTY : ids.map((id) => labelOf(items, id, getLabel)).join(', ');

const describeCareTeam = (careTeam: readonly CareTeamMember[], users: readonly CrmUser[]): string =>
  careTeam.length === 0
    ? EMPTY
    : careTeam
        .map((member) => `${labelOf(users, member.userId, (user) => user.displayName)}${member.role === 'PRIMARY' ? ' (chính)' : ''}`)
        .join(', ');

/** Giá trị chân dung -> chữ hiển thị. */
export const describePersonaValue = (value: PersonaValue | undefined): string => {
  if (!value) return EMPTY;
  if (value.valueDate) return formatIsoDateVi(value.valueDate);
  if (value.valueOptions && value.valueOptions.length > 0) return value.valueOptions.join(', ');
  if (value.valueNumber || value.valueNumberTo) return formatBudgetRange(value.valueNumber ?? 0, value.valueNumberTo ?? 0) || EMPTY;
  if (value.valueBoolean !== undefined) return value.valueBoolean ? 'Có' : 'Không';
  return orEmpty(value.valueText ?? '');
};

/** Diff 2 hồ sơ khách theo các trường người dùng nhìn thấy. */
export const diffCustomer = (
  before: Customer,
  after: Customer,
  catalogs: CrmCatalogs,
  users: readonly CrmUser[],
): FieldChange[] => {
  const changes: FieldChange[] = [];
  const push = (field: string, from: string, to: string) => {
    if (from !== to) changes.push({ field, from, to });
  };

  push('Họ tên', orEmpty(before.fullName), orEmpty(after.fullName));
  // Lịch sử hiển thị SĐT cũ -> mới ĐẦY ĐỦ cho người xem được khách (Oniichan đồng ý; cùng quyền với danh sách/chi tiết).
  push('Số điện thoại', formatPhoneDisplay(before.phone), formatPhoneDisplay(after.phone));
  push('Email', orEmpty(before.email), orEmpty(after.email));
  push(
    'Tình trạng',
    labelOf(catalogs.statuses, before.statusId, (status) => status.label),
    labelOf(catalogs.statuses, after.statusId, (status) => status.label),
  );
  push(
    'Nguồn khách',
    labelOf(catalogs.leadSources, before.sourceId, (source) => source.label),
    labelOf(catalogs.leadSources, after.sourceId, (source) => source.label),
  );
  push(
    'Dự án quan tâm',
    labelsOf(catalogs.projects, before.interestedProjectIds, (project) => project.name),
    labelsOf(catalogs.projects, after.interestedProjectIds, (project) => project.name),
  );
  push('Khu vực', labelOf(catalogs.areas, before.areaId, (area) => area.name), labelOf(catalogs.areas, after.areaId, (area) => area.name));
  push('Thẻ', labelsOf(catalogs.tags, before.tagIds, (tag) => tag.name), labelsOf(catalogs.tags, after.tagIds, (tag) => tag.name));
  push('CCCD', orEmpty(maskNationalId(before.nationalIdLast4)), orEmpty(maskNationalId(after.nationalIdLast4)));
  push('Nhóm chăm sóc', describeCareTeam(before.careTeam, users), describeCareTeam(after.careTeam, users));
  push('Ghi chú', orEmpty(before.notes), orEmpty(after.notes));
  push('Nhắc dịp đặc biệt', before.shouldRemindOccasions ? 'Bật' : 'Tắt', after.shouldRemindOccasions ? 'Bật' : 'Tắt');

  CRITERIA_KEYS.forEach((key) => {
    const label = CRITERION_LABELS[key];
    push(`${label} (đạt)`, before.criteria[key].isDone ? 'Đạt' : 'Chưa đạt', after.criteria[key].isDone ? 'Đạt' : 'Chưa đạt');
    push(`${label} (mô tả)`, orEmpty(before.criteria[key].description), orEmpty(after.criteria[key].description));
  });

  PERSONA_FIELDS.forEach((field) => {
    push(
      `Chân dung: ${field.label}`,
      describePersonaValue(findPersonaValue(before.persona, field.key)),
      describePersonaValue(findPersonaValue(after.persona, field.key)),
    );
  });

  return changes;
};
