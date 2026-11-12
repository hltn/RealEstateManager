import 'reflect-metadata';
import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Types } from 'mongoose';
import { ROLES_KEY } from '../../../common/decorators/roles.decorator';
import { CRM_ROLES, UserRole } from '../../../common/enums/user-role.enum';
import { UserStatus } from '../../../common/enums/user-status.enum';
import type { CrmActor } from '../common/access/crm-actor';
import { buildCustomerScope } from './access/customer-scope';
import { CustomerAssigneesController } from './customer-assignees.controller';
import { CustomerAssigneesService } from './customer-assignees.service';
import {
  ASSIGNEE_SEARCH_MAX_LENGTH,
  ListCustomerAssigneesQueryDto,
} from './dtos/customer-assignees.dto';

/**
 * T-16 (FR-09, FR-18): `GET /crm/customer-assignees`. Mô hình Mongoose/actor giả; kiểm phạm vi khách theo từng vai trò,
 * filter gửi xuống DB (xóa mềm, q, teamId), phản hồi (isLocked, role, nhóm, không lộ trường nhạy cảm), phân trang,
 * đúng MỘT truy vấn `teams`, và metadata controller (quyền, route, không rate-limit riêng).
 */
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

const makeActor = (overrides: Partial<CrmActor> = {}): CrmActor => ({
  userId: oid(),
  role: UserRole.MANAGER,
  roles: [UserRole.MANAGER],
  displayName: 'Người gọi',
  teamId: null,
  teamIds: [],
  managedTeamIds: [],
  ...overrides,
});

interface BuildOptions {
  actor?: CrmActor;
  userIds?: Types.ObjectId[];
  users?: Array<Record<string, unknown>>;
  total?: number;
  teams?: Array<{ _id: Types.ObjectId; name: string }>;
}

const build = (options: BuildOptions = {}) => {
  const actor = options.actor ?? makeActor();
  const userModel = {
    find: jest.fn(() => chain(options.users ?? [])),
    countDocuments: jest.fn(() =>
      chain(options.total ?? (options.users ?? []).length),
    ),
  };
  const teamModel = { find: jest.fn(() => chain(options.teams ?? [])) };
  const customerModel = {
    distinct: jest.fn(() => chain(options.userIds ?? [])),
  };
  const actors = { resolve: jest.fn(() => Promise.resolve(actor)) };
  const service = new CustomerAssigneesService(
    userModel as never,
    teamModel as never,
    customerModel as never,
    actors as never,
  );
  const jwt = { sub: String(actor.userId) } as never;
  const userFilter = () =>
    (userModel.find.mock.calls as unknown[][])[0][0] as Record<string, unknown>;
  return {
    service,
    actor,
    jwt,
    userModel,
    teamModel,
    customerModel,
    actors,
    userFilter,
  };
};

const query = (
  overrides: Partial<ListCustomerAssigneesQueryDto> = {},
): ListCustomerAssigneesQueryDto =>
  Object.assign(new ListCustomerAssigneesQueryDto(), overrides);

describe('CustomerAssigneesService: tập người theo phạm vi khách (FR-09)', () => {
  it.each([
    [
      UserRole.ADMIN,
      makeActor({ role: UserRole.ADMIN, roles: [UserRole.ADMIN] }),
    ],
    [
      UserRole.MANAGER,
      makeActor({
        role: UserRole.MANAGER,
        roles: [UserRole.MANAGER],
        managedTeamIds: [oid()],
        teamIds: [oid()],
      }),
    ],
    [
      UserRole.STAFF,
      makeActor({ role: UserRole.STAFF, roles: [UserRole.STAFF] }),
    ],
  ])(
    '%s: một distinct careTeam.userId theo buildCustomerScope + bỏ khách xóa mềm',
    async (_role, actor) => {
      const careUser = oid();
      const ctx = build({ actor, userIds: [careUser] });

      await ctx.service.list(ctx.jwt, query());

      expect(ctx.actors.resolve).toHaveBeenCalledWith(ctx.jwt);
      expect(ctx.customerModel.distinct).toHaveBeenCalledTimes(1);
      expect(ctx.customerModel.distinct).toHaveBeenCalledWith(
        'careTeam.userId',
        { $and: [buildCustomerScope(actor), { deletedAt: null }] },
      );
      expect(ctx.userFilter()._id).toEqual({ $in: [careUser] });
    },
  );

  it('phạm vi khác nhau theo vai trò: Admin = tất cả, Manager = nhóm quản lý hoặc có mình, Staff = chỉ có mình', async () => {
    const managed = oid();
    const scopeOf = async (actor: CrmActor) => {
      const ctx = build({ actor });
      await ctx.service.list(ctx.jwt, query());
      const call = (ctx.customerModel.distinct.mock.calls as unknown[][])[0];
      return (call[1] as { $and: unknown[] }).$and[0];
    };

    expect(
      await scopeOf(
        makeActor({ role: UserRole.ADMIN, roles: [UserRole.ADMIN] }),
      ),
    ).toEqual({});
    const manager = makeActor({ managedTeamIds: [managed] });
    expect(await scopeOf(manager)).toEqual({
      $or: [
        { teamIds: { $in: [managed] } },
        { 'careTeam.userId': manager.userId },
      ],
    });
    const staff = makeActor({
      role: UserRole.STAFF,
      roles: [UserRole.STAFF],
    });
    expect(await scopeOf(staff)).toEqual({ 'careTeam.userId': staff.userId });
  });

  it('vai trò ngoài CRM (Editor): phạm vi khách rỗng (_id $in [])', async () => {
    const actor = makeActor({
      role: UserRole.EDITOR,
      roles: [UserRole.EDITOR],
    });
    const ctx = build({ actor, userIds: [] });
    const result = await ctx.service.list(ctx.jwt, query());

    const call = (ctx.customerModel.distinct.mock.calls as unknown[][])[0];
    expect((call[1] as { $and: unknown[] }).$and[0]).toEqual({
      _id: { $in: [] },
    });
    expect(result.data).toEqual([]);
    expect(ctx.userFilter()._id).toEqual({ $in: [] });
  });
});

describe('CustomerAssigneesService: loại trừ và lọc (FR-18)', () => {
  it('chỉ loại user đã xóa mềm; KHÔNG lọc status/role (gồm người BLOCKED hoặc đã đổi role)', async () => {
    const ctx = build({ userIds: [oid()] });
    await ctx.service.list(ctx.jwt, query());

    const filter = ctx.userFilter();
    expect(filter.deletedAt).toBeNull();
    expect(filter).not.toHaveProperty('status');
    expect(filter).not.toHaveProperty('roles');
    expect(filter).not.toHaveProperty('role');
    expect(filter).not.toHaveProperty('teamIds');
    expect(filter).not.toHaveProperty('displayName');
  });

  it('q lọc displayName không phân biệt hoa/thường và escape ký tự regex', async () => {
    const ctx = build();
    await ctx.service.list(ctx.jwt, query({ q: 'a.*(b' }));

    const regex = ctx.userFilter().displayName as RegExp;
    expect(regex.flags).toBe('i');
    expect(regex.test('xa.*(by')).toBe(true);
    expect(regex.test('aXXb')).toBe(false);
  });

  it('teamId thu hẹp theo nhóm của người (ObjectId)', async () => {
    const teamId = oid();
    const ctx = build();
    await ctx.service.list(ctx.jwt, query({ teamId: String(teamId) }));

    expect(ctx.userFilter().teamIds).toEqual(teamId);
  });

  it('sắp theo displayName rồi _id, collation vi, select không có email/SĐT', async () => {
    const ctx = build({ users: [] });
    await ctx.service.list(ctx.jwt, query());

    const find = (ctx.userModel.find.mock.results[0] as { value: FakeQuery })
      .value;
    expect(find.sort).toHaveBeenCalledWith({ displayName: 1, _id: 1 });
    expect(find.collation).toHaveBeenCalledWith({ locale: 'vi' });
    const selected = find.select.mock.calls[0][0] as string;
    expect(selected).toBe('displayName role roles status teamId teamIds');
    expect(selected).not.toMatch(/email|phone|nationalId|password/);
  });
});

describe('CustomerAssigneesService: response (FR-09, FR-18)', () => {
  it('trả id, displayName, role, team, teams, isLocked; không có trường nhạy cảm; BLOCKED ⇒ isLocked true', async () => {
    const active = oid();
    const blocked = oid();
    const teamA = oid();
    const teamB = oid();
    const ctx = build({
      users: [
        {
          _id: active,
          displayName: 'An',
          email: 'an@x.vn',
          phone: '0900',
          password: 'hash',
          role: UserRole.STAFF,
          roles: [UserRole.STAFF],
          status: UserStatus.ACTIVE,
          teamId: teamA,
          teamIds: [teamA, teamB],
        },
        {
          _id: blocked,
          displayName: 'Bình',
          role: UserRole.STAFF,
          roles: [UserRole.STAFF],
          status: UserStatus.BLOCKED,
          teamIds: [],
        },
      ],
      teams: [
        { _id: teamA, name: 'Nhóm A' },
        { _id: teamB, name: 'Nhóm B' },
      ],
    });
    const result = await ctx.service.list(ctx.jwt, query());

    expect(result.data).toEqual([
      {
        id: String(active),
        displayName: 'An',
        role: UserRole.STAFF,
        team: { id: String(teamA), label: 'Nhóm A' },
        teams: [
          { id: String(teamA), label: 'Nhóm A' },
          { id: String(teamB), label: 'Nhóm B' },
        ],
        isLocked: false,
      },
      {
        id: String(blocked),
        displayName: 'Bình',
        role: UserRole.STAFF,
        team: null,
        teams: [],
        isLocked: true,
      },
    ]);
    const json = JSON.stringify(result);
    expect(json).not.toMatch(/an@x\.vn|0900|hash|password|email/);
  });

  it('role là role cao nhất trong các role phân chăm sóc: ADMIN+STAFF ⇒ STAFF, MANAGER+STAFF ⇒ MANAGER', async () => {
    const ctx = build({
      users: [
        {
          _id: oid(),
          displayName: 'AS',
          roles: [UserRole.ADMIN, UserRole.STAFF],
          status: UserStatus.ACTIVE,
        },
        {
          _id: oid(),
          displayName: 'MS',
          roles: [UserRole.STAFF, UserRole.MANAGER],
          status: UserStatus.ACTIVE,
        },
      ],
    });
    const result = await ctx.service.list(ctx.jwt, query());
    expect(result.data.map((item) => item.role)).toEqual([
      UserRole.STAFF,
      UserRole.MANAGER,
    ]);
  });

  it('người đã đổi sang role khác (Admin/Editor) vẫn có mặt, role = role cao nhất của họ', async () => {
    const ctx = build({
      users: [
        {
          _id: oid(),
          displayName: 'Cũ',
          roles: [UserRole.ADMIN],
          status: UserStatus.ACTIVE,
        },
        {
          _id: oid(),
          displayName: 'Biên tập',
          roles: [UserRole.EDITOR],
          status: UserStatus.ACTIVE,
        },
      ],
    });
    const result = await ctx.service.list(ctx.jwt, query());
    expect(result.data.map((item) => item.role)).toEqual([
      UserRole.ADMIN,
      UserRole.EDITOR,
    ]);
  });

  it('user cũ chỉ có teamId (chưa có teamIds) vẫn ra nhóm; nhóm đã mất/xóa mềm ⇒ nhãn rỗng', async () => {
    const legacy = oid();
    const gone = oid();
    const ctx = build({
      users: [
        {
          _id: oid(),
          displayName: 'Cũ',
          role: UserRole.STAFF,
          roles: [UserRole.STAFF],
          status: UserStatus.ACTIVE,
          teamId: legacy,
        },
        {
          _id: oid(),
          displayName: 'Mất nhóm',
          role: UserRole.STAFF,
          roles: [UserRole.STAFF],
          status: UserStatus.ACTIVE,
          teamIds: [gone],
        },
      ],
      teams: [{ _id: legacy, name: 'Nhóm cũ' }],
    });
    const result = await ctx.service.list(ctx.jwt, query());

    expect(result.data[0].team).toEqual({
      id: String(legacy),
      label: 'Nhóm cũ',
    });
    expect(result.data[1].teams).toEqual([{ id: String(gone), label: '' }]);
  });

  it('cả trang chỉ tốn MỘT truy vấn teams (không N+1), id trùng được gộp, nhóm xóa mềm bị loại bằng deletedAt: null', async () => {
    const shared = oid();
    const other = oid();
    const ctx = build({
      users: [
        {
          _id: oid(),
          displayName: 'A',
          roles: [UserRole.STAFF],
          teamIds: [shared],
        },
        {
          _id: oid(),
          displayName: 'B',
          roles: [UserRole.STAFF],
          teamIds: [shared, other],
        },
      ],
      teams: [
        { _id: shared, name: 'Chung' },
        { _id: other, name: 'Khác' },
      ],
    });
    await ctx.service.list(ctx.jwt, query());

    expect(ctx.teamModel.find).toHaveBeenCalledTimes(1);
    const teamFilter = (ctx.teamModel.find.mock.calls as unknown[][])[0][0] as {
      _id: { $in: Types.ObjectId[] };
      deletedAt: null;
    };
    expect(teamFilter._id.$in.map(String).sort()).toEqual(
      [String(shared), String(other)].sort(),
    );
    expect(teamFilter.deletedAt).toBeNull();
  });

  it('không có người nào thì không truy vấn teams', async () => {
    const ctx = build({ users: [] });
    const result = await ctx.service.list(ctx.jwt, query());
    expect(result.data).toEqual([]);
    expect(ctx.teamModel.find).not.toHaveBeenCalled();
  });
});

describe('CustomerAssigneesService: phân trang', () => {
  it('skip/limit theo page/limit, meta theo buildPaginationMeta (total, page, limit, totalPages)', async () => {
    const ctx = build({ users: [], total: 205 });
    const result = await ctx.service.list(
      ctx.jwt,
      query({ page: 3, limit: 100 }),
    );

    const find = (ctx.userModel.find.mock.results[0] as { value: FakeQuery })
      .value;
    expect(find.skip).toHaveBeenCalledWith(200);
    expect(find.limit).toHaveBeenCalledWith(100);
    expect(result.meta).toEqual({
      total: 205,
      page: 3,
      limit: 100,
      totalPages: 3,
    });
  });

  it('countDocuments dùng cùng filter với find', async () => {
    const ctx = build({ users: [] });
    await ctx.service.list(ctx.jwt, query({ q: 'an' }));
    expect(ctx.userModel.countDocuments).toHaveBeenCalledWith(ctx.userFilter());
  });

  it('mặc định page 1, limit 20', async () => {
    const ctx = build({ users: [], total: 0 });
    const result = await ctx.service.list(ctx.jwt, query());
    expect(result.meta).toMatchObject({ page: 1, limit: 20 });
  });
});

describe('ListCustomerAssigneesQueryDto', () => {
  const check = async (plain: Record<string, unknown>) =>
    validate(plainToInstance(ListCustomerAssigneesQueryDto, plain));

  it('hợp lệ: rỗng, q, teamId, limit 100', async () => {
    expect(await check({})).toHaveLength(0);
    expect(
      await check({ q: 'an', teamId: String(oid()), limit: '100', page: '2' }),
    ).toHaveLength(0);
  });

  it('limit > 100, limit < 1, q quá dài, teamId sai định dạng bị từ chối', async () => {
    const properties = async (plain: Record<string, unknown>) =>
      (await check(plain)).map((error) => error.property);
    expect(await properties({ limit: '101' })).toEqual(['limit']);
    expect(await properties({ limit: '0' })).toEqual(['limit']);
    expect(
      await properties({ q: 'a'.repeat(ASSIGNEE_SEARCH_MAX_LENGTH + 1) }),
    ).toEqual(['q']);
    expect(await properties({ teamId: 'abc' })).toEqual(['teamId']);
  });

  it('q 50 ký tự vẫn hợp lệ; khoảng trắng hai đầu được cắt', async () => {
    expect(
      await check({ q: 'a'.repeat(ASSIGNEE_SEARCH_MAX_LENGTH) }),
    ).toHaveLength(0);
    const dto = plainToInstance(ListCustomerAssigneesQueryDto, { q: '  an  ' });
    expect(dto.q).toBe('an');
  });
});

describe('CustomerAssigneesController: metadata', () => {
  const handler = Object.getOwnPropertyDescriptor(
    CustomerAssigneesController.prototype,
    'list',
  )?.value as object;

  it('route GET /crm/customer-assignees', () => {
    expect(
      Reflect.getMetadata(PATH_METADATA, CustomerAssigneesController),
    ).toBe('crm/customer-assignees');
    expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(
      RequestMethod.GET,
    );
  });

  it('mọi vai trò CRM (Admin/Manager/Staff) được gọi; Editor thì không', () => {
    const roles = Reflect.getMetadata(ROLES_KEY, handler) as UserRole[];
    expect([...roles].sort()).toEqual([...CRM_ROLES].sort());
    expect(roles).not.toContain(UserRole.EDITOR);
  });

  it('chuyển query xuống service', async () => {
    const list = jest.fn(() => Promise.resolve({ data: [], meta: {} }));
    const controller = new CustomerAssigneesController({ list } as never);
    const user = { sub: 'u1' } as never;
    const dto = query({ q: 'an' });
    await controller.list(user, dto);
    expect(list).toHaveBeenCalledWith(user, dto);
  });
});
