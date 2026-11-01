import { beforeEach, describe, expect, it, vi } from 'vitest';

const list = vi.fn();
vi.mock('./crmHttp', () => ({ crmHttp: { list: (...args: unknown[]) => list(...args), get: vi.fn(), raw: vi.fn() } }));

import { fetchAssignableUsers, fetchAssigneeFilterUsers } from './catalogApi';

const page = (data: unknown[]) => ({ data, meta: { total: data.length, page: 1, limit: 100, totalPages: 1 } });

beforeEach(() => list.mockReset());

describe('nguồn người phụ trách: gán ≠ lọc', () => {
  it('ô GÁN gọi assignable-users không có purpose; ô LỌC gọi với purpose=filter (query riêng)', async () => {
    list.mockResolvedValue(page([]));
    await fetchAssignableUsers();
    await fetchAssigneeFilterUsers();
    expect(list.mock.calls[0][0]).toBe('/crm/assignable-users');
    expect(list.mock.calls[0][1].params).not.toHaveProperty('purpose');
    expect(list.mock.calls[1][0]).toBe('/crm/assignable-users');
    expect(list.mock.calls[1][1].params).toMatchObject({ purpose: 'filter' });
  });

  it('nguồn lọc chấp nhận role ADMIN/EDITOR: ADMIN giữ nguyên, EDITOR coi như STAFF; nhóm chính lấy từ team', async () => {
    list.mockResolvedValue(
      page([
        { id: 'u1', displayName: 'Quản trị', role: 'ADMIN', roles: ['ADMIN'], team: null, teamIds: [], teams: [] },
        { id: 'u2', displayName: 'Biên tập', role: 'EDITOR', roles: ['EDITOR'], team: { id: 't1', label: 'Nhóm 1' }, teamIds: ['t1'], teams: [{ id: 't1', label: 'Nhóm 1' }] },
      ]),
    );
    const users = await fetchAssigneeFilterUsers();
    expect(users).toMatchObject([
      { id: 'u1', role: 'ADMIN', teamId: null },
      { id: 'u2', role: 'STAFF', teamId: 't1', teamName: 'Nhóm 1' },
    ]);
  });
});
