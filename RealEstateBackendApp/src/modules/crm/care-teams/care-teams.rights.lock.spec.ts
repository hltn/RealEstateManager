import { Types } from 'mongoose';
import {
  buildAccess,
  buildCustomer,
  buildCustomerCreatorOutsideCareTeam,
  buildCustomerWithOtherPrimary,
  buildScopedRepo,
  buildUserDirectory,
  fakeConnection,
  jwtOf,
  OUT_OF_SCOPE_KEYS,
  REJECTS,
  TEAM_A,
  TEAM_B,
  USERS,
  type UserKey,
} from '../customers/access/customer-rights.fixture';
import { buildCustomerScope } from '../customers/access/customer-scope';
import { CareRole } from '../customers/customer.constants';
import { CareTeamInviteesService } from './care-team-invitees.service';
import { CareTeamService } from './care-team.service';

/**
 * Quyền mời/gỡ thành viên `careTeam` (ô A12) bằng `buildCustomerScope` + `CustomersRepository` + `CustomerOwnerTeamService`
 * THẬT (T-54 khóa hiện trạng; T-56 đảo theo FR-31): chỉ Admin, NGƯỜI TẠO khách, Manager nhóm chủ được mời/gỡ; PRIMARY/MEMBER
 * không tự có quyền; (A13) KHÔNG ai gỡ được người tạo (409 PRIMARY_LOCKED + reason CREATOR_LOCKED); (f) gỡ PRIMARY không
 * phải người tạo vẫn khóa 409.
 * Các test từng mang nhãn `[đảo ở T-56]` ở T-54 đã đảo theo luật mới (nhãn đã bỏ khỏi tiêu đề ở T-57); test hậu tố `(giữ ở T-56)` giữ nguyên ý.
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
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const dispatch = jest.fn().mockResolvedValue(undefined);
  const service = new CareTeamService(
    fakeConnection() as never,
    repo,
    buildAccess() as never,
    { resolve: jest.fn().mockResolvedValue({ users: new Map() }) } as never,
    assignees as never,
    audit as never,
    { dispatch } as never,
    { consume: jest.fn().mockResolvedValue(undefined) } as never,
    buildUserDirectory().ownerTeam,
  );
  return { service, customer, updates, audit, dispatch };
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
    'FR-31 (e): %s (Admin, Manager nhóm chủ chưa trong careTeam, người tạo) mời được; người mới vào làm MEMBER',
    async (key) => {
      const h = build();
      await invite(h, key);
      expect(roleOf(writtenCareTeam(h), 'STAFF_OUT')).toBe(CareRole.MEMBER);
    },
  );

  it.each(['MANAGER_R8', 'MANAGER_INCARE'] as UserKey[])(
    'FR-31 (e): %s (Manager trong phạm vi nhưng không phải Manager nhóm chủ; INCARE còn là MEMBER) => 403, không ghi',
    async (key) => {
      const h = build();
      await expect(invite(h, key)).rejects.toMatchObject(
        REJECTS.CARE_TEAM_ACTION_FORBIDDEN,
      );
      expect(h.updates).toHaveLength(0);
    },
  );

  it('FR-31 (e): PRIMARY không phải người tạo (khách cũ) => 403, không ghi', async () => {
    const h = build(buildCustomerWithOtherPrimary());
    await expect(invite(h, 'STAFF_MEMBER')).rejects.toMatchObject(
      REJECTS.CARE_TEAM_ACTION_FORBIDDEN,
    );
    expect(h.updates).toHaveLength(0);
  });

  it.each(['STAFF_MEMBER', 'STAFF_INVITED'] as UserKey[])(
    'FR-31 (e): %s (MEMBER, không phải người tạo) mời => 403 CARE_TEAM_ACTION_FORBIDDEN, không ghi (giữ ở T-56)',
    async (key) => {
      const h = build();
      await expect(invite(h, key)).rejects.toMatchObject(
        REJECTS.CARE_TEAM_ACTION_FORBIDDEN,
      );
      expect(h.updates).toHaveLength(0);
    },
  );

  it('FR-31 (e): người tạo chỉ là MEMBER (PRIMARY là người khác) mời được', async () => {
    const h = build(buildCustomerWithOtherPrimary());
    await invite(h, 'STAFF_PRIMARY');
    expect(roleOf(writtenCareTeam(h), 'STAFF_OUT')).toBe(CareRole.MEMBER);
    expect(roleOf(writtenCareTeam(h), 'STAFF_MEMBER')).toBe(CareRole.PRIMARY);
  });

  it('FR-31: khách cũ mà người tạo KHÔNG còn trong careTeam: người tạo vẫn thấy và mời được (nhánh createdBy của scope)', async () => {
    const h = build(buildCustomerCreatorOutsideCareTeam());
    await invite(h, 'STAFF_PRIMARY');
    expect(roleOf(writtenCareTeam(h), 'STAFF_OUT')).toBe(CareRole.MEMBER);
    // Người tạo không bị đưa vào lại nhóm chỉ vì mời người khác.
    expect(roleOf(writtenCareTeam(h), 'STAFF_PRIMARY')).toBeUndefined();
  });

  it('FR-31: người tạo là Manager mời được khách của mình; Manager nhóm khác (thấy khách qua teamIds) thì không', async () => {
    const make = () =>
      buildCustomerCreatorOutsideCareTeam({
        createdBy: USERS.MANAGER_R8.userId,
        teamIds: [TEAM_A, TEAM_B],
      });
    const own = build(make());
    await invite(own, 'MANAGER_R8');
    expect(roleOf(writtenCareTeam(own), 'STAFF_OUT')).toBe(CareRole.MEMBER);

    const other = build(make());
    await expect(invite(other, 'MANAGER_OWNER')).rejects.toMatchObject(
      REJECTS.CARE_TEAM_ACTION_FORBIDDEN,
    );
    expect(other.updates).toHaveLength(0);
  });

  it('FR-31: khách cũ thiếu createdBy: không ai là người tạo nên PRIMARY bị 403; Admin và Manager của nhóm trong teamIds (dự phòng nhóm chủ) mời được', async () => {
    const legacy = () => buildCustomer({ createdBy: null });
    await expect(
      invite(build(legacy()), 'STAFF_PRIMARY'),
    ).rejects.toMatchObject(REJECTS.CARE_TEAM_ACTION_FORBIDDEN);
    // Dự phòng `teamIds` của khách: MANAGER_OWNER quản TEAM_A nằm trong teamIds nên được coi là Manager nhóm chủ.
    await invite(build(legacy()), 'MANAGER_OWNER');
    await invite(build(legacy()), 'ADMIN');
  });

  it('FR-31: nhóm chủ đã xóa mềm không còn Manager nhóm chủ (Manager của nhóm đó bị 403)', async () => {
    const customer = buildCustomer();
    const { repo, updates } = buildScopedRepo([customer]);
    const service = new CareTeamService(
      fakeConnection() as never,
      repo,
      buildAccess() as never,
      { resolve: jest.fn().mockResolvedValue({ users: new Map() }) } as never,
      {
        load: jest.fn().mockResolvedValue(usersById()),
        assertAssignable: jest.fn(),
        lock: jest.fn().mockResolvedValue(undefined),
      } as never,
      { record: jest.fn().mockResolvedValue(undefined) } as never,
      { dispatch: jest.fn().mockResolvedValue(undefined) } as never,
      { consume: jest.fn().mockResolvedValue(undefined) } as never,
      buildUserDirectory({ deletedTeamIds: [TEAM_A] }).ownerTeam,
    );
    await expect(
      service.addMembers(jwtOf('MANAGER_OWNER'), String(customer._id), {
        userIds: [String(USERS.STAFF_OUT.userId)],
      }),
    ).rejects.toMatchObject(REJECTS.CARE_TEAM_ACTION_FORBIDDEN);
    expect(updates).toHaveLength(0);
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
// A12 Gỡ thành viên; (e4) ai gỡ được ai; (f) khóa PRIMARY; (A13) khóa người tạo
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
      'FR-31 (e4): %s (Admin, Manager nhóm chủ, người tạo) gỡ được MEMBER; người bị gỡ rời nhóm',
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
      'FR-31 (e4): %s (Manager trong phạm vi, không phải Manager nhóm chủ) => 403, không ghi',
      async (key) => {
        const h = build();
        await expect(kick(h, key, 'STAFF_INVITED')).rejects.toMatchObject(
          REJECTS.CARE_TEAM_ACTION_FORBIDDEN,
        );
        expect(h.updates).toHaveLength(0);
      },
    );

    it('FR-31 (e4): PRIMARY không phải người tạo => 403, không ghi', async () => {
      const h = build(buildCustomerWithOtherPrimary());
      await expect(
        kick(h, 'STAFF_MEMBER', 'STAFF_INVITED'),
      ).rejects.toMatchObject(REJECTS.CARE_TEAM_ACTION_FORBIDDEN);
      expect(h.updates).toHaveLength(0);
    });

    it('FR-31 (e4): người tạo chỉ là MEMBER (PRIMARY là người khác) gỡ được MEMBER khác', async () => {
      const h = build(buildCustomerWithOtherPrimary());
      await kick(h, 'STAFF_PRIMARY', 'STAFF_INVITED');
      expect(roleOf(writtenCareTeam(h), 'STAFF_INVITED')).toBeUndefined();
      expect(roleOf(writtenCareTeam(h), 'STAFF_MEMBER')).toBe(CareRole.PRIMARY);
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

  describe('(f) gỡ PRIMARY không phải người tạo: khóa vĩnh viễn, kể cả Admin', () => {
    it.each(['ADMIN', 'MANAGER_OWNER', 'STAFF_PRIMARY'] as UserKey[])(
      'FR-31 (f): %s (có quyền chủ khách) gỡ PRIMARY không phải người tạo => 409 PRIMARY_LOCKED không có reason CREATOR_LOCKED, không ghi',
      async (key) => {
        const h = build(buildCustomerWithOtherPrimary());
        const error = await kick(h, key, 'STAFF_MEMBER').catch(
          (e: unknown) => e,
        );
        expect(error).toMatchObject(REJECTS.PRIMARY_LOCKED);
        expect((error as { details?: unknown }).details).toBeUndefined();
        expect(h.updates).toHaveLength(0);
      },
    );

    it('FR-31 (f): chính PRIMARY (không phải người tạo) gỡ mình => 403 (không còn quyền gỡ), không phải 409', async () => {
      const h = build(buildCustomerWithOtherPrimary());
      await expect(
        kick(h, 'STAFF_MEMBER', 'STAFF_MEMBER'),
      ).rejects.toMatchObject(REJECTS.CARE_TEAM_ACTION_FORBIDDEN);
      expect(h.updates).toHaveLength(0);
    });

    it('FR-31 (f): MEMBER muốn gỡ PRIMARY bị chặn quyền trước (403, không phải 409) (giữ ở T-56)', async () => {
      const h = build();
      await expect(
        kick(h, 'STAFF_MEMBER', 'STAFF_PRIMARY'),
      ).rejects.toMatchObject(REJECTS.CARE_TEAM_ACTION_FORBIDDEN);
    });
  });

  describe('(A13) KHÔNG ai gỡ được người tạo: 409 PRIMARY_LOCKED + reason CREATOR_LOCKED, kể cả Admin', () => {
    const creatorCases: Array<
      [string, () => ReturnType<typeof buildCustomer>]
    > = [
      ['người tạo kiêm PRIMARY', buildCustomer],
      ['người tạo chỉ là MEMBER', buildCustomerWithOtherPrimary],
    ];

    describe.each(creatorCases)('%s', (_label, make) => {
      it.each(['ADMIN', 'MANAGER_OWNER', 'STAFF_PRIMARY'] as UserKey[])(
        'FR-31: %s (đủ quyền chủ khách) gỡ người tạo => 409 PRIMARY_LOCKED + CREATOR_LOCKED; nhóm, __v không đổi, không ghi',
        async (key) => {
          const h = build(make());
          await expect(kick(h, key, 'STAFF_PRIMARY')).rejects.toMatchObject(
            REJECTS.CREATOR_LOCKED,
          );
          expect(h.updates).toHaveLength(0);
          expect(h.audit.record).not.toHaveBeenCalled();
          expect(h.dispatch).not.toHaveBeenCalled();
        },
      );

      it.each(['MANAGER_R8', 'STAFF_MEMBER', 'STAFF_INVITED'] as UserKey[])(
        'FR-31: %s (không đủ quyền chủ khách) gỡ người tạo => 403 (quyền xét trước), không ghi',
        async (key) => {
          const h = build(make());
          await expect(kick(h, key, 'STAFF_PRIMARY')).rejects.toMatchObject(
            REJECTS.CARE_TEAM_ACTION_FORBIDDEN,
          );
          expect(h.updates).toHaveLength(0);
        },
      );
    });

    it('FR-31: backstop `assertCreatorKept` trong applyInSession: một thay đổi bất kỳ làm mất người tạo (ví dụ thay cả nhóm) => 409 CREATOR_LOCKED, không ghi', async () => {
      const customer = buildCustomer();
      const h = build(customer);
      const ctx = {
        actor: USERS.ADMIN,
        scope: buildCustomerScope(USERS.ADMIN),
      };
      const replaceAll = {
        authorize: () => undefined,
        plan: () => ({
          careTeam: [
            {
              userId: USERS.STAFF_OUT.userId,
              role: CareRole.PRIMARY,
              addedBy: USERS.ADMIN.userId,
              addedAt: new Date(),
            },
          ],
          addedUserIds: [USERS.STAFF_OUT.userId],
          removedUserIds: (
            customer.careTeam as Array<{ userId: Types.ObjectId }>
          ).map((m) => m.userId),
          primaryChanged: true,
        }),
        source: 'WEB',
        origin: 'TEAM_ADD',
      };
      await expect(
        h.service.applyInSession(
          ctx as never,
          String(customer._id),
          replaceAll as never,
          { id: 's' } as never,
        ),
      ).rejects.toMatchObject(REJECTS.CREATOR_LOCKED);
      expect(h.updates).toHaveLength(0);
    });

    /**
     * `assertCreatorKept` là chốt chặn CUỐI trong `applyInSession` (cổng chung của gỡ, mời, phân hàng loạt). Các đường thật
     * hiện đã chặn người tạo từ trước (`assertRemovable`) nên để khóa chính chốt chặn, mỗi ô dưới đây đưa vào cổng một
     * thay đổi LÀM MẤT người tạo theo từng kiểu, với từng vai trò, trên từng loại khách (người tạo kiêm PRIMARY / chỉ là
     * MEMBER), kèm nhãn `origin` của từng đường gọi. Xóa dòng `assertCreatorKept` thì TOÀN BỘ ma trận đỏ.
     */
    describe('backstop assertCreatorKept theo từng kiểu thay đổi, vai trò, đường gọi', () => {
      const memberOf = (key: UserKey, role: CareRole) => ({
        userId: USERS[key].userId,
        role,
        addedBy: USERS.ADMIN.userId,
        addedAt: new Date(),
      });
      /** Nhóm mới sau thay đổi, TÍNH TỪ nhóm hiện tại để luôn loại đúng người tạo. */
      type Shape = (
        current: Array<{ userId: Types.ObjectId; role: CareRole }>,
        creatorId: Types.ObjectId,
      ) => Array<ReturnType<typeof memberOf>>;
      const shapes: Array<[string, Shape]> = [
        [
          'gỡ người tạo, giữ người còn lại',
          (current, creatorId) =>
            current
              .filter((member) => !member.userId.equals(creatorId))
              .map((member) => ({
                ...member,
                addedBy: USERS.ADMIN.userId,
                addedAt: new Date(),
              })),
        ],
        [
          'đổi PRIMARY sang người khác rồi bỏ người tạo',
          () => [memberOf('STAFF_OUT', CareRole.PRIMARY)],
        ],
        [
          'thay cả nhóm bằng người mới',
          () => [
            memberOf('STAFF_OUT', CareRole.PRIMARY),
            memberOf('STAFF_INVITED', CareRole.MEMBER),
          ],
        ],
        ['nhóm mới rỗng', () => []],
      ];
      const origins = ['TEAM_ADD', 'TEAM_REMOVE', 'BULK_ADD'] as const;
      const makers: Array<[string, () => ReturnType<typeof buildCustomer>]> = [
        ['người tạo kiêm PRIMARY', buildCustomer],
        ['người tạo chỉ là MEMBER', buildCustomerWithOtherPrimary],
      ];

      describe.each(makers)('%s', (_label, make) => {
        describe.each(shapes)('%s', (_shape, newTeam) => {
          it.each(
            (['ADMIN', 'MANAGER_OWNER', 'STAFF_PRIMARY'] as UserKey[]).flatMap(
              (key) => origins.map((origin) => [key, origin] as const),
            ),
          )(
            'FR-31: %s qua đường %s => 409 PRIMARY_LOCKED + CREATOR_LOCKED, không ghi, không audit, không thông báo',
            async (key, origin) => {
              const customer = make();
              const h = build(customer);
              const current = customer.careTeam as Array<{
                userId: Types.ObjectId;
                role: CareRole;
              }>;
              const next = newTeam(
                current,
                customer.createdBy as Types.ObjectId,
              );
              const mutation = {
                authorize: () => undefined,
                plan: () => ({
                  careTeam: next,
                  addedUserIds: [],
                  removedUserIds: current.map((member) => member.userId),
                  primaryChanged: true,
                }),
                source: 'WEB',
                origin,
              };
              await expect(
                h.service.applyInSession(
                  {
                    actor: USERS[key],
                    scope: buildCustomerScope(USERS[key]),
                  },
                  String(customer._id),
                  mutation as never,
                  { id: 's' } as never,
                ),
              ).rejects.toMatchObject(REJECTS.CREATOR_LOCKED);
              expect(h.updates).toHaveLength(0);
              expect(h.audit.record).not.toHaveBeenCalled();
              expect(h.dispatch).not.toHaveBeenCalled();
            },
          );
        });
      });

      it('đối chứng: thay đổi GIỮ người tạo (thêm thành viên) KHÔNG bị chốt chặn chặn', async () => {
        const customer = buildCustomer();
        const h = build(customer);
        const current = customer.careTeam as Array<{
          userId: Types.ObjectId;
          role: CareRole;
        }>;
        const mutation = {
          authorize: () => undefined,
          plan: () => ({
            careTeam: [...current, memberOf('STAFF_OUT', CareRole.MEMBER)],
            addedUserIds: [USERS.STAFF_OUT.userId],
            removedUserIds: [],
            primaryChanged: false,
          }),
          source: 'WEB',
          origin: 'BULK_ADD',
        };
        await h.service.applyInSession(
          {
            actor: USERS.ADMIN,
            scope: buildCustomerScope(USERS.ADMIN),
          },
          String(customer._id),
          mutation as never,
          { id: 's' } as never,
        );
        expect(h.updates).toHaveLength(1);
      });
    });

    it('FR-31: khách cũ mà người tạo KHÔNG trong careTeam: không có gì để giữ, gỡ người khác vẫn bình thường', async () => {
      const h = build(buildCustomerCreatorOutsideCareTeam());
      await kick(h, 'STAFF_PRIMARY', 'STAFF_INVITED');
      expect(roleOf(writtenCareTeam(h), 'STAFF_INVITED')).toBeUndefined();
    });
  });

  it('FR-31 (e): thành viên bị gỡ mất quyền xem ngay (phạm vi Staff tính từ careTeam hiện tại hoặc createdBy)', async () => {
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
      buildUserDirectory().ownerTeam,
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
    'FR-31 (e): %s (Admin, Manager nhóm chủ, người tạo) xem được danh sách mời theo khách',
    async (key) => {
      const h = buildInvitees();
      await expect(listFor(h, key)).resolves.toMatchObject({ data: [] });
    },
  );

  it.each(['MANAGER_R8', 'MANAGER_INCARE'] as UserKey[])(
    'FR-31 (e): %s (Manager trong phạm vi, không phải Manager nhóm chủ) => 403 CARE_TEAM_ACTION_FORBIDDEN, không truy vấn người dùng',
    async (key) => {
      const h = buildInvitees();
      await expect(listFor(h, key)).rejects.toMatchObject(
        REJECTS.CARE_TEAM_ACTION_FORBIDDEN,
      );
      expect(h.userModel.find).not.toHaveBeenCalled();
    },
  );

  it('FR-31 (e): PRIMARY không phải người tạo => 403, không truy vấn người dùng', async () => {
    const h = buildInvitees(buildCustomerWithOtherPrimary());
    await expect(listFor(h, 'STAFF_MEMBER')).rejects.toMatchObject(
      REJECTS.CARE_TEAM_ACTION_FORBIDDEN,
    );
    expect(h.userModel.find).not.toHaveBeenCalled();
  });

  it('FR-31 (e): người tạo không còn trong careTeam vẫn xem được danh sách mời theo khách', async () => {
    const h = buildInvitees(buildCustomerCreatorOutsideCareTeam());
    await expect(listFor(h, 'STAFF_PRIMARY')).resolves.toMatchObject({
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
    'FR-31 (e): %s (Staff, kể cả người tạo) KHÔNG xem được danh sách mời khi không kèm khách => 403 CARE_TEAM_ACTION_FORBIDDEN (giữ ở T-56)',
    async (key) => {
      const h = buildInvitees();
      await expect(listWithoutCustomer(h, key)).rejects.toMatchObject(
        REJECTS.CARE_TEAM_ACTION_FORBIDDEN,
      );
      expect(h.userModel.find).not.toHaveBeenCalled();
    },
  );
});
