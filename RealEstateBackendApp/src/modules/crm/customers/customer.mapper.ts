import { Types } from 'mongoose';
import { CrmActor } from '../common/access/crm-actor';
import { maskPhone } from '../common/utils/phone-normalizer.util';
import { ListGroup } from '../catalogs/catalog.enums';
import { getDeleteDenial } from './access/customer-delete-policy';
import { isAdminOrManager } from './access/customer-scope';
import { CareRole, CRITERIA_KEYS } from './customer.constants';
import type { CustomerLean } from './customers.repository';
import type { RefIds, RefMaps } from './customer-refs.service';
import { toCatalogRef, toRef, toUserRef } from './customer-refs.service';
import {
  CareTeamMemberDto,
  CriteriaDoneDto,
  CriteriaResponseDto,
  CriterionResponseDto,
  CustomerDetailDto,
  CustomerListItemDto,
  DataConsentResponseDto,
  DeletedCustomerListItemDto,
  StatusRefDto,
} from './dtos/customer-response.dto';
import { maskNationalId } from './utils/customer-rules.util';

/** Field cần đọc để dựng list item (KHÔNG gồm nationalId, searchText). */
export const LIST_PROJECTION =
  'fullName phone statusId sourceId sourceCode interestedProjectIds areaId areaCode tagIds progress criteria.demand.isDone criteria.motivation.isDone criteria.finance.isDone criteria.timing.isDone careTeam.userId primaryAssigneeId nextAppointmentAt lastCareLogAt lastUpdatedAt personaCompleteness deletedAt deletedBy anonymizedAt purgingAt';

const iso = (date: Date | null | undefined): string | null =>
  date ? new Date(date).toISOString() : null;

/** Gom id cần dịch nhãn của một lô khách (một lần `$in` mỗi loại). */
export const collectRefIds = (docs: CustomerLean[]): RefIds => ({
  statusIds: docs.map((doc) => doc.statusId),
  sourceIds: docs.map((doc) => doc.sourceId),
  areaIds: docs.map((doc) => doc.areaId),
  projectIds: docs.flatMap((doc) => doc.interestedProjectIds ?? []),
  tagIds: docs.flatMap((doc) => doc.tagIds ?? []),
  userIds: docs.flatMap((doc) => [
    doc.primaryAssigneeId,
    doc.lastUpdatedBy,
    doc.createdBy,
    doc.deletedBy,
    ...(doc.careTeam ?? []).flatMap((member) => [
      member.userId,
      member.addedBy,
    ]),
    ...CRITERIA_KEYS.map((key) => doc.criteria?.[key]?.updatedBy),
    doc.dataConsent?.recordedBy,
  ]),
});

const emptyStatus = (id: Types.ObjectId): StatusRefDto => ({
  id: String(id),
  code: '',
  label: '',
  listGroup: undefined as never,
  color: null,
});

/**
 * SĐT đã che để hiển thị (VD `0912 ••• 678`). Khách đã ẩn danh hiện `••••`; thiếu SĐT (dữ liệu cũ) trả chuỗi rỗng thay vì
 * ném lỗi. Dùng chung cho danh sách khách, lịch hẹn và việc hôm nay để mọi nơi che đúng một kiểu, không bao giờ lộ số đầy đủ.
 */
export const toPhoneMasked = (doc: {
  phone?: string | null;
  anonymizedAt?: Date | null;
}): string => {
  if (doc.anonymizedAt) return '••••';
  return doc.phone ? maskPhone(doc.phone) : '';
};

export const toListItem = (
  doc: CustomerLean,
  refs: RefMaps,
): CustomerListItemDto => ({
  id: String(doc._id),
  fullName: doc.fullName,
  phoneMasked: toPhoneMasked(doc),
  status: refs.statuses.get(String(doc.statusId)) ?? emptyStatus(doc.statusId),
  // FR-40: `code` dịch từ id (đổi nhãn không đổi mã); danh mục bị xóa cứng thì rơi về mã đã lưu (nguồn, khu vực) hoặc rỗng, không lỗi.
  source: toCatalogRef(
    doc.sourceId,
    refs.sources,
    refs.codes.sources,
    doc.sourceCode,
  ),
  projects: (doc.interestedProjectIds ?? []).map(
    (id) => toCatalogRef(id, refs.projects, refs.codes.projects)!,
  ),
  area: toCatalogRef(doc.areaId, refs.areas, refs.codes.areas, doc.areaCode),
  tags: (doc.tagIds ?? []).flatMap((id) => {
    const ref = toRef(id, refs.tags);
    // Thẻ đã xóa mềm không có nhãn trong `refs.tags` => không hiện.
    return ref && refs.tags.has(ref.id) ? [ref] : [];
  }),
  progress: doc.progress ?? 0,
  criteriaDone: criteriaDone(doc),
  primaryAssignee: toUserRef(doc.primaryAssigneeId, refs.users),
  careTeamSize: doc.careTeam?.length ?? 0,
  nextAppointmentAt: iso(doc.nextAppointmentAt),
  lastCareLogAt: iso(doc.lastCareLogAt),
  lastUpdatedAt: iso(doc.lastUpdatedAt)!,
  personaCompleteness: doc.personaCompleteness ?? 0,
});

export const toDeletedListItem = (
  doc: CustomerLean,
  refs: RefMaps,
  deleteReason: string | null,
): DeletedCustomerListItemDto => ({
  ...toListItem(doc, refs),
  deletedAt: iso(doc.deletedAt)!,
  deletedBy: toUserRef(doc.deletedBy, refs.users),
  anonymizedAt: iso(doc.anonymizedAt),
  deleteReason,
  purgeInProgress: doc.purgingAt != null,
});

const criteriaDone = (doc: CustomerLean): CriteriaDoneDto => ({
  demand: doc.criteria?.demand?.isDone === true,
  motivation: doc.criteria?.motivation?.isDone === true,
  finance: doc.criteria?.finance?.isDone === true,
  timing: doc.criteria?.timing?.isDone === true,
});

export const toCriteriaResponse = (
  doc: Pick<CustomerLean, 'criteria'>,
  users: Map<string, string>,
): CriteriaResponseDto => {
  const one = (key: (typeof CRITERIA_KEYS)[number]): CriterionResponseDto => {
    const criterion = doc.criteria?.[key];
    return {
      isDone: criterion?.isDone === true,
      description: criterion?.description ?? '',
      updatedAt: iso(criterion?.updatedAt),
      updatedBy: toUserRef(criterion?.updatedBy, users),
    };
  };
  return {
    demand: one('demand'),
    motivation: one('motivation'),
    finance: one('finance'),
    timing: one('timing'),
  };
};

export const toConsentResponse = (
  doc: Pick<CustomerLean, 'dataConsent'>,
  users: Map<string, string>,
): DataConsentResponseDto => ({
  status: doc.dataConsent?.status,
  method: doc.dataConsent?.method ?? null,
  recordedBy: toUserRef(doc.dataConsent?.recordedBy, users),
  recordedAt: iso(doc.dataConsent?.recordedAt),
  note: doc.dataConsent?.note ?? null,
});

const isPrimary = (doc: CustomerLean, actor: CrmActor): boolean =>
  (doc.careTeam ?? []).some(
    (member) =>
      member.role === CareRole.PRIMARY && member.userId.equals(actor.userId),
  );

export const toDetail = (
  doc: CustomerLean,
  refs: RefMaps,
  actor: CrmActor,
): CustomerDetailDto => {
  const privileged = isAdminOrManager(actor);
  const primary = isPrimary(doc, actor);
  const listItem = toListItem(doc, refs);
  const careTeam: CareTeamMemberDto[] = (doc.careTeam ?? []).map((member) => ({
    user: toUserRef(member.userId, refs.users)!,
    role: member.role,
    addedAt: iso(member.addedAt)!,
    addedBy: toUserRef(member.addedBy, refs.users),
  }));
  return {
    ...listItem,
    email: doc.email ?? null,
    canViewPhone: true,
    criteria: toCriteriaResponse(doc, refs.users),
    careTeam,
    nationalIdMasked: maskNationalId(doc.nationalIdLast4),
    hasNationalId: doc.hasNationalId === true,
    canRevealNationalId: privileged || primary,
    dataConsent: toConsentResponse(doc, refs.users),
    lastUpdatedBy: toUserRef(doc.lastUpdatedBy, refs.users),
    createdAt: iso(doc.createdAt)!,
    createdBy: toUserRef(doc.createdBy, refs.users),
    createdVia: doc.createdVia,
    nextActionSuggestions: [],
    permissions: {
      canEdit: true,
      canManageCareTeam: privileged || primary,
      canChangePrimary: privileged,
      // Cùng một nguồn luật với route xóa (`getDeleteDenial`); FE chỉ hiện nút Xóa khi khách thuộc nhóm "Bỏ".
      canDelete:
        getDeleteDenial(actor, doc, {
          isDropped: listItem.status.listGroup === ListGroup.DROPPED,
          requireDropped: false,
        }) === null,
    },
    version: doc.__v ?? 0,
  };
};
