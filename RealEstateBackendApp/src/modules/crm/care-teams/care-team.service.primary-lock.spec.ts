import { Types } from 'mongoose';
import { UserRole } from '../../../common/enums/user-role.enum';
import { CareRole } from '../customers/customer.constants';
import { CareTeamService } from './care-team.service';

/**
 * FR-11: khóa PRIMARY ở tầng service — gỡ PRIMARY luôn 409 `PRIMARY_LOCKED` (kể cả Admin/Manager), `POST members`
 * chỉ nhận `primaryUserId` khi nhóm rỗng và người gọi là Admin/Manager.
 */
const oid = () => new Types.ObjectId();
const ACTOR = oid();
const PRIMARY = oid();
const MEMBER = oid();
const NEW_PRIMARY = oid();
const NEW_MEMBER = oid();
const CUSTOMER = String(oid());
const JWT = { sub: String(ACTOR) } as never;

const entry = (userId: Types.ObjectId, role: CareRole) => ({
  userId,
  role,
  addedBy: ACTOR,
  addedAt: new Date(),
});

const build = (role: UserRole, userId: Types.ObjectId, careTeam: any[]) => {
  const repo = {
    findOne: jest.fn().mockResolvedValue({
      careTeam,
      teamIds: [],
      fullName: 'Anh Minh',
      __v: 1,
    }),
    updateOne: jest.fn().mockResolvedValue(true),
  };
  const session = { id: 's' };
  const connection = {
    transaction: jest.fn((work: (s: unknown) => Promise<unknown>) =>
      work(session),
    ),
  };
  const assignees = {
    load: jest.fn().mockResolvedValue(new Map()),
    assertAssignable: jest.fn(),
    lock: jest.fn().mockResolvedValue(undefined),
  };
  const service = new CareTeamService(
    connection as never,
    repo as never,
    {
      resolve: jest.fn().mockResolvedValue({
        scope: {},
        actor: { userId, role, roles: [role], displayName: 'x' },
      }),
    } as never,
    {
      resolve: jest.fn().mockResolvedValue({ users: new Map() }),
    } as never,
    assignees as never,
    { record: jest.fn().mockResolvedValue(undefined) } as never,
    { dispatch: jest.fn().mockResolvedValue({ created: 0 }) } as never,
    { consume: jest.fn().mockResolvedValue(undefined) } as never,
  );
  return { service, repo };
};

const teamWithMember = () => [
  entry(PRIMARY, CareRole.PRIMARY),
  entry(MEMBER, CareRole.MEMBER),
];

describe('CareTeamService.removeMember: PRIMARY bị khóa (FR-11)', () => {
  it.each([
    ['Quản trị', UserRole.ADMIN, ACTOR],
    ['Quản lý', UserRole.MANAGER, ACTOR],
    ['chính PRIMARY tự gỡ mình', UserRole.STAFF, PRIMARY],
  ])(
    '%s gỡ PRIMARY ⇒ 409 PRIMARY_LOCKED, không ghi DB',
    async (_n, role, userId) => {
      const { service, repo } = build(role, userId, teamWithMember());

      await expect(
        service.removeMember(JWT, CUSTOMER, String(PRIMARY)),
      ).rejects.toMatchObject({ errorCode: 'PRIMARY_LOCKED' });
      expect(repo.updateOne).not.toHaveBeenCalled();
    },
  );

  it('gỡ MEMBER vẫn được: ghi nhóm còn đúng một PRIMARY', async () => {
    const { service, repo } = build(UserRole.ADMIN, ACTOR, teamWithMember());

    const response = await service.removeMember(JWT, CUSTOMER, String(MEMBER));

    const written = repo.updateOne.mock.calls[0][3].$set;
    expect(written.careTeam.map((m: any) => String(m.userId))).toEqual([
      String(PRIMARY),
    ]);
    expect(written.primaryAssigneeId).toEqual(PRIMARY);
    expect(response.members).toHaveLength(1);
  });

  it('thành viên phụ (không phải PRIMARY) không được gỡ ai ⇒ 403 CARE_TEAM_ACTION_FORBIDDEN', async () => {
    const { service, repo } = build(UserRole.STAFF, MEMBER, teamWithMember());

    await expect(
      service.removeMember(JWT, CUSTOMER, String(PRIMARY)),
    ).rejects.toMatchObject({ errorCode: 'CARE_TEAM_ACTION_FORBIDDEN' });
    expect(repo.updateOne).not.toHaveBeenCalled();
  });
});

describe('CareTeamService.addMembers: primaryUserId chỉ khi nhóm rỗng và Admin/Manager (FR-11)', () => {
  it.each([
    ['Quản trị', UserRole.ADMIN],
    ['Quản lý', UserRole.MANAGER],
  ])(
    '%s đặt PRIMARY lần đầu cho khách cũ chưa có nhóm ⇒ thành công',
    async (_n, role) => {
      const { service, repo } = build(role, ACTOR, []);

      await service.addMembers(JWT, CUSTOMER, {
        userIds: [String(NEW_MEMBER)],
        primaryUserId: String(NEW_PRIMARY),
      });

      const written = repo.updateOne.mock.calls[0][3].$set;
      expect(
        written.careTeam.map((m: any) => [String(m.userId), m.role]),
      ).toEqual(
        expect.arrayContaining([
          [String(NEW_PRIMARY), CareRole.PRIMARY],
          [String(NEW_MEMBER), CareRole.MEMBER],
        ]),
      );
      expect(written.primaryAssigneeId).toEqual(NEW_PRIMARY);
    },
  );

  it('khách chưa có nhóm, không truyền primaryUserId ⇒ 400 PRIMARY_REQUIRED', async () => {
    const { service, repo } = build(UserRole.ADMIN, ACTOR, []);

    await expect(
      service.addMembers(JWT, CUSTOMER, {
        userIds: [String(NEW_MEMBER)],
      }),
    ).rejects.toMatchObject({ errorCode: 'PRIMARY_REQUIRED' });
    expect(repo.updateOne).not.toHaveBeenCalled();
  });

  it('Nhân viên không đặt PRIMARY cho khách chưa có nhóm ⇒ 403', async () => {
    const { service, repo } = build(UserRole.STAFF, ACTOR, []);

    await expect(
      service.addMembers(JWT, CUSTOMER, {
        userIds: [String(NEW_MEMBER)],
        primaryUserId: String(NEW_PRIMARY),
      }),
    ).rejects.toMatchObject({ errorCode: 'CARE_TEAM_ACTION_FORBIDDEN' });
    expect(repo.updateOne).not.toHaveBeenCalled();
  });

  it.each([
    ['Quản trị', UserRole.ADMIN, ACTOR],
    ['Quản lý', UserRole.MANAGER, ACTOR],
    ['Nhân viên PRIMARY', UserRole.STAFF, PRIMARY],
  ])(
    '%s truyền primaryUserId khi nhóm đã có người ⇒ 400 VALIDATION_FAILED, PRIMARY giữ nguyên',
    async (_n, role, userId) => {
      const { service, repo } = build(role, userId, teamWithMember());

      await expect(
        service.addMembers(JWT, CUSTOMER, {
          userIds: [String(NEW_MEMBER)],
          primaryUserId: String(NEW_PRIMARY),
        }),
      ).rejects.toMatchObject({ errorCode: 'VALIDATION_FAILED' });
      expect(repo.updateOne).not.toHaveBeenCalled();
    },
  );

  it('PRIMARY thêm MEMBER (không truyền primaryUserId) vẫn được', async () => {
    const { service, repo } = build(UserRole.STAFF, PRIMARY, teamWithMember());

    await service.addMembers(JWT, CUSTOMER, { userIds: [String(NEW_MEMBER)] });

    const written = repo.updateOne.mock.calls[0][3].$set;
    expect(written.careTeam).toHaveLength(3);
    expect(written.primaryAssigneeId).toEqual(PRIMARY);
  });
});
