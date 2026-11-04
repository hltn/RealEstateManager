import { UnauthorizedException } from '@nestjs/common';
import { Types } from 'mongoose';
import { UserRole } from '../../../../common/enums/user-role.enum';
import { UserStatus } from '../../../../common/enums/user-status.enum';
import { CrmActorService } from './crm-actor.service';

const chain = (value: unknown) => {
  const query: Record<string, jest.Mock> = {};
  for (const method of ['select', 'lean']) {
    query[method] = jest.fn(() => query);
  }
  query.exec = jest.fn().mockResolvedValue(value);
  return query;
};

describe('CrmActorService.resolve — role cao nhất, hợp nhóm, bản ghi chưa migrate', () => {
  const userId = new Types.ObjectId();
  const teamA = new Types.ObjectId();
  const teamB = new Types.ObjectId();
  const managed = new Types.ObjectId();
  let userFind: jest.Mock;
  let teamFind: jest.Mock;
  let service: CrmActorService;

  const givenUser = (doc: Record<string, unknown> | null) => {
    userFind.mockReturnValue(
      chain(
        doc && {
          _id: userId,
          displayName: 'U',
          status: UserStatus.ACTIVE,
          ...doc,
        },
      ),
    );
  };

  beforeEach(() => {
    userFind = jest.fn();
    teamFind = jest.fn().mockReturnValue(chain([{ _id: managed }]));
    service = new CrmActorService(
      { findOne: userFind } as never,
      { find: teamFind } as never,
    );
  });

  it('MANAGER+STAFF nhiều nhóm: role = MANAGER, teamId = nhóm đầu, tra nhóm quản lý', async () => {
    givenUser({
      role: UserRole.STAFF, // trường suy ra lệch cũng không được tin hơn roles[]
      roles: [UserRole.STAFF, UserRole.MANAGER],
      teamId: teamB,
      teamIds: [teamA, teamB],
    });

    const actor = await service.resolve({ sub: String(userId) });

    expect(actor).toMatchObject({
      role: UserRole.MANAGER,
      roles: [UserRole.STAFF, UserRole.MANAGER],
      managedTeamIds: [managed],
    });
    expect(actor.teamIds.map(String)).toEqual([String(teamA), String(teamB)]);
    expect(String(actor.teamId)).toBe(String(teamA));
    expect(teamFind).toHaveBeenCalledTimes(1);
  });

  it('ADMIN+STAFF → role ADMIN; không có MANAGER thì KHÔNG tra nhóm quản lý', async () => {
    givenUser({
      role: UserRole.ADMIN,
      roles: [UserRole.ADMIN, UserRole.STAFF],
    });

    const actor = await service.resolve({ sub: String(userId) });

    expect(actor.role).toBe(UserRole.ADMIN);
    expect(actor.managedTeamIds).toEqual([]);
    expect(teamFind).not.toHaveBeenCalled();
  });

  it('STAFF+EDITOR → role STAFF (phân vùng CRM), vẫn giữ cả hai role trong roles', async () => {
    givenUser({
      role: UserRole.EDITOR,
      roles: [UserRole.EDITOR, UserRole.STAFF],
    });

    const actor = await service.resolve({ sub: String(userId) });

    expect(actor.role).toBe(UserRole.STAFF);
    expect(actor.roles).toEqual([UserRole.EDITOR, UserRole.STAFF]);
  });

  it('bản ghi chưa migrate (chỉ role/teamId đơn) được coi là roles=[role], teamIds=[teamId]', async () => {
    givenUser({ role: UserRole.MANAGER, teamId: teamA });

    const actor = await service.resolve({ sub: String(userId) });

    expect(actor.roles).toEqual([UserRole.MANAGER]);
    expect(actor.teamIds.map(String)).toEqual([String(teamA)]);
    expect(actor.managedTeamIds).toEqual([managed]);
  });

  it('tài khoản không tồn tại/bị khóa → 401', async () => {
    givenUser(null);
    await expect(service.resolve({ sub: String(userId) })).rejects.toThrow(
      UnauthorizedException,
    );
    givenUser({ role: UserRole.STAFF, status: UserStatus.BLOCKED });
    await expect(service.resolve({ sub: String(userId) })).rejects.toThrow(
      UnauthorizedException,
    );
  });
});
