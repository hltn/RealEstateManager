import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { UserRole } from '../../common/enums/user-role.enum';
import { UserStatus } from '../../common/enums/user-status.enum';
import type { CrmActor } from '../crm/common/access/crm-actor';
import { TeamMembersService } from './team-members.service';

const oid = () => new Types.ObjectId();

type FakeQuery = Record<string, jest.Mock>;

/** Chuỗi truy vấn Mongoose giả: mọi bước trả chính nó, `exec` trả giá trị cho trước. */
const chain = <T>(result: T): FakeQuery => {
  const query: FakeQuery = {};
  for (const step of ['select', 'collation', 'sort', 'skip', 'limit', 'lean']) {
    query[step] = jest.fn(() => query);
  }
  query.exec = jest.fn(() => Promise.resolve(result));
  return query;
};

const makeActor = (overrides: Partial<CrmActor>): CrmActor => ({
  userId: oid(),
  role: UserRole.MANAGER,
  roles: [UserRole.MANAGER],
  displayName: 'Quản lý',
  teamId: null,
  teamIds: [],
  managedTeamIds: [],
  ...overrides,
});

const adminActor = () =>
  makeActor({ role: UserRole.ADMIN, roles: [UserRole.ADMIN] });

describe('TeamMembersService', () => {
  const teamId = oid();
  const memberId = oid();
  const jwt = { sub: String(oid()), email: 'a@test.vn', role: UserRole.ADMIN };

  let teamModel: { findOne: jest.Mock };
  let userModel: { find: jest.Mock; countDocuments: jest.Mock };
  let actors: { resolve: jest.Mock };
  let teamsService: { addUserToTeam: jest.Mock; removeUserFromTeam: jest.Mock };
  let service: TeamMembersService;

  beforeEach(() => {
    teamModel = {
      findOne: jest.fn(() => chain({ _id: teamId, managerIds: [memberId] })),
    };
    userModel = {
      find: jest.fn(() =>
        chain([
          {
            _id: memberId,
            displayName: 'An',
            role: UserRole.MANAGER,
            roles: [UserRole.STAFF, UserRole.MANAGER],
            status: UserStatus.ACTIVE,
          },
          {
            _id: oid(),
            displayName: 'Bình',
            role: UserRole.STAFF,
            status: UserStatus.BLOCKED,
          },
        ]),
      ),
      countDocuments: jest.fn(() => chain(2)),
    };
    actors = { resolve: jest.fn() };
    teamsService = {
      addUserToTeam: jest.fn(),
      removeUserFromTeam: jest.fn(),
    };
    service = new TeamMembersService(
      teamModel as never,
      userModel as never,
      actors as never,
      teamsService as never,
    );
  });

  describe('list', () => {
    it('ADMIN xem được mọi nhóm: lọc theo teamIds + chưa xóa, gắn cờ isManager, role cao nhất, không lộ email', async () => {
      actors.resolve.mockResolvedValue(adminActor());

      const result = await service.list(jwt, String(teamId), {
        page: 1,
        limit: 20,
      });

      expect(userModel.find).toHaveBeenCalledWith({
        teamIds: teamId,
        deletedAt: null,
      });
      expect(result.data).toEqual([
        {
          id: String(memberId),
          displayName: 'An',
          role: UserRole.MANAGER,
          roles: [UserRole.STAFF, UserRole.MANAGER],
          status: UserStatus.ACTIVE,
          isManager: true,
        },
        expect.objectContaining({
          displayName: 'Bình',
          roles: [UserRole.STAFF],
          status: UserStatus.BLOCKED,
          isManager: false,
        }),
      ]);
      expect(result.meta).toEqual({
        total: 2,
        page: 1,
        limit: 20,
        totalPages: 1,
      });
      const query = userModel.find.mock.results[0].value as FakeQuery;
      expect(query.select.mock.calls[0][0]).not.toContain('email');
    });

    it('MANAGER của chính nhóm này xem được; tìm theo tên dùng regex đã escape', async () => {
      actors.resolve.mockResolvedValue(makeActor({ managedTeamIds: [teamId] }));

      await service.list(jwt, String(teamId), { q: 'a.b' });

      const filter = userModel.find.mock.calls[0][0] as {
        displayName: RegExp;
      };
      expect(filter.displayName.test('xa.bx')).toBe(true);
      expect(filter.displayName.test('xaZbx')).toBe(false);
    });

    it('MANAGER không quản lý nhóm (kể cả chỉ là thành viên) bị 403 và không truy vấn thành viên', async () => {
      actors.resolve.mockResolvedValue(
        makeActor({ managedTeamIds: [oid()], teamIds: [teamId] }),
      );

      await expect(
        service.list(jwt, String(teamId), {}),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(userModel.find).not.toHaveBeenCalled();
    });

    it('nhóm không tồn tại hoặc đã xóa mềm: 404', async () => {
      actors.resolve.mockResolvedValue(adminActor());
      teamModel.findOne.mockReturnValue(chain(null));

      await expect(
        service.list(jwt, String(teamId), {}),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('add', () => {
    it('gọi addUserToTeam rồi trả thành viên (isManager theo managerIds của nhóm)', async () => {
      teamsService.addUserToTeam.mockResolvedValue({
        _id: String(memberId),
        email: 'x@test.vn',
        displayName: 'An',
        role: UserRole.STAFF,
        roles: [UserRole.STAFF],
        status: UserStatus.ACTIVE,
        teamId: String(teamId),
        teamIds: [String(teamId)],
      });

      const member = await service.add(jwt, String(teamId), String(memberId));

      expect(teamsService.addUserToTeam).toHaveBeenCalledWith(
        jwt,
        String(memberId),
        String(teamId),
      );
      expect(member).toEqual({
        id: String(memberId),
        displayName: 'An',
        role: UserRole.STAFF,
        roles: [UserRole.STAFF],
        status: UserStatus.ACTIVE,
        isManager: true,
      });
    });

    it('nhóm không tồn tại: 404 và không ghi gì', async () => {
      teamModel.findOne.mockReturnValue(chain(null));

      await expect(
        service.add(jwt, String(teamId), String(memberId)),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(teamsService.addUserToTeam).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('gọi removeUserFromTeam', async () => {
      await service.remove(jwt, String(teamId), String(memberId));

      expect(teamsService.removeUserFromTeam).toHaveBeenCalledWith(
        jwt,
        String(memberId),
        String(teamId),
      );
    });

    it('nhóm không tồn tại: 404 và không ghi gì', async () => {
      teamModel.findOne.mockReturnValue(chain(null));

      await expect(
        service.remove(jwt, String(teamId), String(memberId)),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(teamsService.removeUserFromTeam).not.toHaveBeenCalled();
    });
  });
});
