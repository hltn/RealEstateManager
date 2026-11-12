import { beforeEach, describe, expect, it, vi } from 'vitest';

const list = vi.fn();
vi.mock('./crmHttp', () => ({ crmHttp: { list: (...args: unknown[]) => list(...args), get: vi.fn(), raw: vi.fn() } }));

import * as catalogApi from './catalogApi';
import { fetchAssigneeFilterUsers } from './catalogApi';

const page = (data: unknown[]) => ({ data, meta: { total: data.length, page: 1, limit: 100, totalPages: 1 } });

beforeEach(() => list.mockReset());

describe('nguồn người phụ trách cho ô LỌC (v1.0.5)', () => {
  it('gọi GET /crm/customer-assignees, không còn assignable-users', async () => {
    list.mockResolvedValue(page([]));
    await fetchAssigneeFilterUsers();
    expect(list).toHaveBeenCalledTimes(1);
    expect(list.mock.calls[0][0]).toBe('/crm/customer-assignees');
    expect(list.mock.calls[0][1].params).not.toHaveProperty('purpose');
    expect(catalogApi).not.toHaveProperty('fetchAssignableUsers');
  });

  it('map role ADMIN/EDITOR/MANAGER, nhóm chính từ team và cờ isLocked (thiếu -> false)', async () => {
    list.mockResolvedValue(
      page([
        { id: 'u1', displayName: 'Quản trị', role: 'ADMIN', team: null, teams: [], isLocked: false },
        { id: 'u2', displayName: 'Biên tập', role: 'EDITOR', team: { id: 't1', label: 'Nhóm 1' }, teams: [{ id: 't1', label: 'Nhóm 1' }], isLocked: true },
        { id: 'u3', displayName: 'Quản lý', role: 'MANAGER', team: null, teams: [] },
      ]),
    );
    const users = await fetchAssigneeFilterUsers();
    expect(users).toMatchObject([
      { id: 'u1', displayName: 'Quản trị', role: 'ADMIN', teamId: null, isLocked: false },
      { id: 'u2', role: 'STAFF', teamId: 't1', teamName: 'Nhóm 1', isLocked: true },
      { id: 'u3', role: 'MANAGER', isLocked: false },
    ]);
  });

  it('nối đủ các trang (không cắt ở trang đầu)', async () => {
    list
      .mockResolvedValueOnce({ data: [{ id: 'u1', displayName: 'A', role: 'STAFF', team: null, teams: [], isLocked: false }], meta: { total: 2, page: 1, limit: 1, totalPages: 2 } })
      .mockResolvedValueOnce({ data: [{ id: 'u2', displayName: 'B', role: 'STAFF', team: null, teams: [], isLocked: false }], meta: { total: 2, page: 2, limit: 1, totalPages: 2 } });
    const users = await fetchAssigneeFilterUsers();
    expect(users.map((user) => user.id)).toEqual(['u1', 'u2']);
  });
});
