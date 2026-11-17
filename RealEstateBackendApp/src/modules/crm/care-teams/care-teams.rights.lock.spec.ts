import { Types } from 'mongoose';
import {
  buildAccess,
  buildCustomer,
  buildCustomerWithOtherPrimary,
  buildScopedRepo,
  fakeConnection,
  jwtOf,
  OUT_OF_SCOPE_KEYS,
  REJECTS,
  USERS,
  type UserKey,
} from '../customers/access/customer-rights.fixture';
import { buildCustomerScope } from '../customers/access/customer-scope';
import { CareRole } from '../customers/customer.constants';
import { CareTeamInviteesService } from './care-team-invitees.service';
import { CareTeamService } from './care-team.service';

/**
 * T-54 (FR-31): KHÓA HIỆN TRẠNG quyền mời/gỡ thành viên `careTeam` (ô A12) bằng `buildCustomerScope` +
 * `CustomersRepository` THẬT; (e4) ĐO ai gỡ được ai; (f) khóa việc gỡ PRIMARY.
 * Luật hiện hành: `canManageMembers` = Admin, MỌI Manager trong phạm vi, hoặc PRIMARY hiện tại. T-56 thu hẹp còn
 * Admin, người tạo khách, Manager nhóm chủ và thêm luật "không ai gỡ được người tạo" (A13).
 * Hậu tố `[đảo ở T-56]` = hành vi hiện tại sẽ đổi ở T-56; test không hậu tố phải xanh đến hết T-61.
 */

const usersById = () =>
  new Map(
    Object.values(USERS).map((actor) => [
      String(actor.userId),
      { _id: actor.userId, teamIds: actor.teamIds },
    ]),
  );

const build = (customer = buildCustomer()) => {
  const { repo, updates } = buildScopedRepo([customer]);
  const assignees = {
    load: jest.fn().mockResolvedValue(usersById()),
    assertAssignable: jest.fn(),
    lock: jest.fn().mockResolvedValue(undefined),
  };
  const service = new CareTeamService(
    fakeConnection() as never,
    repo,
    buildAccess() as never,
    { resolve: jest.fn().mockResolvedValue({ users: new Map() }) } as never,
    assignees as never,
    { record: jest.fn().mockResolvedValue(undefined) } as never,
    { dispatch: jest.fn().mockResolvedValue(undefined) } as never,
    { consume: jest.fn().mockResolvedValue(undefined) } as never,
  );
  return { service, customer, updates };
};

type Harness = ReturnType<typeof build>;

const invite = (h: Harness, key: UserKey, invitee: UserKey = 'STAFF_OUT') =>
  h.service.addMembers(jwtOf(key), String(h.customer._id), {
    userIds: [String(USERS[invitee].userId)],
  });

const kick = (h: Harness, key: UserKey, target: UserKey) =>
  h.service.removeMember(
    jwtOf(key),
    String(h.customer._id),
    String(USERS[target].userId),
  );

/** `careTeam` được ghi xuống DB ở lần update duy nhất. */
const writtenCareTeam = (h: Harness) => {
  expect(h.updates).toHaveLength(1);
  return (
    h.updates[0].update.$set as {
      careTeam: Array<{ userId: Types.ObjectId; role: CareRole }>;
    }
  ).careTeam;
};
const roleOf = (
  careTeam: Array<{ userId: Types.ObjectId; role: CareRole }>,
  key: UserKey,
) => careTeam.find((member) => member.userId.equals(USERS[key].userId))?.role;

// ============================================================================================
// A12 Mời thành viên
// ============================================================================================
describe('CareTeamService.addMembers: mời thành viên (FR-31 a, c, e; ô A12)', () => {
  it.each(OUT_OF_SCOPE_KEYS)(
    'FR-31 (a, c): %s ngoài phạm vi => 404 CUSTOMER_NOT_FOUND, không ghi',
    async (key) => {
      const h = build();
      await expect(invite(h, key)).rejects.toMatchObject(
        REJECTS.CUSTOMER_NOT_FOUND,
      );
      expect(h.updates).toHaveLength(0);
    },
  );

  it.each(['ADMIN', 'MANAGER_OWNER', 'STAFF_PRIMARY'] as UserKey[])(
    'FR-31 (e): %s (Admin, Manager nhóm chủ, người tạo kiêm PRIMARY) mời được; người mới vào làm MEMBER (giữ ở T-56)',
    async (key) => {
      const h = build();
      await invite(h, key);
      expect(roleOf(writtenCareTeam(h), 'STAFF_OUT')).toBe(CareRole.MEMBER);
    },
  );

  it.each(['MANAGER_R8', 'MANAGER_INCARE'] as UserKey[])(
    'FR-31 (e): %s (Manager trong phạm vi nhưng không phải Manager nhóm chủ) hiện mời được [đảo ở T-56]',
    async (key) => {
      const h = build();
      await invite(h, key);
      expect(roleOf(writtenCareTeam(h), 'STAFF_OUT')).toBe(CareRole.MEMBER);
    },
  );

  it('FR-31 (e): PRIMARY không phải người tạo (khách cũ) hiện mời được [đảo ở T-56]', async () => {
    const h = build(buildCustomerWithOtherPrimary());
    await invite(h, 'STAFF_MEMBER');
    expect(roleOf(writtenCareTeam(h), 'STAFF_OUT')).toBe(CareRole.MEMBER);
  });

  it.each(['STAFF_MEMBER', 'STAFF_INVITED'] as UserKey[])(
    'FR-31 (e): %s (MEMBER, không phải PRIMARY) mời => 403 CARE_TEAM_ACTION_FORBIDDEN, không ghi (giữ ở T-56)',
    async (key) => {
      const h = build();
      await expect(invite(h, key)).rejects.toMatchObject(
        REJECTS.CARE_TEAM_ACTION_FORBIDDEN,
      );
      expect(h.updates).toHaveLength(0);
    },
  );

  it('FR-31 (e): người tạo chỉ là MEMBER (PRIMARY là người khác) hiện KHÔNG mời được => 403 [đảo ở T-56]', async () => {
    const h = build(buildCustomerWithOtherPrimary());
    await expect(invite(h, 'STAFF_PRIMARY')).rejects.toMatchObject(
      REJECTS.CARE_TEAM_ACTION_FORBIDDEN,
    );
    expect(h.updates).toHaveLength(0);
  });

  it('FR-31 (e): mời người đã trong nhóm => 409 ALREADY_IN_CARE_TEAM (giữ ở T-56)', async () => {
    const h = build();
    await expect(invite(h, 'ADMIN', 'STAFF_INVITED')).rejects.toMatchObject({
      status: 409,
      errorCode: 'ALREADY_IN_CARE_TEAM',
    });
    expect(h.updates).toHaveLength(0);
  });
});

// ============================================================================================
// A12 Gỡ thành viên; (e4) ai gỡ được ai; (f) khóa PRIMARY
// ============================================================================================
describe('CareTeamService.removeMember: gỡ thành viên (FR-31 e, e4, f; ô A12, A13)', () => {
  describe('gỡ một MEMBER thường (STAFF_INVITED; không phải người tạo)', () => {
    it.each(OUT_OF_SCOPE_KEYS)(
      'FR-31 (a, c): %s ngoài phạm vi => 404 CUSTOMER_NOT_FOUND, không ghi',
      async (key) => {
        const h = build();
        await expect(kick(h, key, 'STAFF_INVITED')).rejects.toMatchObject(
          REJECTS.CUSTOMER_NOT_FOUND,
        );
        expect(h.updates).toHaveLength(0);
      },
    );

    it.each(['ADMIN', 'MANAGER_OWNER', 'STAFF_PRIMARY'] as UserKey[])(
      'FR-31 (e4): %s (Admin, Manager nhóm chủ, người tạo kiêm PRIMARY) gỡ được MEMBER; người bị gỡ rời nhóm (giữ ở T-56)',
      async (key) => {
        const h = build();
        await kick(h, key, 'STAFF_INVITED');
        expect(roleOf(writtenCareTeam(h), 'STAFF_INVITED')).toBeUndefined();
        expect(roleOf(writtenCareTeam(h), 'STAFF_PRIMARY')).toBe(
          CareRole.PRIMARY,
        );
      },
    );

    it.each(['MANAGER_R8', 'MANAGER_INCARE'] as UserKey[])(
      'FR-31 (e4): %s (Manager trong phạm vi, không phải Manager nhóm chủ) hiện gỡ được MEMBER [đảo ở T-56]',
      async (key) => {
        const h = build();
        await kick(h, key, 'STAFF_INVITED');
        expect(roleOf(writtenCareTeam(h), 'STAFF_INVITED')).toBeUndefined();
      },
    );

    it('FR-31 (e4): PRIMARY không phải người tạo hiện gỡ được MEMBER [đảo ở T-56]', async () => {
      const h = build(buildCustomerWithOtherPrimary());
      await kick(h, 'STAFF_MEMBER', 'STAFF_INVITED');
      expect(roleOf(writtenCareTeam(h), 'STAFF_INVITED')).toBeUndefined();
    });

    it.each(['STAFF_MEMBER', 'STAFF_INVITED'] as UserKey[])(
      'FR-31 (e4): %s (MEMBER) gỡ người khác => 403 CARE_TEAM_ACTION_FORBIDDEN (giữ ở T-56)',
      async (key) => {
        const h = build();
        await expect(
          kick(
            h,
            key,
            key === 'STAFF_MEMBER' ? 'STAFF_INVITED' : 'STAFF_MEMBER',
          ),
        ).rejects.toMatchObject(REJECTS.CARE_TEAM_ACTION_FORBIDDEN);
        expect(h.updates).toHaveLength(0);
      },
    );

    it('FR-31 (e4): gỡ người không có trong nhóm => 404 RESOURCE_NOT_FOUND (giữ ở T-56)', async () => {
      const h = build();
      await expect(kick(h, 'ADMIN', 'STAFF_OUT')).rejects.toMatchObject(
        REJECTS.RESOURCE_NOT_FOUND,
      );
      expect(h.updates).toHaveLength(0);
    });
  });

  describe('(f) gỡ PRIMARY: khóa vĩnh viễn, kể cả Admin (kể cả PRIMARY gỡ chính mình)', () => {
    it.each([
      'ADMIN',
      'MANAGER_OWNER',
      'MANAGER_R8',
      'STAFF_PRIMARY',
    ] as UserKey[])(
      'FR-31 (f): %s gỡ PRIMARY (cũng là người tạo) => 409 PRIMARY_LOCKED, không ghi (giữ ở T-56)',
      async (key) => {
        const h = build();
        await expect(kick(h, key, 'STAFF_PRIMARY')).rejects.toMatchObject(
          REJECTS.PRIMARY_LOCKED,
        );
        expect(h.updates).toHaveLength(0);
      },
    );

    it.each(['ADMIN', 'MANAGER_OWNER', 'STAFF_MEMBER'] as UserKey[])(
      'FR-31 (f): %s gỡ PRIMARY KHÔNG phải người tạo (khách cũ) => 409 PRIMARY_LOCKED, không ghi (giữ ở T-56)',
      async (key) => {
        const h = build(buildCustomerWithOtherPrimary());
        await expect(kick(h, key, 'STAFF_MEMBER')).rejects.toMatchObject(
          REJECTS.PRIMARY_LOCKED,
        );
        expect(h.updates).toHaveLength(0);
      },
    );

    it('FR-31 (f): MEMBER muốn gỡ PRIMARY bị chặn quyền trước (403, không phải 409) (giữ ở T-56)', async () => {
      const h = build();
      await expect(
        kick(h, 'STAFF_MEMBER', 'STAFF_PRIMARY'),
      ).rejects.toMatchObject(REJECTS.CARE_TEAM_ACTION_FORBIDDEN);
    });
  });

  describe('(e4) gỡ NGƯỜI TẠO khi người đó chỉ là MEMBER (khách cũ: PRIMARY là người khác)', () => {
    it.each(['ADMIN', 'MANAGER_OWNER', 'MANAGER_R8'] as UserKey[])(
      'FR-31 (e4): %s hiện gỡ được người tạo (MEMBER) khỏi nhóm [đảo ở T-56: 409 PRIMARY_LOCKED, reason CREATOR_LOCKED]',
      async (key) => {
        const h = build(buildCustomerWithOtherPrimary());
        await kick(h, key, 'STAFF_PRIMARY');
        expect(roleOf(writtenCareTeam(h), 'STAFF_PRIMARY')).toBeUndefined();
      },
    );

    it('FR-31 (e4): PRIMARY (không phải người tạo) hiện gỡ được người tạo (MEMBER) [đảo ở T-56]', async () => {
      const h = build(buildCustomerWithOtherPrimary());
      await kick(h, 'STAFF_MEMBER', 'STAFF_PRIMARY');
      expect(roleOf(writtenCareTeam(h), 'STAFF_PRIMARY')).toBeUndefined();
    });
  });

  it('FR-31 (e): thành viên bị gỡ mất quyền xem ngay (phạm vi Staff tính từ careTeam hiện tại; giữ ở T-56, không áp cho người tạo)', async () => {
    const h = build();
    await kick(h, 'ADMIN', 'STAFF_INVITED');
    const after = {
      ...h.customer,
      careTeam: writtenCareTeam(h),
    };
    const { repo } = buildScopedRepo([after]);
    await expect(
      repo.findOne(buildCustomerScope(USERS.STAFF_INVITED), after._id),
    ).resolves.toBeNull();
    await expect(
      repo.findOne(buildCustomerScope(USERS.STAFF_MEMBER), after._id),
    ).resolves.not.toBeNull();
  });
});

// ============================================================================================
// A12 Danh sách người có thể mời (care-team-invitees)
// ============================================================================================
describe('CareTeamInviteesService.list: ai xem được danh sách người có thể mời (FR-31 a, c, e; ô A12)', () => {
  const listChain = <T>(result: T) => {
    const query: Record<string, jest.Mock> = {};
    for (const step of [
      'select',
      'collation',
      'sort',
      'skip',
      'limit',
      'lean',
    ]) {
      query[step] = jest.fn(() => query);
    }
    query.exec = jest.fn(() => Promise.resolve(result));
    return query;
  };

  const buildInvitees = (customer = buildCustomer()) => {
    const { repo } = buildScopedRepo([customer]);
    const byId = new Map(
      Object.values(USERS).map((actor) => [String(actor.userId), actor]),
    );
    const userModel = {
      find: jest.fn(() => listChain([])),
      countDocuments: jest.fn(() => listChain(0)),
    };
    const service = new CareTeamInviteesService(
      userModel as never,
      { find: jest.fn(() => listChain([])) } as never,
      {
        resolve: jest.fn((jwt: { sub: string }) =>
          Promise.resolve(byId.get(jwt.sub)),
        ),
      } as never,
      repo,
      { consume: jest.fn().mockResolvedValue(undefined) } as never,
    );
    return { service, customer, userModel };
  };
  type InviteesHarness = ReturnType<typeof buildInvitees>;

  const listFor = (h: InviteesHarness, key: UserKey) =>
    h.service.list(jwtOf(key), { customerId: String(h.customer._id) });
  const listWithoutCustomer = (h: InviteesHarness, key: UserKey) =>
    h.service.list(jwtOf(key), {});

  it.each(OUT_OF_SCOPE_KEYS)(
    'FR-31 (a, c): %s ngoài phạm vi => 404 CUSTOMER_NOT_FOUND, không truy vấn người dùng',
    async (key) => {
      const h = buildInvitees();
      await expect(listFor(h, key)).rejects.toMatchObject(
        REJECTS.CUSTOMER_NOT_FOUND,
      );
      expect(h.userModel.find).not.toHaveBeenCalled();
    },
  );

  it.each(['ADMIN', 'MANAGER_OWNER', 'STAFF_PRIMARY'] as UserKey[])(
    'FR-31 (e): %s (Admin, Manager nhóm chủ, người tạo kiêm PRIMARY) xem được danh sách mời theo khách (giữ ở T-56)',
    async (key) => {
      const h = buildInvitees();
      await expect(listFor(h, key)).resolves.toMatchObject({ data: [] });
    },
  );

  it.each(['MANAGER_R8', 'MANAGER_INCARE'] as UserKey[])(
    'FR-31 (e): %s (Manager trong phạm vi, không phải Manager nhóm chủ) hiện xem được danh sách mời [đảo ở T-56]',
    async (key) => {
      const h = buildInvitees();
      await expect(listFor(h, key)).resolves.toMatchObject({ data: [] });
    },
  );

  it('FR-31 (e): PRIMARY không phải người tạo hiện xem được danh sách mời [đảo ở T-56]', async () => {
    const h = buildInvitees(buildCustomerWithOtherPrimary());
    await expect(listFor(h, 'STAFF_MEMBER')).resolves.toMatchObject({
      data: [],
    });
  });

  it.each(['STAFF_MEMBER', 'STAFF_INVITED'] as UserKey[])(
    'FR-31 (e): %s (MEMBER) => 403 CARE_TEAM_ACTION_FORBIDDEN, không truy vấn người dùng (giữ ở T-56)',
    async (key) => {
      const h = buildInvitees();
      await expect(listFor(h, key)).rejects.toMatchObject(
        REJECTS.CARE_TEAM_ACTION_FORBIDDEN,
      );
      expect(h.userModel.find).not.toHaveBeenCalled();
    },
  );

  it.each(['ADMIN', 'MANAGER_OUT', 'MANAGER_OWNER'] as UserKey[])(
    'FR-31 (e): %s (Admin hoặc Manager) xem danh sách mời khi KHÔNG kèm khách (thao tác hàng loạt) (giữ ở T-56)',
    async (key) => {
      const h = buildInvitees();
      await expect(listWithoutCustomer(h, key)).resolves.toMatchObject({
        data: [],
      });
    },
  );

  it.each(['STAFF_PRIMARY', 'STAFF_MEMBER', 'STAFF_OUT'] as UserKey[])(
    'FR-31 (e): %s (Staff) KHÔNG xem được danh sách mời khi không kèm khách => 403 CARE_TEAM_ACTION_FORBIDDEN (giữ ở T-56)',
    async (key) => {
      const h = buildInvitees();
      await expect(listWithoutCustomer(h, key)).rejects.toMatchObject(
        REJECTS.CARE_TEAM_ACTION_FORBIDDEN,
      );
      expect(h.userModel.find).not.toHaveBeenCalled();
    },
  );
});
