/** Dựng `CustomerListItem` (dòng danh sách khách) đầy đủ trường cho test component; ghi đè từng trường qua `overrides`. */
import type { CustomerListItem } from '@crm/api';

export const makeListItem = (overrides: Partial<CustomerListItem> = {}): CustomerListItem => ({
  id: 'c1',
  customerCode: 'KH-000001',
  fullName: 'Nguyễn Văn An',
  phoneMasked: '0912 ••• 678',
  purchasePurposes: [],
  status: { id: 'NOT_CONTACTED', code: 'NOT_CONTACTED', label: 'Chưa tiếp cận', listGroup: 'NOT_CONTACTED', tone: 'gray' },
  source: null,
  projects: [],
  area: null,
  tags: [],
  progress: 0,
  criteriaDone: { demand: false, motivation: false, finance: false, timing: false },
  primaryAssignee: null,
  careTeamSize: 0,
  nextAppointmentAt: null,
  lastCareLogAt: null,
  lastUpdatedAt: '2026-10-24T01:00:00.000Z',
  personaCompleteness: 0,
  ...overrides,
});
