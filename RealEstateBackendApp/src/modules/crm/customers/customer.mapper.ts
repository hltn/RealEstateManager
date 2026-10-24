import { Types } from 'mongoose';
import { CrmActor } from '../common/access/crm-actor';
import { maskPhone } from '../common/utils/phone-normalizer.util';
import { isAdminOrManager } from './access/customer-scope';
import { CareRole, CRITERIA_KEYS } from './customer.constants';
import type { CustomerLean } from './customers.repository';
import type { RefIds, RefMaps } from './customer-refs.service';
import { toRef, toUserRef } from './customer-refs.service';
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
  'fullName phone statusId sourceId interestedProjectIds areaId tagIds progress criteria.demand.isDone criteria.motivation.isDone criteria.finance.isDone criteria.timing.isDone careTeam.userId primaryAssigneeId nextAppointmentAt lastCareLogAt lastUpdatedAt personaCompleteness deletedAt deletedBy anonymizedAt';

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

export const toListItem = (
  doc: CustomerLean,
  refs: RefMaps,
): CustomerListItemDto => ({
  id: String(doc._id),
  fullName: doc.fullName,
  phoneMasked: doc.anonymizedAt ? '••••' : maskPhone(doc.phone),
  status: refs.statuses.get(String(doc.statusId)) ?? emptyStatus(doc.statusId),
  source: toRef(doc.sourceId, refs.sources),
  projects: (doc.interestedProjectIds ?? []).map(
    (id) => toRef(id, refs.projects)!,
  ),
  area: toRef(doc.areaId, refs.areas),
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
): DeletedCustomerListItemDto => ({
  ...toListItem(doc, refs),
  deletedAt: iso(doc.deletedAt)!,
  deletedBy: toUserRef(doc.deletedBy, refs.users),
  anonymizedAt: iso(doc.anonymizedAt),
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
  const careTeam: CareTeamMemberDto[] = (doc.careTeam ?? []).map((member) => ({
    user: toUserRef(member.userId, refs.users)!,
    role: member.role,
    addedAt: iso(member.addedAt)!,
    addedBy: toUserRef(member.addedBy, refs.users),
  }));
  return {
    ...toListItem(doc, refs),
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
      canDelete: privileged,
    },
    version: doc.__v ?? 0,
  };
};
