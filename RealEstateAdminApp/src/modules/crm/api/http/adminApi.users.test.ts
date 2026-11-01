import { beforeEach, describe, expect, it, vi } from 'vitest';

const raw = vi.fn();
vi.mock('./crmHttp', () => ({ crmHttp: { raw: (...args: unknown[]) => raw(...args), get: vi.fn(), list: vi.fn(), post: vi.fn(), patch: vi.fn(), del: vi.fn() } }));

import { patchUserRoles, patchUserTeams, postUser } from './adminApi';
import { userDtoToUser } from './catalogMappers';
import type { UserDto } from './dto';

const dto = (patch: Partial<UserDto> = {}): UserDto => ({ _id: 'u1', email: 'a@b.vn', displayName: 'An', role: 'MANAGER', status: 'ACTIVE', teamId: 't1', roles: ['MANAGER', 'STAFF'], teamIds: ['t1', 't2'], ...patch });

beforeEach(() => raw.mockReset());

describe('hợp đồng /users nhiều role, nhiều nhóm', () => {
  it('userDtoToUser giữ mọi role/nhóm; EDITOR vẫn nằm trong roles nhưng role đại diện đổi thành STAFF', () => {
    expect(userDtoToUser(dto())).toMatchObject({ id: 'u1', role: 'MANAGER', roles: ['MANAGER', 'STAFF'], teamId: 't1', teamIds: ['t1', 't2'], isActive: true });
    expect(userDtoToUser(dto({ role: 'EDITOR', roles: ['EDITOR'], teamId: null, teamIds: [] }))).toMatchObject({ role: 'STAFF', roles: ['EDITOR'], teamIds: [] });
  });

  it('bản ghi cũ thiếu roles/teamIds -> suy từ role/teamId', () => {
    expect(userDtoToUser(dto({ roles: undefined, teamIds: undefined }))).toMatchObject({ roles: ['MANAGER'], teamIds: ['t1'] });
    expect(userDtoToUser(dto({ roles: undefined, teamIds: undefined, teamId: null }))).toMatchObject({ teamIds: [] });
  });

  it('POST /users gửi nguyên roles[] + teamIds[] (không thêm role/teamId đơn)', async () => {
    raw.mockResolvedValue(dto());
    await postUser({ email: 'a@b.vn', password: 'Matkhau123', displayName: 'An', roles: ['MANAGER', 'STAFF'], teamIds: ['t1', 't2'] });
    expect(raw).toHaveBeenCalledWith('post', '/users', { email: 'a@b.vn', password: 'Matkhau123', displayName: 'An', roles: ['MANAGER', 'STAFF'], teamIds: ['t1', 't2'] });
  });

  it('PATCH /users/:id/roles nhận user trần; PATCH /users/:id/teams nhận user bọc trong { data }', async () => {
    raw.mockResolvedValueOnce(dto({ roles: ['ADMIN'], role: 'ADMIN', teamIds: [], teamId: null }));
    expect(await patchUserRoles('u1', ['ADMIN'])).toMatchObject({ roles: ['ADMIN'], teamIds: [] });
    expect(raw).toHaveBeenLastCalledWith('patch', '/users/u1/roles', { roles: ['ADMIN'] });

    raw.mockResolvedValueOnce({ data: dto({ teamIds: ['t2'], teamId: 't2' }) });
    expect(await patchUserTeams('u1', ['t2'])).toMatchObject({ teamId: 't2', teamIds: ['t2'] });
    expect(raw).toHaveBeenLastCalledWith('patch', '/users/u1/teams', { teamIds: ['t2'] });
  });
});
