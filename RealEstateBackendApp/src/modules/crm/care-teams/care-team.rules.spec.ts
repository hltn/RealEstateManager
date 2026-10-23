import { Types } from 'mongoose';
import { UserRole } from '../../../common/enums/user-role.enum';
import { CrmActor } from '../common/access/crm-actor';
import { CareRole } from '../customers/customer.constants';
import { CareTeamEntry } from '../customers/schemas/customer.schema';
import {
  assertCareTeamInvariant,
  canChangePrimary,
  canManageMembers,
  findPrimary,
  planAddMembers,
  planChangePrimary,
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

    it('thao tác hàng loạt: bỏ qua người đã có và cho phép đổi phụ trách chính', () => {
      const result = planAddMembers(
        team(a, b),
        { userIds: [b, c], primaryUserId: c },
        ACTOR,
        NOW,
        { skipExisting: true, allowPrimaryChange: true },
      );

      expect(result.careTeam).toHaveLength(3);
      expect(findPrimary(result.careTeam)?.userId).toEqual(c);
      expect(result.addedUserIds.map(String)).toEqual([String(c)]);
      expect(result.primaryChanged).toBe(true);
    });
  });

  describe('planRemoveMember', () => {
    it('gỡ MEMBER giữ nguyên PRIMARY; gỡ người không có trong nhóm ⇒ 404', () => {
      const result = planRemoveMember(team(a, b), b, undefined, ACTOR, NOW);
      expect(result.careTeam).toHaveLength(1);
      expect(findPrimary(result.careTeam)?.userId).toEqual(a);
      expect(result.removedUserIds).toEqual([b]);

      expect(() =>
        planRemoveMember(team(a, b), c, undefined, ACTOR, NOW),
      ).toThrow(expect.objectContaining({ errorCode: 'RESOURCE_NOT_FOUND' }));
    });

    it('gỡ PRIMARY bắt buộc người thay; người thay là MEMBER thì được nâng lên, là người mới thì được thêm', () => {
      expect(() =>
        planRemoveMember(team(a, b), a, undefined, ACTOR, NOW),
      ).toThrow(
        expect.objectContaining({ errorCode: 'PRIMARY_REPLACEMENT_REQUIRED' }),
      );
      expect(() => planRemoveMember(team(a, b), a, a, ACTOR, NOW)).toThrow(
        expect.objectContaining({ errorCode: 'VALIDATION_FAILED' }),
      );

      const promoted = planRemoveMember(team(a, b), a, b, ACTOR, NOW);
      expect(roles(promoted.careTeam)).toEqual([[String(b), CareRole.PRIMARY]]);

      const brandNew = planRemoveMember(team(a, b), a, d, ACTOR, NOW);
      expect(brandNew.careTeam).toHaveLength(2);
      expect(findPrimary(brandNew.careTeam)?.userId).toEqual(d);
      expect(brandNew.addedUserIds).toEqual([d]);
    });

    it('gỡ MEMBER mà truyền người thay ⇒ 400 (tránh đổi phụ trách chính ngầm)', () => {
      expect(() => planRemoveMember(team(a, b), b, c, ACTOR, NOW)).toThrow(
        expect.objectContaining({ errorCode: 'VALIDATION_FAILED' }),
      );
    });
  });

  describe('planChangePrimary', () => {
    it('người cũ thành MEMBER, người mới (đã là MEMBER hoặc chưa có) thành PRIMARY; đã là PRIMARY thì không đổi', () => {
      const swapped = planChangePrimary(team(a, b), b, ACTOR, NOW);
      expect(roles(swapped.careTeam)).toEqual([
        [String(a), CareRole.MEMBER],
        [String(b), CareRole.PRIMARY],
      ]);

      const added = planChangePrimary(team(a), c, ACTOR, NOW);
      expect(added.careTeam).toHaveLength(2);
      expect(added.addedUserIds).toEqual([c]);

      const same = planChangePrimary(team(a, b), a, ACTOR, NOW);
      expect(same.primaryChanged).toBe(false);
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
                ? planRemoveMember(current, user, other, ACTOR, NOW)
                : planChangePrimary(current, user, ACTOR, NOW);
        current = change.careTeam;
      } catch {
        // Thao tác bị từ chối (trùng, thiếu người thay...) thì nhóm giữ nguyên.
      }
      expect(() => assertCareTeamInvariant(current)).not.toThrow();
    }
  });

  describe('quyền', () => {
    const actorOf = (role: UserRole, userId = id()): CrmActor => ({
      userId,
      role,
      displayName: 'x',
      teamId: null,
      managedTeamIds: [],
    });

    it('thêm/gỡ thành viên: Quản trị, Quản lý, hoặc phụ trách chính; thành viên thường thì không', () => {
      const current = team(a, b);
      expect(canManageMembers(actorOf(UserRole.ADMIN), current)).toBe(true);
      expect(canManageMembers(actorOf(UserRole.MANAGER), current)).toBe(true);
      expect(canManageMembers(actorOf(UserRole.STAFF, a), current)).toBe(true);
      expect(canManageMembers(actorOf(UserRole.STAFF, b), current)).toBe(false);
    });

    it('đổi phụ trách chính: chỉ Quản trị và Quản lý', () => {
      expect(canChangePrimary(actorOf(UserRole.MANAGER))).toBe(true);
      expect(canChangePrimary(actorOf(UserRole.STAFF, a))).toBe(false);
    });
  });
});
