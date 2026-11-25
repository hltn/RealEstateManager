/**
 * `toCustomerListItem`: field `purchasePurposes` (mã "Mục đích mua") đi từ DTO sang view; backend cũ chưa trả field -> `[]`.
 */
import { describe, expect, it } from 'vitest';
import type { CustomerListItemDto } from './dto';
import { toCustomerListItem, toDeletedCustomer } from './customerMappers';

const listDto = (overrides: Partial<CustomerListItemDto> = {}): CustomerListItemDto => ({
  id: 'c1',
  customerCode: 'KH-000001',
  fullName: 'Nguyễn Văn An',
  phoneMasked: '0912 ••• 678',
  status: { id: 's1', code: 'NOT_CONTACTED', label: 'Chưa tiếp cận', listGroup: 'NOT_CONTACTED', color: 'gray' },
  source: null,
  projects: [],
  area: null,
  tags: [],
  progress: 0,
  criteriaDone: { demand: false, motivation: false, finance: false, timing: false },
  primaryAssignee: null,
  careTeamSize: 0,
  nextAppointmentAt: '2026-10-25T02:00:00.000Z',
  lastCareLogAt: null,
  lastUpdatedAt: '2026-10-24T01:00:00.000Z',
  personaCompleteness: 0,
  ...overrides,
});

describe('toCustomerListItem - purchasePurposes', () => {
  it('giữ nguyên mã lựa chọn backend trả về, đúng thứ tự', () => {
    expect(toCustomerListItem(listDto({ purchasePurposes: ['LIVING', 'INVEST_RENT'] })).purchasePurposes).toEqual(['LIVING', 'INVEST_RENT']);
  });

  it('thiếu field (backend cũ) -> mặc định mảng rỗng, không ném lỗi', () => {
    expect(toCustomerListItem(listDto()).purchasePurposes).toEqual([]);
  });

  it('nextAppointmentAt: ISO từ DTO giữ đúng giá trị, null giữ null (thẻ mobile và sắp xếp vẫn dùng)', () => {
    expect(toCustomerListItem(listDto({ nextAppointmentAt: '2026-11-03T08:30:00.000Z' })).nextAppointmentAt).toBe('2026-11-03T08:30:00.000Z');
    expect(toCustomerListItem(listDto({ nextAppointmentAt: null })).nextAppointmentAt).toBeNull();
  });

  it('khách đã xóa (kế thừa mapper danh sách) cũng có purchasePurposes', () => {
    const deleted = toDeletedCustomer({ ...listDto({ purchasePurposes: ['RESORT'] }), deletedAt: 'd', deletedBy: null, anonymizedAt: null, deleteReason: null, purgeInProgress: false });
    expect(deleted.purchasePurposes).toEqual(['RESORT']);
  });
});
