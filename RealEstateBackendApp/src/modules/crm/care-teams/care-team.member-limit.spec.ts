import { Types } from 'mongoose';
import { UserRole } from '../../../common/enums/user-role.enum';
import { UserStatus } from '../../../common/enums/user-status.enum';
import { BulkOperationsService } from '../bulk-operations/bulk-operations.service';
import { BulkOperationType } from '../bulk-operations/dtos/bulk-operation.dto';
import { CrmRateLimitService } from '../common/security/crm-rate-limit.service';
import { CareRole } from '../customers/customer.constants';
import { CareTeamEntry } from '../customers/schemas/customer.schema';
import { CareTeamAssigneesService } from './care-team-assignees.service';
import { MAX_CARE_TEAM_MEMBERS } from './care-team.constants';
import {
  assertMemberLimit,
  CareTeamChange,
  planAddMembers,
  planRemoveMember,
} from './care-team.rules';
import { CareTeamService } from './care-team.service';

/**
 * FR-13 + FR-17: mời không giới hạn theo nhóm, tối đa 10 thành viên phụ (MEMBER) mỗi khách, rate-limit `CARE_TEAM_INVITE`.
 * Phần service chạy với kho khách GIẢ có khóa `__v` (như Mongo) để kiểm cả tranh chấp đồng thời lẫn hàng loạt.
 */
const oid = () => new Types.ObjectId();
const NOW = new Date('2026-11-10T08:00:00Z');
const ACTOR = oid();
const PRIMARY = oid();
const TEAM_A = oid();
const TEAM_B = oid();
const TEAM_C = oid();

const memberEntries = (count: number): CareTeamEntry[] =>
  Array.from({ length: count }, () => ({
    userId: oid(),
    role: CareRole.MEMBER,
    addedBy: ACTOR,
    addedAt: NOW,
  }));

const primaryEntry = (userId = PRIMARY): CareTeamEntry => ({
  userId,
  role: CareRole.PRIMARY,
  addedBy: ACTOR,
  addedAt: NOW,
});

const teamOf = (memberCount: number): CareTeamEntry[] => [
  primaryEntry(),
  ...memberEntries(memberCount),
];

const addChange = (
  current: CareTeamEntry[],
  addedCount: number,
): CareTeamChange => {
  const added = Array.from({ length: addedCount }, () => oid());
  return planAddMembers(current, { userIds: added }, ACTOR, NOW);
};

/** `expect.objectContaining` trả `any`; ép về `Error` để `toThrow` không dính no-unsafe-argument. */
const errorLike = (fields: Record<string, unknown>): Error =>
  expect.objectContaining(fields) as Error;

describe('assertMemberLimit (FR-17)', () => {
  it('hằng số giới hạn là 10', () => {
    expect(MAX_CARE_TEAM_MEMBERS).toBe(10);
  });

  it('thêm để đạt ĐÚNG 10 MEMBER ⇒ cho qua', () => {
    expect(() => assertMemberLimit(addChange(teamOf(9), 1))).not.toThrow();
  });

  it('thêm thứ 11 ⇒ 409 CARE_TEAM_LIMIT_EXCEEDED kèm limit', () => {
    expect(() => assertMemberLimit(addChange(teamOf(10), 1))).toThrow(
      errorLike({
        errorCode: 'CARE_TEAM_LIMIT_EXCEEDED',
        status: 409,
        details: { limit: 10, membersAfter: 11 },
      }),
    );
  });

  it('PRIMARY không tính vào giới hạn: PRIMARY + 10 MEMBER là hợp lệ', () => {
    const change = addChange(teamOf(0), 10);
    expect(change.careTeam).toHaveLength(11);
    expect(() => assertMemberLimit(change)).not.toThrow();
  });

  it('thêm một lần nhiều người làm vượt trần ⇒ chặn cả lần (8 + 3 = 11), còn vừa đủ (8 + 2 = 10) thì qua', () => {
    expect(() => assertMemberLimit(addChange(teamOf(8), 3))).toThrow(
      errorLike({ errorCode: 'CARE_TEAM_LIMIT_EXCEEDED' }),
    );
    expect(() => assertMemberLimit(addChange(teamOf(8), 2))).not.toThrow();
  });

  it('đặt PRIMARY lần đầu kèm 11 MEMBER bị chặn, 10 MEMBER thì qua', () => {
    const plan = (members: number) =>
      planAddMembers(
        [],
        {
          userIds: memberEntries(members).map((m) => m.userId),
          primaryUserId: PRIMARY,
        },
        ACTOR,
        NOW,
      );
    expect(() => assertMemberLimit(plan(11))).toThrow(
      errorLike({ errorCode: 'CARE_TEAM_LIMIT_EXCEEDED' }),
    );
    expect(() => assertMemberLimit(plan(10))).not.toThrow();
  });

  it('khách cũ đã 11 MEMBER: chặn thêm, nhưng gỡ vẫn qua (không ép gỡ)', () => {
    const legacy = teamOf(11);
    expect(() => assertMemberLimit(addChange(legacy, 1))).toThrow(
      errorLike({
        errorCode: 'CARE_TEAM_LIMIT_EXCEEDED',
        details: { limit: 10, membersAfter: 12 },
      }),
    );
    const removal = planRemoveMember(legacy, legacy[1].userId);
    expect(
      removal.careTeam.filter((m) => m.role === CareRole.MEMBER),
    ).toHaveLength(10);
    expect(() => assertMemberLimit(removal)).not.toThrow();
  });

  it('thay đổi không thêm ai (người đã có, bỏ qua) luôn qua dù nhóm đã quá trần', () => {
    const legacy = teamOf(12);
    const change = planAddMembers(
      legacy,
      { userIds: [legacy[2].userId] },
      ACTOR,
      NOW,
      { skipExisting: true },
    );
    expect(change.addedUserIds).toEqual([]);
    expect(() => assertMemberLimit(change)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Service với kho khách giả có khóa __v
// ---------------------------------------------------------------------------

interface FakeUser {
  _id: Types.ObjectId;
  role: UserRole;
  roles: UserRole[];
  status: UserStatus;
  teamIds: Types.ObjectId[];
  deletedAt: Date | null;
}

const user = (over: Partial<FakeUser> = {}): FakeUser => ({
  _id: oid(),
  role: UserRole.STAFF,
  roles: [UserRole.STAFF],
  status: UserStatus.ACTIVE,
  teamIds: [TEAM_B],
  deletedAt: null,
  ...over,
});

interface FakeCustomer {
  careTeam: CareTeamEntry[];
  teamIds: Types.ObjectId[];
  __v: number;
}

/** Lỗi như Mongo báo khi hai transaction ghi cùng một bản ghi: có nhãn TransientTransactionError nên bị chạy lại. */
const writeConflict = () =>
  Object.assign(new Error('WriteConflict'), {
    errorLabels: ['TransientTransactionError'],
  });
const isTransient = (error: unknown) =>
  (error as { errorLabels?: string[] })?.errorLabels?.includes(
    'TransientTransactionError',
  ) ?? false;

/**
 * `conflict`: cách kho giả báo bên ghi muộn khi `__v` đã lệch.
 * - `'write-conflict'` (mặc định, giống Mongo thật): ném WriteConflict, `connection.transaction` chạy lại `work`.
 * - `'no-match'`: `updateOne` khớp 0 bản ghi (trả false) ⇒ service ném VERSION_CONFLICT.
 */
const build = (
  customers: Record<string, FakeCustomer>,
  users: FakeUser[],
  actor: { userId: Types.ObjectId; role: UserRole } = {
    userId: PRIMARY,
    role: UserRole.STAFF,
  },
  conflict: 'write-conflict' | 'no-match' = 'write-conflict',
) => {
  const writes: Array<{ id: string; update: any }> = [];
  // Cổng chặn: cho phép hai lần đọc xảy ra TRƯỚC khi lần ghi nào chạy (mô phỏng hai request đồng thời).
  let gate: Promise<void> | null = null;
  const repo = {
    findOne: jest.fn(async (_scope: unknown, id: string) => {
      const stored = customers[id];
      const snapshot = stored && {
        careTeam: [...stored.careTeam],
        teamIds: stored.teamIds,
        fullName: 'Anh Minh',
        __v: stored.__v,
      };
      if (gate) await gate;
      return snapshot ?? null;
    }),
    updateOne: jest.fn(
      (_scope: unknown, id: string, filter: { __v: number }, update: any) => {
        const stored = customers[id];
        if (!stored) return Promise.resolve(false);
        if (stored.__v !== filter.__v) {
          return conflict === 'write-conflict'
            ? Promise.reject(writeConflict())
            : Promise.resolve(false);
        }
        stored.careTeam = update.$set.careTeam;
        stored.teamIds = update.$set.teamIds;
        stored.__v += 1;
        writes.push({ id, update });
        return Promise.resolve(true);
      },
    ),
  };
  const userModel = {
    find: jest.fn(
      (filter: { _id: { $in: Types.ObjectId[] }; deletedAt: null }) => ({
        select: () => ({
          session: () => ({
            lean: () => ({
              exec: () =>
                Promise.resolve(
                  users.filter(
                    (u) =>
                      filter.deletedAt === null &&
                      u.deletedAt === null &&
                      filter._id.$in.some((id) => id.equals(u._id)),
                  ),
                ),
            }),
          }),
        }),
      }),
    ),
    updateMany: jest.fn(() => ({ exec: () => Promise.resolve(undefined) })),
  };
  const session = { id: 's' };
  // Như `connection.transaction` của Mongoose: gặp TransientTransactionError thì chạy lại toàn bộ `work`.
  const connection = {
    transaction: jest.fn(async (work: (s: unknown) => Promise<unknown>) => {
      for (let attempt = 1; ; attempt += 1) {
        try {
          return await work(session);
        } catch (error) {
          if (!isTransient(error) || attempt >= 5) throw error;
        }
      }
    }),
  };
  const access = {
    resolve: jest.fn().mockResolvedValue({
      scope: {},
      actor: {
        userId: actor.userId,
        role: actor.role,
        roles: [actor.role],
        displayName: 'Người mời',
        teamIds: [TEAM_A],
        managedTeamIds: [],
      },
    }),
  };
  const refs = {
    resolve: jest
      .fn()
      .mockResolvedValue({ users: new Map(), userStates: new Map() }),
  };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const dispatch = jest.fn().mockResolvedValue({ created: 0 });
  const rateLimit = { consume: jest.fn().mockResolvedValue(undefined) };
  const service = new CareTeamService(
    connection as never,
    repo as never,
    access as never,
    refs as never,
    new CareTeamAssigneesService(userModel as never),
    audit as never,
    { dispatch } as never,
    rateLimit as never,
  );
  return {
    service,
    repo,
    writes,
    audit,
    dispatch,
    rateLimit,
    access,
    connection,
    session,
    openGate: () => {
      let release!: () => void;
      let reads = 0;
      const original = repo.findOne.getMockImplementation()!;
      gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      repo.findOne.mockImplementation(async (...args) => {
        reads += 1;
        if (reads === 2) release();
        return original(...args);
      });
    },
  };
};

const CUSTOMER = String(oid());
const JWT = { sub: String(PRIMARY) } as never;
const customerWith = (careTeam: CareTeamEntry[]): FakeCustomer => ({
  careTeam,
  teamIds: [TEAM_A],
  __v: 1,
});
const idsOf = (careTeam: CareTeamEntry[]) =>
  careTeam.map((m) => String(m.userId));

describe('CareTeamService.addMembers: mời không giới hạn nhóm (FR-13)', () => {
  it('Nhân viên PRIMARY mời Nhân viên NHÓM KHÁC ⇒ thành công; teamIds = hợp nhóm mọi thành viên', async () => {
    const inviteeB = user({ teamIds: [TEAM_B] });
    const existing = user({ teamIds: [TEAM_A] });
    const store = {
      [CUSTOMER]: customerWith([
        primaryEntry(),
        { ...memberEntries(1)[0], userId: existing._id },
      ]),
    };
    const primaryUser = user({ teamIds: [TEAM_A] });
    primaryUser._id = PRIMARY;
    const { service, writes, dispatch } = build(store, [
      primaryUser,
      existing,
      inviteeB,
    ]);

    await service.addMembers(JWT, CUSTOMER, {
      userIds: [String(inviteeB._id)],
    });

    expect(idsOf(store[CUSTOMER].careTeam)).toContain(String(inviteeB._id));
    expect(
      store[CUSTOMER].careTeam.find((m) => m.userId.equals(inviteeB._id))?.role,
    ).toBe(CareRole.MEMBER);
    expect(store[CUSTOMER].teamIds.map(String).sort()).toEqual(
      [String(TEAM_A), String(TEAM_B)].sort(),
    );
    expect(writes).toHaveLength(1);
    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it('Quản lý (không quản lý nhóm của người được mời) mời người ngoài nhóm mình ⇒ thành công', async () => {
    const manager = oid();
    const invitee = user({ teamIds: [TEAM_C] });
    const store = { [CUSTOMER]: customerWith([primaryEntry()]) };
    const primaryUser = user({ teamIds: [TEAM_A] });
    primaryUser._id = PRIMARY;
    const { service } = build(store, [primaryUser, invitee], {
      userId: manager,
      role: UserRole.MANAGER,
    });

    await service.addMembers({ sub: String(manager) } as never, CUSTOMER, {
      userIds: [String(invitee._id)],
    });

    expect(idsOf(store[CUSTOMER].careTeam)).toContain(String(invitee._id));
    expect(store[CUSTOMER].teamIds.map(String).sort()).toEqual(
      [String(TEAM_A), String(TEAM_C)].sort(),
    );
  });

  it.each([
    ['BLOCKED', user({ status: UserStatus.BLOCKED })],
    [
      'chỉ role Quản trị',
      user({ role: UserRole.ADMIN, roles: [UserRole.ADMIN] }),
    ],
    [
      'chỉ role Biên tập',
      user({ role: UserRole.EDITOR, roles: [UserRole.EDITOR] }),
    ],
    ['đã xóa mềm', user({ deletedAt: NOW })],
  ])(
    'mời người %s ⇒ 400 USER_NOT_ASSIGNABLE, không ghi/audit/thông báo',
    async (_n, invitee) => {
      const store = { [CUSTOMER]: customerWith([primaryEntry()]) };
      const { service, writes, audit, dispatch } = build(store, [invitee]);

      await expect(
        service.addMembers(JWT, CUSTOMER, { userIds: [String(invitee._id)] }),
      ).rejects.toMatchObject({
        errorCode: 'USER_NOT_ASSIGNABLE',
        details: { userIds: [String(invitee._id)] },
      });
      expect(writes).toHaveLength(0);
      expect(audit.record).not.toHaveBeenCalled();
      expect(dispatch).not.toHaveBeenCalled();
      expect(store[CUSTOMER].__v).toBe(1);
    },
  );

  it('mời người đã trong nhóm ⇒ 409 ALREADY_IN_CARE_TEAM (không phải lỗi giới hạn), kể cả khi nhóm đang đầy', async () => {
    const full = teamOf(10);
    const store = { [CUSTOMER]: customerWith(full) };
    const { service, writes } = build(store, []);

    await expect(
      service.addMembers(JWT, CUSTOMER, { userIds: [String(full[3].userId)] }),
    ).rejects.toMatchObject({ errorCode: 'ALREADY_IN_CARE_TEAM' });
    expect(writes).toHaveLength(0);
  });
});

describe('CareTeamService.addMembers: giới hạn 10 thành viên phụ (FR-17)', () => {
  it('thành viên thứ 10 được thêm; thành viên thứ 11 bị 409 CARE_TEAM_LIMIT_EXCEEDED, nhóm/version/audit/thông báo không đổi', async () => {
    const tenth = user();
    const eleventh = user();
    const store = { [CUSTOMER]: customerWith(teamOf(9)) };
    const { service, writes, audit, dispatch } = build(store, [
      tenth,
      eleventh,
    ]);

    await service.addMembers(JWT, CUSTOMER, { userIds: [String(tenth._id)] });
    expect(
      store[CUSTOMER].careTeam.filter((m) => m.role === CareRole.MEMBER),
    ).toHaveLength(10);
    expect(store[CUSTOMER].__v).toBe(2);
    const auditCalls = audit.record.mock.calls.length;
    const dispatchCalls = dispatch.mock.calls.length;

    await expect(
      service.addMembers(JWT, CUSTOMER, { userIds: [String(eleventh._id)] }),
    ).rejects.toMatchObject({ errorCode: 'CARE_TEAM_LIMIT_EXCEEDED' });

    expect(store[CUSTOMER].careTeam).toHaveLength(11);
    expect(store[CUSTOMER].__v).toBe(2);
    expect(writes).toHaveLength(1);
    expect(audit.record).toHaveBeenCalledTimes(auditCalls);
    expect(dispatch).toHaveBeenCalledTimes(dispatchCalls);
  });

  it('khách cũ đã 11 MEMBER: thêm bị chặn, gỡ được; chỉ thêm lại được khi xuống dưới 10', async () => {
    const invitee = user();
    const legacy = teamOf(11);
    const store = { [CUSTOMER]: customerWith(legacy) };
    const { service } = build(store, [invitee]);
    const invite = () =>
      service.addMembers(JWT, CUSTOMER, { userIds: [String(invitee._id)] });

    await expect(invite()).rejects.toMatchObject({
      errorCode: 'CARE_TEAM_LIMIT_EXCEEDED',
    });

    await service.removeMember(JWT, CUSTOMER, String(legacy[1].userId)); // 11 → 10
    expect(
      store[CUSTOMER].careTeam.filter((m) => m.role === CareRole.MEMBER),
    ).toHaveLength(10);
    await expect(invite()).rejects.toMatchObject({
      errorCode: 'CARE_TEAM_LIMIT_EXCEEDED',
    });

    await service.removeMember(JWT, CUSTOMER, String(legacy[2].userId)); // 10 → 9
    await invite(); // 9 → 10
    expect(idsOf(store[CUSTOMER].careTeam)).toContain(String(invitee._id));
    expect(
      store[CUSTOMER].careTeam.filter((m) => m.role === CareRole.MEMBER),
    ).toHaveLength(10);
  });

  it('hai lời mời ĐỒNG THỜI cùng chạm trần (9 MEMBER, mỗi bên thêm 1), Mongo báo WriteConflict: bên thắng ghi, bên thua được chạy lại, đọc thấy đủ 10 và nhận CARE_TEAM_LIMIT_EXCEEDED; nhóm không vượt 10', async () => {
    const first = user();
    const second = user();
    const store = { [CUSTOMER]: customerWith(teamOf(9)) };
    const ctx = build(store, [first, second]);
    ctx.openGate(); // cả hai đọc cùng __v = 1 trước khi bên nào ghi

    const results = await Promise.allSettled([
      ctx.service.addMembers(JWT, CUSTOMER, { userIds: [String(first._id)] }),
      ctx.service.addMembers(JWT, CUSTOMER, { userIds: [String(second._id)] }),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter(
      (r): r is PromiseRejectedResult => r.status === 'rejected',
    );
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toMatchObject({
      errorCode: 'CARE_TEAM_LIMIT_EXCEEDED',
    });
    expect(
      store[CUSTOMER].careTeam.filter((m) => m.role === CareRole.MEMBER),
    ).toHaveLength(10);
    expect(store[CUSTOMER].__v).toBe(2);
    expect(ctx.writes).toHaveLength(1);
    // Bên thua đã thật sự được chạy lại (giao dịch mở thêm một lần): 2 yêu cầu + 1 lần retry.
    expect(ctx.connection.transaction).toHaveBeenCalledTimes(2);
    expect(ctx.repo.findOne.mock.calls.length).toBeGreaterThanOrEqual(3);
    // Mỗi người mời chỉ được ghi nhận tối đa một lần và đúng một người trong hai được vào nhóm.
    const added = [first._id, second._id].filter((id) =>
      idsOf(store[CUSTOMER].careTeam).includes(String(id)),
    );
    expect(added).toHaveLength(1);
  });

  it('hai lời mời đồng thời khi lần ghi muộn KHỚP 0 bản ghi (không có WriteConflict): bên thua nhận 409 VERSION_CONFLICT, nhóm vẫn đúng 10', async () => {
    const first = user();
    const second = user();
    const store = { [CUSTOMER]: customerWith(teamOf(9)) };
    const ctx = build(store, [first, second], undefined, 'no-match');
    ctx.openGate();

    const results = await Promise.allSettled([
      ctx.service.addMembers(JWT, CUSTOMER, { userIds: [String(first._id)] }),
      ctx.service.addMembers(JWT, CUSTOMER, { userIds: [String(second._id)] }),
    ]);

    const rejected = results.filter(
      (r): r is PromiseRejectedResult => r.status === 'rejected',
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toMatchObject({ errorCode: 'VERSION_CONFLICT' });
    expect(
      store[CUSTOMER].careTeam.filter((m) => m.role === CareRole.MEMBER),
    ).toHaveLength(10);
    expect(store[CUSTOMER].__v).toBe(2);
    expect(ctx.writes).toHaveLength(1);

    // Người thua tải lại rồi thử lần nữa: thấy nhóm đã đủ 10 nên bị chặn đúng mã giới hạn.
    const loserId = idsOf(store[CUSTOMER].careTeam).includes(String(first._id))
      ? second._id
      : first._id;
    await expect(
      ctx.service.addMembers(JWT, CUSTOMER, { userIds: [String(loserId)] }),
    ).rejects.toMatchObject({ errorCode: 'CARE_TEAM_LIMIT_EXCEEDED' });
  });

  it('mời người BLOCKED vào khách đã đủ 10 MEMBER ⇒ USER_NOT_ASSIGNABLE (kiểm hợp lệ trước giới hạn), không ghi', async () => {
    const blocked = user({ status: UserStatus.BLOCKED });
    const store = { [CUSTOMER]: customerWith(teamOf(10)) };
    const { service, writes } = build(store, [blocked]);

    await expect(
      service.addMembers(JWT, CUSTOMER, { userIds: [String(blocked._id)] }),
    ).rejects.toMatchObject({
      errorCode: 'USER_NOT_ASSIGNABLE',
      details: { userIds: [String(blocked._id)] },
    });
    expect(writes).toHaveLength(0);
    expect(store[CUSTOMER].__v).toBe(1);
  });
});

describe('CareTeamService.addMembers: rate-limit CARE_TEAM_INVITE (FR-17)', () => {
  it('tính đúng MỘT lượt theo người gọi, trước mọi truy cập dữ liệu', async () => {
    const invitee = user();
    const store = { [CUSTOMER]: customerWith([primaryEntry()]) };
    const { service, rateLimit } = build(store, [invitee]);
    await service.addMembers(JWT, CUSTOMER, { userIds: [String(invitee._id)] });

    expect(rateLimit.consume).toHaveBeenCalledTimes(1);
    expect(rateLimit.consume).toHaveBeenCalledWith(
      String(PRIMARY),
      'CARE_TEAM_INVITE',
    );
  });

  it('vượt giới hạn ⇒ 429 từ rate-limit, không mở transaction, không đọc/ghi khách', async () => {
    const store = { [CUSTOMER]: customerWith([primaryEntry()]) };
    const ctx = build(store, [user()]);
    ctx.rateLimit.consume.mockRejectedValue(
      Object.assign(new Error('rate'), {
        errorCode: 'RATE_LIMITED',
        status: 429,
      }),
    );

    await expect(
      ctx.service.addMembers(JWT, CUSTOMER, { userIds: [String(oid())] }),
    ).rejects.toMatchObject({ errorCode: 'RATE_LIMITED', status: 429 });
    expect(ctx.access.resolve).not.toHaveBeenCalled();
    expect(ctx.connection.transaction).not.toHaveBeenCalled();
    expect(ctx.repo.findOne).not.toHaveBeenCalled();
  });

  it('gỡ thành viên và đọc nhóm không tốn lượt CARE_TEAM_INVITE', async () => {
    const legacy = teamOf(2);
    const store = { [CUSTOMER]: customerWith(legacy) };
    const { service, rateLimit } = build(store, []);

    await service.removeMember(JWT, CUSTOMER, String(legacy[1].userId));
    await service.get(JWT, CUSTOMER);

    expect(rateLimit.consume).not.toHaveBeenCalled();
  });

  it('CrmRateLimitService thật: lượt thứ 30 qua, lượt thứ 31 trong cửa sổ ⇒ 429 RATE_LIMITED, khóa theo CARE_TEAM_INVITE và người dùng', async () => {
    let count = 0;
    const redis = {
      eval: jest.fn(() => Promise.resolve([++count, 42_000])),
    };
    const limiter = new CrmRateLimitService(redis as never);

    for (let i = 0; i < 30; i += 1) {
      await limiter.consume('user-1', 'CARE_TEAM_INVITE');
    }
    await expect(
      limiter.consume('user-1', 'CARE_TEAM_INVITE'),
    ).rejects.toMatchObject({
      errorCode: 'RATE_LIMITED',
      status: 429,
      details: { retryAfterSeconds: 42 },
    });
    expect(redis.eval).toHaveBeenLastCalledWith(
      expect.any(String),
      1,
      'crm:rl:CARE_TEAM_INVITE:user-1',
      60_000,
    );
  });
});

describe('BulkOperationsService ASSIGN + giới hạn 10 MEMBER (FR-17, FR-13)', () => {
  const CUSTOMER_OK = String(oid());
  const CUSTOMER_FULL = String(oid());
  const CUSTOMER_LEGACY = String(oid());
  const CUSTOMER_SMALL = String(oid());

  const buildBulk = (invitee: FakeUser) => {
    const store = {
      [CUSTOMER_OK]: customerWith(teamOf(9)),
      [CUSTOMER_FULL]: customerWith(teamOf(10)),
      [CUSTOMER_LEGACY]: customerWith(teamOf(11)),
      [CUSTOMER_SMALL]: customerWith(teamOf(2)),
    };
    const manager = oid();
    const careCtx = build(store, [invitee], {
      userId: manager,
      role: UserRole.MANAGER,
    });
    const bulkRateLimit = { consume: jest.fn().mockResolvedValue(undefined) };
    const bulk = new BulkOperationsService(
      careCtx.connection as never,
      {
        resolve: jest.fn().mockResolvedValue({
          scope: {},
          actor: {
            userId: manager,
            role: UserRole.MANAGER,
            roles: [UserRole.MANAGER],
            displayName: 'Quản lý',
            teamIds: [TEAM_A],
            managedTeamIds: [TEAM_A],
          },
        }),
      } as never,
      {} as never,
      careCtx.service,
      {} as never,
      {} as never,
      bulkRateLimit as never,
    );
    return { bulk, store, careCtx, bulkRateLimit, manager };
  };

  const runAssign = (
    bulk: BulkOperationsService,
    manager: Types.ObjectId,
    memberId: Types.ObjectId,
    customerIds: string[],
  ) =>
    bulk.run(
      { sub: String(manager), email: 'm@test.vn', role: 'MANAGER' },
      {
        type: BulkOperationType.ASSIGN,
        customerIds,
        payload: { memberIds: [String(memberId)] },
      },
    );

  it('báo từng khách: khách còn chỗ thành công (kể cả người nhóm khác), khách đủ 10 hoặc cũ >10 thất bại CARE_TEAM_LIMIT_EXCEEDED, khách thất bại không bị đụng tới', async () => {
    const invitee = user({ teamIds: [TEAM_C] });
    const { bulk, store, manager } = buildBulk(invitee);

    const result = await runAssign(bulk, manager, invitee._id, [
      CUSTOMER_OK,
      CUSTOMER_FULL,
      CUSTOMER_LEGACY,
      CUSTOMER_SMALL,
    ]);

    expect(result.succeeded).toEqual([CUSTOMER_OK, CUSTOMER_SMALL]);
    expect(result.failed).toEqual([
      { customerId: CUSTOMER_FULL, errorCode: 'CARE_TEAM_LIMIT_EXCEEDED' },
      { customerId: CUSTOMER_LEGACY, errorCode: 'CARE_TEAM_LIMIT_EXCEEDED' },
    ]);
    expect(store[CUSTOMER_OK].careTeam).toHaveLength(11);
    expect(store[CUSTOMER_SMALL].careTeam).toHaveLength(4);
    expect(store[CUSTOMER_FULL].careTeam).toHaveLength(11);
    expect(store[CUSTOMER_FULL].__v).toBe(1);
    expect(store[CUSTOMER_LEGACY].careTeam).toHaveLength(12);
    expect(store[CUSTOMER_LEGACY].__v).toBe(1);
    // Người ngoài nhóm Quản lý vẫn được thêm: teamIds khách có thêm nhóm của người được mời.
    expect(store[CUSTOMER_SMALL].teamIds.map(String)).toContain(String(TEAM_C));
  });

  it('người đã có trong nhóm khách đầy bị bỏ qua (thành công, không đổi); không tốn lượt CARE_TEAM_INVITE của người gọi', async () => {
    const invitee = user();
    const { bulk, store, manager, careCtx, bulkRateLimit } = buildBulk(invitee);
    store[CUSTOMER_FULL].careTeam[1] = {
      ...store[CUSTOMER_FULL].careTeam[1],
      userId: invitee._id,
    };

    const result = await runAssign(bulk, manager, invitee._id, [CUSTOMER_FULL]);

    expect(result).toEqual({ succeeded: [CUSTOMER_FULL], failed: [] });
    expect(store[CUSTOMER_FULL].__v).toBe(1);
    expect(bulkRateLimit.consume).toHaveBeenCalledWith(
      String(manager),
      'BULK_OPERATION',
    );
    expect(careCtx.rateLimit.consume).not.toHaveBeenCalled();
  });

  it('người được mời BLOCKED ⇒ mọi khách thất bại USER_NOT_ASSIGNABLE, không khách nào đổi', async () => {
    const invitee = user({ status: UserStatus.BLOCKED });
    const { bulk, store, manager } = buildBulk(invitee);

    const result = await runAssign(bulk, manager, invitee._id, [
      CUSTOMER_OK,
      CUSTOMER_SMALL,
    ]);

    expect(result.succeeded).toEqual([]);
    expect(result.failed.map((f) => f.errorCode)).toEqual([
      'USER_NOT_ASSIGNABLE',
      'USER_NOT_ASSIGNABLE',
    ]);
    expect(store[CUSTOMER_OK].__v).toBe(1);
    expect(store[CUSTOMER_SMALL].__v).toBe(1);
  });
});
