import { beforeEach, describe, expect, it, vi } from 'vitest';

const list = vi.fn();
const post = vi.fn();
const del = vi.fn();
vi.mock('./crmHttp', () => ({ crmHttp: { list: (...a: unknown[]) => list(...a), post: (...a: unknown[]) => post(...a), del: (...a: unknown[]) => del(...a), raw: vi.fn(), get: vi.fn(), patch: vi.fn() } }));

import { deleteTeamMember, fetchTeamMembers, postTeamMember } from './adminApi';

beforeEach(() => {
  list.mockReset();
  post.mockReset();
  del.mockReset();
});

describe('hợp đồng /teams/:id/members', () => {
  it('GET gửi page/limit/q (bỏ q rỗng), map status -> isActive, giữ isManager và meta', async () => {
    list.mockResolvedValue({ data: [{ id: 'm1', displayName: 'An', role: 'MANAGER', roles: ['MANAGER', 'STAFF'], status: 'BLOCKED', isManager: true }], meta: { total: 1, page: 2, limit: 10, totalPages: 2 } });
    const result = await fetchTeamMembers('t1', { page: 2, limit: 10, q: '  ' });
    expect(list).toHaveBeenCalledWith('/teams/t1/members', expect.objectContaining({ params: { page: 2, limit: 10, q: undefined } }));
    expect(result.meta.totalPages).toBe(2);
    expect(result.data[0]).toEqual({ id: 'm1', displayName: 'An', role: 'MANAGER', roles: ['MANAGER', 'STAFF'], isActive: false, isManager: true });
  });

  it('POST gửi { userId } và trả thành viên; DELETE gọi đúng đường dẫn', async () => {
    post.mockResolvedValue({ id: 'u1', displayName: 'Bình', role: 'STAFF', roles: ['STAFF'], status: 'ACTIVE', isManager: false });
    expect(await postTeamMember('t1', 'u1')).toMatchObject({ id: 'u1', isManager: false, isActive: true });
    expect(post).toHaveBeenCalledWith('/teams/t1/members', { userId: 'u1' });
    del.mockResolvedValue(undefined);
    await deleteTeamMember('t1', 'u1');
    expect(del).toHaveBeenCalledWith('/teams/t1/members/u1');
  });
});
