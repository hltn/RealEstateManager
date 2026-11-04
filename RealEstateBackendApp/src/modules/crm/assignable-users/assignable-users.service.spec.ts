import { Types } from 'mongoose';
import { UserRole } from '../../../common/enums/user-role.enum';
import type { CrmActor } from '../common/access/crm-actor';
import { buildCustomerScope } from '../customers/access/customer-scope';
import { AssignableUsersService } from './assignable-users.service';
import { AssignableUsersPurpose } from './dtos/assignable-users.dto';

const oid = () => new Types.ObjectId();

type FakeQuery = Record<string, jest.Mock>;

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

describe('AssignableUsersService — purpose=filter (tài liệu 09 mục 6.10)', () => {
  const jwt = {
    sub: String(oid()),
    email: 'm@test.vn',
    role: UserRole.MANAGER,
  };
  const caredUserId = oid();

  let userModel: { find: jest.Mock; countDocuments: jest.Mock };
  let teamModel: { find: jest.Mock };
  let customerModel: { distinct: jest.Mock };
  let actors: { resolve: jest.Mock };
  let service: AssignableUsersService;

  beforeEach(() => {
    userModel = {
      find: jest.fn(() =>
        chain([
          {
            _id: caredUserId,
            displayName: 'Người ngoài nhóm',
            role: UserRole.ADMIN,
            roles: [UserRole.ADMIN],
            teamIds: [],
          },
        ]),
      ),
      countDocuments: jest.fn(() => chain(1)),
    };
    teamModel = { find: jest.fn(() => chain([])) };
    customerModel = { distinct: jest.fn(() => chain([caredUserId])) };
    actors = { resolve: jest.fn() };
    service = new AssignableUsersService(
      userModel as never,
      teamModel as never,
      customerModel as never,
      actors as never,
    );
  });

  it('MANAGER + filter: lấy người trong careTeam của khách trong phạm vi Quản lý (chưa xóa), không ràng buộc role/status', async () => {
    const actor = makeActor({ managedTeamIds: [oid()] });
    actors.resolve.mockResolvedValue(actor);

    const result = await service.list(jwt, {
      purpose: AssignableUsersPurpose.FILTER,
      page: 1,
      limit: 50,
    });

    expect(customerModel.distinct).toHaveBeenCalledWith('careTeam.userId', {
      $and: [buildCustomerScope(actor), { deletedAt: null }],
    });
    expect(userModel.find).toHaveBeenCalledWith({
      _id: { $in: [caredUserId] },
      deletedAt: null,
    });
    // Người đã đổi sang role ADMIN vẫn lọc được; role trả về là role cao nhất của họ.
    expect(result.data).toEqual([
      expect.objectContaining({
        id: String(caredUserId),
        role: UserRole.ADMIN,
        team: null,
      }),
    ]);
    expect(result.meta).toEqual({
      total: 1,
      page: 1,
      limit: 50,
      totalPages: 1,
    });
    const query = userModel.find.mock.results[0].value as FakeQuery;
    expect(query.select.mock.calls[0][0]).not.toContain('email');
  });

  it('MANAGER + filter: q và teamId thu hẹp thêm trong tập đó', async () => {
    actors.resolve.mockResolvedValue(makeActor({}));
    const teamId = oid();

    await service.list(jwt, {
      purpose: AssignableUsersPurpose.FILTER,
      q: 'an',
      teamId: String(teamId),
    });

    expect(userModel.find).toHaveBeenCalledWith({
      _id: { $in: [caredUserId] },
      deletedAt: null,
      teamIds: teamId,
      displayName: expect.any(RegExp),
    });
  });

  it('MANAGER không có purpose (ô gán): vẫn chặt theo nhóm quản lý, KHÔNG đi qua tập khách', async () => {
    const managed = oid();
    actors.resolve.mockResolvedValue(makeActor({ managedTeamIds: [managed] }));

    await service.list(jwt, {});

    expect(customerModel.distinct).not.toHaveBeenCalled();
    expect(userModel.find).toHaveBeenCalledWith(
      expect.objectContaining({ teamIds: { $in: [managed] } }),
    );
  });

  it.each([
    [UserRole.ADMIN, [UserRole.ADMIN]],
    [UserRole.STAFF, [UserRole.STAFF]],
  ])(
    '%s + filter giữ hành vi gán hiện tại (không đi qua tập khách)',
    async (role, roles) => {
      actors.resolve.mockResolvedValue(
        makeActor({ role, roles, teamIds: [oid()] }),
      );

      await service.list(jwt, { purpose: AssignableUsersPurpose.FILTER });

      expect(customerModel.distinct).not.toHaveBeenCalled();
      expect(userModel.find).toHaveBeenCalledWith(
        expect.objectContaining({
          roles: { $in: [UserRole.MANAGER, UserRole.STAFF] },
        }),
      );
    },
  );
});
