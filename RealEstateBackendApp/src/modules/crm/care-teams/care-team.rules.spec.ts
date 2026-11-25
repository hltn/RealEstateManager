import { Types } from 'mongoose';
import { UserRole } from '../../../common/enums/user-role.enum';
import { CrmActor } from '../common/access/crm-actor';
import { CareRole } from '../customers/customer.constants';
import { CareTeamEntry } from '../customers/schemas/customer.schema';
import {
  assertCareTeamInvariant,
  buildBulkPushGroupKey,
  assertCreatorKept,
  canSetInitialPrimary,
  findPrimary,
  MAX_PUSH_GROUP_REQUEST_ID_LENGTH,
  planAddMembers,
  planRemoveMember,
} from './care-team.rules';

const id = () => new Types.ObjectId();
const NOW = new Date('2026-10-23T08:00:00Z');
const ACTOR = id();

const team = (primary: Types.ObjectId, ...members: Types.ObjectId[]) =>
  [
    { userId: primary, role: CareRole.PRIMARY },
    ...members.map((userId) => ({ userId, role: CareRole.MEMBER })),
  ].map((member) => ({
    ...member,
    addedBy: ACTOR,
    addedAt: NOW,
  })) as CareTeamEntry[];

const roles = (careTeam: CareTeamEntry[]) =>
  careTeam.map((member) => [String(member.userId), member.role]);

describe('care-team.rules', () => {
  const [a, b, c, d] = [id(), id(), id(), id()];

  describe('planAddMembers', () => {
    it('nhóm rỗng: bắt buộc phụ trách chính, người đó tự được thêm', () => {
      expect(() => planAddMembers([], { userIds: [a] }, ACTOR, NOW)).toThrow(
        expect.objectContaining({ errorCode: 'PRIMARY_REQUIRED' }),
      );

      const result = planAddMembers(
        [],
        { userIds: [a], primaryUserId: b },
        ACTOR,
        NOW,
      );
      expect(roles(result.careTeam)).toEqual(
        expect.arrayContaining([
          [String(a), CareRole.MEMBER],
          [String(b), CareRole.PRIMARY],
        ]),
      );
      expect(result.careTeam).toHaveLength(2);
      expect(result.primaryChanged).toBe(true);
    });

    it('nhóm đã có người: thêm MEMBER, trùng người ⇒ 409, gửi primaryUserId ⇒ 400', () => {
      const current = team(a);

      const result = planAddMembers(current, { userIds: [b, c] }, ACTOR, NOW);
      expect(result.careTeam).toHaveLength(3);
      expect(findPrimary(result.careTeam)?.userId).toEqual(a);
      expect(result.addedUserIds.map(String)).toEqual([String(b), String(c)]);

      expect(() =>
        planAddMembers(current, { userIds: [a, b] }, ACTOR, NOW),
      ).toThrow(
        expect.objectContaining({
          errorCode: 'ALREADY_IN_CARE_TEAM',
          details: { userIds: [String(a)] },
        }),
      );
      expect(() =>
        planAddMembers(current, { userIds: [b], primaryUserId: b }, ACTOR, NOW),
      ).toThrow(expect.objectContaining({ errorCode: 'VALIDATION_FAILED' }));
    });

    it('FR-11: skipExisting bỏ qua người đã có nhưng vẫn không đổi PRIMARY; gửi primaryUserId vào nhóm đã có người ⇒ 400 dù skipExisting', () => {
      const result = planAddMembers(
        team(a, b),
        { userIds: [b, c] },
        ACTOR,
        NOW,
        { skipExisting: true },
      );
      expect(result.careTeam).toHaveLength(3);
      expect(findPrimary(result.careTeam)?.userId).toEqual(a);
      expect(result.addedUserIds.map(String)).toEqual([String(c)]);
      expect(result.primaryChanged).toBe(false);

      expect(() =>
        planAddMembers(
          team(a, b),
          { userIds: [c], primaryUserId: c },
          ACTOR,
          NOW,
          { skipExisting: true },
        ),
      ).toThrow(expect.objectContaining({ errorCode: 'VALIDATION_FAILED' }));
    });

    it('FR-11: primaryUserId bằng chính PRIMARY hiện tại hoặc một MEMBER cũng bị từ chối, nhóm không đổi', () => {
      const current = team(a, b);
      for (const primaryUserId of [a, b]) {
        expect(() =>
          planAddMembers(current, { userIds: [c], primaryUserId }, ACTOR, NOW),
        ).toThrow(expect.objectContaining({ errorCode: 'VALIDATION_FAILED' }));
      }
      expect(roles(current)).toEqual([
        [String(a), CareRole.PRIMARY],
        [String(b), CareRole.MEMBER],
      ]);
    });
  });

  describe('planRemoveMember', () => {
    it('gỡ MEMBER giữ nguyên PRIMARY; gỡ người không có trong nhóm ⇒ 404', () => {
      const result = planRemoveMember(team(a, b), b, null);
      expect(result.careTeam).toHaveLength(1);
      expect(findPrimary(result.careTeam)?.userId).toEqual(a);
      expect(result.removedUserIds).toEqual([b]);
      expect(result.primaryChanged).toBe(false);

      expect(() => planRemoveMember(team(a, b), c, null)).toThrow(
        expect.objectContaining({
          errorCode: 'RESOURCE_NOT_FOUND',
          status: 404,
        }),
      );
    });

    it('FR-11: gỡ PRIMARY ⇒ 409 PRIMARY_LOCKED dù nhóm chỉ có một mình PRIMARY hay còn thành viên phụ', () => {
      for (const current of [team(a), team(a, b, c)]) {
        expect(() => planRemoveMember(current, a, null)).toThrow(
          expect.objectContaining({ errorCode: 'PRIMARY_LOCKED', status: 409 }),
        );
      }
    });

    it('FR-11: gỡ PRIMARY bị chặn không làm đổi nhóm đầu vào (không đột biến)', () => {
      const current = team(a, b);
      const snapshot = roles(current);
      expect(() => planRemoveMember(current, a, null)).toThrow();
      expect(roles(current)).toEqual(snapshot);
    });

    it('FR-11: gỡ lần lượt mọi MEMBER vẫn được, PRIMARY còn lại đúng một và bất biến giữ', () => {
      let current = team(a, b, c, d);
      for (const user of [b, c, d]) {
        current = planRemoveMember(current, user, null).careTeam;
        expect(() => assertCareTeamInvariant(current)).not.toThrow();
      }
      expect(roles(current)).toEqual([[String(a), CareRole.PRIMARY]]);
    });

    describe('FR-31: người tạo không bao giờ bị gỡ (createdBy)', () => {
      const creatorAsMember = () => team(a, b, c);
      const creatorAsPrimary = () => team(a, b);

      it('gỡ người tạo là MEMBER (khách cũ) => 409 PRIMARY_LOCKED kèm details.reason = CREATOR_LOCKED', () => {
        expect(() => planRemoveMember(creatorAsMember(), b, b)).toThrow(
          expect.objectContaining({
            errorCode: 'PRIMARY_LOCKED',
            status: 409,
            details: { reason: 'CREATOR_LOCKED' },
          }),
        );
      });

      it('gỡ người tạo là PRIMARY (khách mới) => cùng lỗi, cùng reason CREATOR_LOCKED (kiểm người tạo TRƯỚC nhánh PRIMARY)', () => {
        expect(() => planRemoveMember(creatorAsPrimary(), a, a)).toThrow(
          expect.objectContaining({
            errorCode: 'PRIMARY_LOCKED',
            status: 409,
            details: { reason: 'CREATOR_LOCKED' },
          }),
        );
      });

      it('gỡ PRIMARY KHÔNG phải người tạo giữ PRIMARY_LOCKED KHÔNG có reason', () => {
        let thrown: unknown;
        try {
          planRemoveMember(creatorAsPrimary(), a, d);
        } catch (error) {
          thrown = error;
        }
        expect(thrown).toMatchObject({
          errorCode: 'PRIMARY_LOCKED',
          status: 409,
        });
        expect((thrown as { details?: unknown }).details).toBeUndefined();
      });

      it('gỡ MEMBER không phải người tạo vẫn được; người tạo không có trong nhóm => 404 (không có gì để gỡ)', () => {
        const result = planRemoveMember(creatorAsMember(), c, b);
        expect(result.removedUserIds).toEqual([c]);
        expect(() => planRemoveMember(creatorAsMember(), d, d)).toThrow(
          expect.objectContaining({
            errorCode: 'RESOURCE_NOT_FOUND',
            status: 404,
          }),
        );
      });

      it('khách thiếu createdBy (null/undefined): không ai được coi là người tạo, MEMBER gỡ được', () => {
        for (const createdBy of [null, undefined]) {
          expect(
            planRemoveMember(creatorAsMember(), b, createdBy).removedUserIds,
          ).toEqual([b]);
        }
      });

      it('gỡ người tạo bị chặn không làm đổi nhóm đầu vào', () => {
        const current = creatorAsMember();
        const snapshot = roles(current);
        expect(() => planRemoveMember(current, b, b)).toThrow();
        expect(roles(current)).toEqual(snapshot);
      });
    });
  });

  describe('assertCreatorKept (FR-31: backstop mọi đường đổi careTeam)', () => {
    const creatorLocked = expect.objectContaining({
      errorCode: 'PRIMARY_LOCKED',
      status: 409,
      details: { reason: 'CREATOR_LOCKED' },
    });

    it('người tạo (MEMBER hoặc PRIMARY) có trước mà không còn sau (gỡ) => 409 CREATOR_LOCKED', () => {
      expect(() => assertCreatorKept(team(a, b), team(a), b)).toThrow(
        creatorLocked,
      );
      expect(() => assertCreatorKept(team(a, b), team(b), a)).toThrow(
        creatorLocked,
      );
    });

    it('thay PRIMARY bằng người khác làm mất người tạo => 409 CREATOR_LOCKED (mức hàm thuần, hiện không có đường đổi PRIMARY)', () => {
      expect(() => assertCreatorKept(team(a, b), team(c, b), a)).toThrow(
        creatorLocked,
      );
    });

    it('thay cả nhóm => 409 CREATOR_LOCKED; nhóm mới rỗng cũng vậy', () => {
      expect(() => assertCreatorKept(team(a, b), team(c, d), b)).toThrow(
        creatorLocked,
      );
      expect(() => assertCreatorKept(team(a, b), [], a)).toThrow(creatorLocked);
    });

    it('người tạo vẫn còn sau (kể cả đổi vai trò hay thêm người) => không ném', () => {
      expect(() =>
        assertCreatorKept(team(a, b), team(a, b, c), b),
      ).not.toThrow();
      expect(() => assertCreatorKept(team(a, b), team(b, a), b)).not.toThrow();
    });

    it('người tạo KHÔNG có trong nhóm trước (khách cũ) => không có gì để mất, không ném dù nhóm sau thế nào', () => {
      expect(() => assertCreatorKept(team(a, b), team(a), c)).not.toThrow();
      expect(() => assertCreatorKept([], team(a), c)).not.toThrow();
    });

    it('khách thiếu createdBy (null/undefined) => không ném', () => {
      expect(() => assertCreatorKept(team(a, b), team(a), null)).not.toThrow();
      expect(() =>
        assertCreatorKept(team(a, b), team(a), undefined),
      ).not.toThrow();
    });
  });

  it('bất biến đúng 1 PRIMARY giữ vững qua chuỗi thao tác ngẫu nhiên', () => {
    const pool = Array.from({ length: 6 }, id);
    let seed = 20261023;
    const random = (max: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % max;
    };
    let current: CareTeamEntry[] = [];

    for (let step = 0; step < 400; step += 1) {
      const user = pool[random(pool.length)];
      const other = pool[random(pool.length)];
      try {
        const operation = random(3);
        const change =
          current.length === 0
            ? planAddMembers(
                current,
                { userIds: [user], primaryUserId: other },
                ACTOR,
                NOW,
              )
            : operation === 0
              ? planAddMembers(current, { userIds: [user] }, ACTOR, NOW)
              : operation === 1
                ? planRemoveMember(current, user, null)
                : planAddMembers(
                    current,
                    { userIds: [user], primaryUserId: other },
                    ACTOR,
                    NOW,
                    { skipExisting: true },
                  );
        // PRIMARY đã đặt thì không bao giờ đổi bởi bất kỳ thao tác nào (FR-11).
        if (current.length > 0) {
          expect(findPrimary(change.careTeam)?.userId).toEqual(
            findPrimary(current)?.userId,
          );
        }
        current = change.careTeam;
      } catch {
        // Thao tác bị từ chối (trùng, gỡ PRIMARY, đặt PRIMARY khi đã có...) thì nhóm giữ nguyên.
      }
      expect(() => assertCareTeamInvariant(current)).not.toThrow();
    }
  });

  describe('quyền', () => {
    const actorOf = (role: UserRole, userId = id()): CrmActor => ({
      userId,
      role,
      roles: [role],
      displayName: 'x',
      teamId: null,
      teamIds: [],
      managedTeamIds: [],
    });

    it('FR-11: đặt PRIMARY lần đầu chỉ Quản trị/Quản lý và chỉ khi nhóm rỗng; Staff (kể cả PRIMARY) và nhóm đã có người thì không', () => {
      expect(canSetInitialPrimary(actorOf(UserRole.ADMIN), [])).toBe(true);
      expect(canSetInitialPrimary(actorOf(UserRole.MANAGER), [])).toBe(true);
      expect(canSetInitialPrimary(actorOf(UserRole.STAFF, a), [])).toBe(false);
      // PRIMARY đã khóa: Admin/Manager cũng không đặt lại được.
      expect(canSetInitialPrimary(actorOf(UserRole.ADMIN), team(a))).toBe(
        false,
      );
      expect(canSetInitialPrimary(actorOf(UserRole.MANAGER), team(a, b))).toBe(
        false,
      );
      expect(canSetInitialPrimary(actorOf(UserRole.STAFF, a), team(a))).toBe(
        false,
      );
    });
  });
});

describe('buildBulkPushGroupKey (T-33)', () => {
  it('ghép BULK:{requestId}', () => {
    expect(buildBulkPushGroupKey('req-1')).toBe('BULK:req-1');
  });

  it('thiếu hoặc rỗng (ngoài ngữ cảnh HTTP): undefined', () => {
    expect(buildBulkPushGroupKey(undefined)).toBeUndefined();
    expect(buildBulkPushGroupKey('')).toBeUndefined();
  });

  it('requestId đúng 128 ký tự giữ nguyên, 129 ký tự bị cắt còn 128', () => {
    expect(MAX_PUSH_GROUP_REQUEST_ID_LENGTH).toBe(128);
    expect(buildBulkPushGroupKey('a'.repeat(128))).toBe(
      `BULK:${'a'.repeat(128)}`,
    );
    expect(buildBulkPushGroupKey('a'.repeat(129))).toBe(
      `BULK:${'a'.repeat(128)}`,
    );
  });
});
