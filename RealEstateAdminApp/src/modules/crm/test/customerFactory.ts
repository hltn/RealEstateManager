/**
 * Dựng bản ghi `Customer` đầy đủ trường với giá trị mặc định an toàn — dùng cho test và dữ liệu nhập.
 * Trường phi chuẩn hoá (primaryAssigneeId, searchText, occasions, personaCompleteness) được tính từ dữ liệu gốc.
 */
import { PERSONA_FIELDS } from '@crm/data/personaFields';
import type { Customer } from '@crm/types/crm';
import { buildSearchText, computeOccasions, computePersonaCompleteness, createEmptyCriteria, getPrimaryUserId } from '@crm/lib/customerRules';

const EPOCH = '2026-01-01T00:00:00.000Z';

export const createCustomerRecord = (overrides: Partial<Customer> & Pick<Customer, 'id'>): Customer => {
  const base: Customer = {
    fullName: '',
    phone: '',
    email: '',
    statusId: 'st-not-contacted',
    statusChangedAt: EPOCH,
    sourceId: null,
    interestedProjectIds: [],
    areaId: null,
    tagIds: [],
    nationalIdLast4: null,
    hasNationalId: false,
    criteria: createEmptyCriteria(),
    careTeam: [],
    primaryAssigneeId: null,
    persona: [],
    occasions: [],
    personaCompleteness: 0,
    shouldRemindOccasions: true,
    notes: '',
    lastCareLogAt: null,
    nextAppointmentAt: null,
    searchText: '',
    createdAt: EPOCH,
    createdBy: 'admin',
    createdVia: 'WEB',
    lastUpdatedAt: EPOCH,
    lastUpdatedBy: 'admin',
    version: 1,
    ...overrides,
  };
  return {
    ...base,
    primaryAssigneeId: getPrimaryUserId(base.careTeam),
    searchText: buildSearchText(base),
    occasions: computeOccasions(base.persona, PERSONA_FIELDS),
    personaCompleteness: computePersonaCompleteness(base.persona, PERSONA_FIELDS),
  };
};
