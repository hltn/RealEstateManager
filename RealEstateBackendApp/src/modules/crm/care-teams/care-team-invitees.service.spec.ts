import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Types } from 'mongoose';
import { CRM_TEAM_ROLES, UserRole } from '../../../common/enums/user-role.enum';
import { UserStatus } from '../../../common/enums/user-status.enum';
import type { CrmActor } from '../common/access/crm-actor';
import { CrmRateLimitService } from '../common/security/crm-rate-limit.service';
import { CareRole } from '../customers/customer.constants';
import { CareTeamInviteesService } from './care-team-invitees.service';
import {
  INVITEE_MAX_LIMIT,
  INVITEE_SEARCH_MAX_LENGTH,
  ListCareTeamInviteesQueryDto,
} from './dtos/care-team-invitees.dto';

/**
 * T-15 (FR-13, FR-14): `GET /crm/care-team-invitees`. Mô hình Mongoose/repo/redis giả; kiểm filter gửi xuống DB, quyền,
 * rate-limit, phân trang và đúng MỘT truy vấn `teams` cho cả trang.
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

const careEntry = (userId: Types.ObjectId, role: CareRole) => ({
  userId,
  role,
  addedBy: userId,
  addedAt: new Date('2026-11-10T08:00:00Z'),
});

interface BuildOptions {
  actor?: CrmActor;
  users?: Array<Record<string, unknown>>;
  total?: number;
  teams?: Array<{ _id: Types.ObjectId; name: string }>;
  customer?: { careTeam: ReturnType<typeof careEntry>[] } | null;
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
  const actors = { resolve: jest.fn(() => Promise.resolve(actor)) };
  const customers = {
    findOne: jest.fn(() =>
      Promise.resolve(
        options.customer === undefined ? { careTeam: [] } : options.customer,
      ),
    ),
  };
  const rateLimit = { consume: jest.fn(() => Promise.resolve()) };
  const service = new CareTeamInviteesService(
    userModel as never,
    teamModel as never,
    actors as never,
    customers as never,
    rateLimit as never,
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
    actors,
    customers,
    rateLimit,
    userFilter,
  };
};

const query = (
  overrides: Partial<ListCareTeamInviteesQueryDto> = {},
): ListCareTeamInviteesQueryDto =>
  Object.assign(new ListCareTeamInviteesQueryDto(), overrides);

describe('CareTeamInviteesService: quyền (FR-13)', () => {
  it('Admin/Manager không có customerId được xem; không đọc khách', async () => {
    for (const role of [UserRole.ADMIN, UserRole.MANAGER]) {
      const ctx = build({ actor: makeActor({ role, roles: [role] }) });
      await expect(ctx.service.list(ctx.jwt, query())).resolves.toMatchObject({
        data: [],
      });
      expect(ctx.customers.findOne).not.toHaveBeenCalled();
    }
  });

  it('Staff không có customerId bị 403 CARE_TEAM_ACTION_FORBIDDEN, không truy vấn users', async () => {
    const ctx = build({
      actor: makeActor({ role: UserRole.STAFF, roles: [UserRole.STAFF] }),
    });
    await expect(ctx.service.list(ctx.jwt, query())).rejects.toMatchObject({
      errorCode: 'CARE_TEAM_ACTION_FORBIDDEN',
      status: 403,
    });
    expect(ctx.userModel.find).not.toHaveBeenCalled();
  });

  it('Staff là PRIMARY của khách được xem', async () => {
    const staff = makeActor({ role: UserRole.STAFF, roles: [UserRole.STAFF] });
    const ctx = build({
      actor: staff,
      customer: { careTeam: [careEntry(staff.userId, CareRole.PRIMARY)] },
    });
    await expect(
      ctx.service.list(ctx.jwt, query({ customerId: String(oid()) })),
    ).resolves.toMatchObject({ data: [] });
  });

  it('Staff chỉ là MEMBER của khách bị 403', async () => {
    const staff = makeActor({ role: UserRole.STAFF, roles: [UserRole.STAFF] });
    const ctx = build({
      actor: staff,
      customer: {
        careTeam: [
          careEntry(oid(), CareRole.PRIMARY),
          careEntry(staff.userId, CareRole.MEMBER),
        ],
      },
    });
    await expect(
      ctx.service.list(ctx.jwt, query({ customerId: String(oid()) })),
    ).rejects.toMatchObject({
      errorCode: 'CARE_TEAM_ACTION_FORBIDDEN',
      status: 403,
    });
    expect(ctx.userModel.find).not.toHaveBeenCalled();
  });

  it('khách không tồn tại hoặc ngoài phạm vi ⇒ 404 CUSTOMER_NOT_FOUND', async () => {
    const ctx = build({ customer: null });
    await expect(
      ctx.service.list(ctx.jwt, query({ customerId: String(oid()) })),
    ).rejects.toMatchObject({ errorCode: 'CUSTOMER_NOT_FOUND', status: 404 });
    expect(ctx.userModel.find).not.toHaveBeenCalled();
  });

  it('tra khách theo phạm vi của người gọi và chỉ lấy trường careTeam', async () => {
    const ctx = build();
    const customerId = String(oid());
    await ctx.service.list(ctx.jwt, query({ customerId }));

    const args = (ctx.customers.findOne.mock.calls as unknown[][])[0];
    expect(args[1]).toBe(customerId);
    expect(args[2]).toEqual({ projection: { careTeam: 1 } });
  });
});

describe('CareTeamInviteesService: loại trừ', () => {
  it('filter chỉ nhận user chưa xóa mềm, ACTIVE (không BLOCKED), role Manager/Staff', async () => {
    const ctx = build();
    await ctx.service.list(ctx.jwt, query());

    expect(ctx.userFilter()).toMatchObject({
      deletedAt: null,
      status: UserStatus.ACTIVE,
      roles: { $in: CRM_TEAM_ROLES },
    });
    expect(CRM_TEAM_ROLES).toEqual([UserRole.MANAGER, UserRole.STAFF]);
  });

  it('loại chính người gọi (không customerId)', async () => {
    const ctx = build();
    await ctx.service.list(ctx.jwt, query());
    expect(ctx.userFilter()._id).toEqual({ $nin: [ctx.actor.userId] });
  });

  it('có customerId: loại người gọi và mọi người đã trong careTeam (PRIMARY lẫn MEMBER)', async () => {
    const primary = oid();
    const member = oid();
    const ctx = build({
      customer: {
        careTeam: [
          careEntry(primary, CareRole.PRIMARY),
          careEntry(member, CareRole.MEMBER),
        ],
      },
    });
    await ctx.service.list(ctx.jwt, query({ customerId: String(oid()) }));

    expect(ctx.userFilter()._id).toEqual({
      $nin: [ctx.actor.userId, primary, member],
    });
  });

  it('khách chưa có careTeam: chỉ loại người gọi', async () => {
    const ctx = build({ customer: { careTeam: [] } });
    await ctx.service.list(ctx.jwt, query({ customerId: String(oid()) }));
    expect(ctx.userFilter()._id).toEqual({ $nin: [ctx.actor.userId] });
  });
});

describe('CareTeamInviteesService: từ khóa q (escapeRegex)', () => {
  it('không có q thì không lọc displayName', async () => {
    const ctx = build();
    await ctx.service.list(ctx.jwt, query());
    expect(ctx.userFilter()).not.toHaveProperty('displayName');
  });

  it('q chứa ký tự regex được escape, không phân biệt hoa/thường, khớp chuỗi nguyên văn', async () => {
    const ctx = build();
    await ctx.service.list(ctx.jwt, query({ q: 'a.*(b+)[c]' }));

    const regex = ctx.userFilter().displayName as RegExp;
    expect(regex).toBeInstanceOf(RegExp);
    expect(regex.flags).toBe('i');
    expect(regex.source).toBe('a\\.\\*\\(b\\+\\)\\[c\\]');
    expect(regex.test('A.*(B+)[C] Nguyễn')).toBe(true);
    expect(regex.test('axxbbc')).toBe(false);
  });

  it('q là toàn ký tự đặc biệt không ném lỗi RegExp', async () => {
    const ctx = build();
    await expect(
      ctx.service.list(ctx.jwt, query({ q: '\\(((*+?' })),
    ).resolves.toBeDefined();
  });
});

describe('CareTeamInviteesService: phân trang', () => {
  it('mặc định trang 1, 20 bản ghi, sắp theo displayName rồi _id, collation vi', async () => {
    const ctx = build({ users: [], total: 0 });
    const result = await ctx.service.list(ctx.jwt, query());

    const find = (ctx.userModel.find.mock.results[0] as { value: FakeQuery })
      .value;
    expect(find.sort).toHaveBeenCalledWith({ displayName: 1, _id: 1 });
    expect(find.collation).toHaveBeenCalledWith({ locale: 'vi' });
    expect(find.skip).toHaveBeenCalledWith(0);
    expect(find.limit).toHaveBeenCalledWith(20);
    expect(result.meta).toEqual({
      total: 0,
      page: 1,
      limit: 20,
      totalPages: 0,
    });
  });

  it('trang 3 limit 5: skip 10, total/totalPages tính từ countDocuments cùng filter', async () => {
    const ctx = build({ users: [], total: 23 });
    const result = await ctx.service.list(
      ctx.jwt,
      query({ page: 3, limit: 5 }),
    );

    const find = (ctx.userModel.find.mock.results[0] as { value: FakeQuery })
      .value;
    expect(find.skip).toHaveBeenCalledWith(10);
    expect(find.limit).toHaveBeenCalledWith(5);
    expect(ctx.userModel.countDocuments).toHaveBeenCalledWith(ctx.userFilter());
    expect(result.meta).toEqual({
      total: 23,
      page: 3,
      limit: 5,
      totalPages: 5,
    });
  });
});

describe('CareTeamInviteesService: response (FR-14)', () => {
  it('chỉ trả id, displayName, teamNames; không lộ email/SĐT/CCCD/role/id nhóm; chọn đúng trường tối thiểu', async () => {
    const teamA = oid();
    const teamB = oid();
    const userId = oid();
    const ctx = build({
      users: [
        {
          _id: userId,
          displayName: 'Hạnh',
          email: 'h@x.vn',
          phone: '0900',
          roles: [UserRole.STAFF],
          teamId: teamA,
          teamIds: [teamA, teamB],
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
        id: String(userId),
        displayName: 'Hạnh',
        teamNames: ['Nhóm A', 'Nhóm B'],
      },
    ]);
    expect(Object.keys(result.data[0]).sort()).toEqual([
      'displayName',
      'id',
      'teamNames',
    ]);
    const find = (ctx.userModel.find.mock.results[0] as { value: FakeQuery })
      .value;
    expect(find.select).toHaveBeenCalledWith('displayName teamId teamIds');
  });

  it('cả trang chỉ tốn MỘT truy vấn teams (không N+1), id nhóm trùng được gộp', async () => {
    const shared = oid();
    const other = oid();
    const ctx = build({
      users: [
        { _id: oid(), displayName: 'A', teamIds: [shared] },
        { _id: oid(), displayName: 'B', teamIds: [shared, other] },
        { _id: oid(), displayName: 'C', teamIds: [other] },
      ],
      teams: [
        { _id: shared, name: 'Chung' },
        { _id: other, name: 'Khác' },
      ],
    });
    const result = await ctx.service.list(ctx.jwt, query());

    expect(ctx.teamModel.find).toHaveBeenCalledTimes(1);
    const teamFilter = (ctx.teamModel.find.mock.calls as unknown[][])[0][0] as {
      _id: { $in: Types.ObjectId[] };
    };
    expect(teamFilter._id.$in.map(String).sort()).toEqual(
      [String(shared), String(other)].sort(),
    );
    expect(result.data.map((item) => item.teamNames)).toEqual([
      ['Chung'],
      ['Chung', 'Khác'],
      ['Khác'],
    ]);
  });

  it('người chưa có nhóm ⇒ teamNames rỗng; nhóm đã mất bị bỏ qua', async () => {
    const gone = oid();
    const ctx = build({
      users: [
        { _id: oid(), displayName: 'Không nhóm', teamIds: [] },
        { _id: oid(), displayName: 'Nhóm đã xóa', teamIds: [gone] },
      ],
      teams: [],
    });
    const result = await ctx.service.list(ctx.jwt, query());
    expect(result.data.map((item) => item.teamNames)).toEqual([[], []]);
  });

  it('không có người nào thì không truy vấn teams', async () => {
    const ctx = build({ users: [] });
    await ctx.service.list(ctx.jwt, query());
    expect(ctx.teamModel.find).not.toHaveBeenCalled();
  });

  it('user cũ chỉ có teamId (chưa có teamIds) vẫn ra tên nhóm', async () => {
    const team = oid();
    const ctx = build({
      users: [{ _id: oid(), displayName: 'Cũ', teamId: team }],
      teams: [{ _id: team, name: 'Nhóm cũ' }],
    });
    const result = await ctx.service.list(ctx.jwt, query());
    expect(result.data[0].teamNames).toEqual(['Nhóm cũ']);
  });
});

describe('CareTeamInviteesService: rate-limit INVITEE_SEARCH (FR-14)', () => {
  it('tính đúng MỘT lượt theo người gọi, trước mọi truy cập dữ liệu', async () => {
    const ctx = build();
    await ctx.service.list(ctx.jwt, query());
    expect(ctx.rateLimit.consume).toHaveBeenCalledTimes(1);
    expect(ctx.rateLimit.consume).toHaveBeenCalledWith(
      String(ctx.actor.userId),
      'INVITEE_SEARCH',
    );
  });

  it('vượt giới hạn ⇒ 429, không dựng actor, không truy vấn DB', async () => {
    const ctx = build();
    ctx.rateLimit.consume.mockRejectedValue(
      Object.assign(new Error('rate'), {
        errorCode: 'RATE_LIMITED',
        status: 429,
      }),
    );
    await expect(ctx.service.list(ctx.jwt, query())).rejects.toMatchObject({
      errorCode: 'RATE_LIMITED',
      status: 429,
    });
    expect(ctx.actors.resolve).not.toHaveBeenCalled();
    expect(ctx.userModel.find).not.toHaveBeenCalled();
    expect(ctx.teamModel.find).not.toHaveBeenCalled();
  });

  it('CrmRateLimitService thật: 60 lượt qua, lượt 61 ⇒ 429 RATE_LIMITED, khóa theo INVITEE_SEARCH và người dùng', async () => {
    let count = 0;
    const redis = { eval: jest.fn(() => Promise.resolve([++count, 30_000])) };
    const limiter = new CrmRateLimitService(redis as never);

    for (let i = 0; i < 60; i += 1) {
      await limiter.consume('user-1', 'INVITEE_SEARCH');
    }
    await expect(
      limiter.consume('user-1', 'INVITEE_SEARCH'),
    ).rejects.toMatchObject({
      errorCode: 'RATE_LIMITED',
      status: 429,
      details: { retryAfterSeconds: 30 },
    });
    expect(redis.eval).toHaveBeenLastCalledWith(
      expect.any(String),
      1,
      'crm:rl:INVITEE_SEARCH:user-1',
      60_000,
    );
  });

  it('Redis lỗi ⇒ 503 SERVICE_UNAVAILABLE (fail-closed)', async () => {
    const redis = { eval: jest.fn(() => Promise.reject(new Error('down'))) };
    const limiter = new CrmRateLimitService(redis as never);
    await expect(
      limiter.consume('user-1', 'INVITEE_SEARCH'),
    ).rejects.toMatchObject({ errorCode: 'SERVICE_UNAVAILABLE', status: 503 });
  });
});

describe('ListCareTeamInviteesQueryDto: kiểm tra đầu vào', () => {
  const check = async (plain: Record<string, unknown>) =>
    validate(plainToInstance(ListCareTeamInviteesQueryDto, plain));

  it('chấp nhận query hợp lệ và áp mặc định page=1, limit=20', async () => {
    const dto = plainToInstance(ListCareTeamInviteesQueryDto, {});
    expect(await validate(dto)).toHaveLength(0);
    expect(dto.page).toBe(1);
    expect(dto.limit).toBe(20);
  });

  it(`limit tối đa ${INVITEE_MAX_LIMIT}: 21 bị từ chối, 20 qua`, async () => {
    expect(await check({ limit: '21' })).not.toHaveLength(0);
    expect(await check({ limit: '20' })).toHaveLength(0);
    expect(await check({ limit: '0' })).not.toHaveLength(0);
  });

  it(`q tối đa ${INVITEE_SEARCH_MAX_LENGTH} ký tự: 51 bị từ chối, 50 qua`, async () => {
    expect(
      await check({ q: 'a'.repeat(INVITEE_SEARCH_MAX_LENGTH + 1) }),
    ).not.toHaveLength(0);
    expect(
      await check({ q: 'a'.repeat(INVITEE_SEARCH_MAX_LENGTH) }),
    ).toHaveLength(0);
  });

  it('customerId phải là ObjectId; q dạng object (NoSQL operator) bị từ chối', async () => {
    expect(await check({ customerId: 'abc' })).not.toHaveLength(0);
    expect(await check({ customerId: String(oid()) })).toHaveLength(0);
    expect(await check({ q: { $ne: '' } })).not.toHaveLength(0);
  });

  it('page < 1 bị từ chối', async () => {
    expect(await check({ page: '0' })).not.toHaveLength(0);
  });
});
