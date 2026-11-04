import { beforeEach, describe, expect, it, vi } from 'vitest';

const request = vi.fn();
vi.mock('../../../../api/axios', () => ({ default: { request: (config: unknown) => request(config) } }));

import { postBulkOperation } from './careApi';
import { deleteCustomerById, deletePurgeCustomer, fetchDeletedCustomers, postCustomerRestoration } from './customerApi';

beforeEach(() => request.mockReset());

describe('API xóa / khôi phục / xóa vĩnh viễn khách (hợp đồng doc 09 mục 7.4)', () => {
  it('xóa hàng loạt: reason nằm TRONG payload (không ở cấp ngoài)', async () => {
    request.mockResolvedValue({ data: { data: { succeeded: ['c1'], failed: [] } } });
    await postBulkOperation({ type: 'DELETE', customerIds: ['c1'], reason: 'Khách trùng' });
    expect(request).toHaveBeenCalledWith(expect.objectContaining({ method: 'post', url: '/crm/customer-bulk-operations', data: { type: 'DELETE', customerIds: ['c1'], payload: { reason: 'Khách trùng' } } }));
  });

  it('xóa đơn gửi lý do qua query ?reason=; xóa vĩnh viễn trả { data } đã bóc; khôi phục gửi customerId', async () => {
    request.mockResolvedValueOnce({ data: undefined });
    await deleteCustomerById('c 1', 'Nhập nhầm');
    expect(request).toHaveBeenLastCalledWith(expect.objectContaining({ method: 'delete', url: '/crm/customers/c%201', params: { reason: 'Nhập nhầm' } }));

    request.mockResolvedValueOnce({ data: { data: { customerId: 'c1', purged: { careLogs: 2 } } } });
    expect((await deletePurgeCustomer('c1')).purged.careLogs).toBe(2);
    expect(request).toHaveBeenLastCalledWith(expect.objectContaining({ method: 'delete', url: '/crm/deleted-customers/c1' }));

    request.mockResolvedValueOnce({ data: { data: { id: 'c1' } } });
    await postCustomerRestoration('c1');
    expect(request).toHaveBeenLastCalledWith(expect.objectContaining({ method: 'post', url: '/crm/customer-restorations', data: { customerId: 'c1' } }));
  });

  it('danh sách khách đã xóa: truyền trang + từ khóa, map thông tin xóa', async () => {
    request.mockResolvedValue({
      data: {
        data: [{ id: 'c1', fullName: 'An', phoneMasked: '0912 •••', status: { id: 's', code: 'DROPPED', label: 'Bỏ', listGroup: 'DROPPED', color: 'error' }, source: null, projects: [], area: null, tags: [], progress: 0, criteriaDone: {}, primaryAssignee: null, careTeamSize: 1, nextAppointmentAt: null, lastCareLogAt: null, lastUpdatedAt: 't', personaCompleteness: 0, deletedAt: 'd', deletedBy: { id: 'a', displayName: 'Admin' }, anonymizedAt: null, deleteReason: 'Trùng' }],
        meta: { total: 1, page: 2, limit: 10, totalPages: 2 },
      },
    });
    const result = await fetchDeletedCustomers({ page: 2, limit: 10, q: 'an' });
    expect(request).toHaveBeenCalledWith(expect.objectContaining({ url: '/crm/deleted-customers', params: { page: 2, limit: 10, q: 'an' } }));
    expect(result.data[0]).toMatchObject({ deleteReason: 'Trùng', deletedBy: { displayName: 'Admin' } });
  });
});
