import { Types } from 'mongoose';
import { UserRole } from '../../../common/enums/user-role.enum';
import { CareRole } from '../customers/customer.constants';
import { CareTeamMutation, CareTeamService } from './care-team.service';
import { planAddMembers } from './care-team.rules';

/**
 * FR-09/FR-18: response của `GET care-team` và của mutation (thêm/gỡ thành viên) phải mang `isLocked`/`role`
 * lấy từ `userStates` của `CustomerRefsService.resolve`, giống chi tiết khách.
 */
const oid = () => new Types.ObjectId();
const ACTOR = oid();
const PRIMARY = oid();
const NEW_MEMBER = oid();
const CUSTOMER = String(oid());

const userStates = new Map([
  [String(PRIMARY), { isLocked: true, role: UserRole.MANAGER }],
  [String(NEW_MEMBER), { isLocked: false, role: UserRole.STAFF }],
]);
const users = new Map([
  [String(PRIMARY), 'Chính'],
  [String(NEW_MEMBER), 'Mới'],
]);

const existingTeam = () => [
  {
    userId: PRIMARY,
    role: CareRole.PRIMARY,
    addedBy: null,
    addedAt: new Date(),
  },
];

const build = () => {
  const repo = {
    findOne: jest.fn().mockResolvedValue({
      careTeam: existingTeam(),
      teamIds: [],
      fullName: 'Anh Minh',
      __v: 1,
    }),
    updateOne: jest.fn().mockResolvedValue(true),
  };
  const refs = { resolve: jest.fn().mockResolvedValue({ users, userStates }) };
  const assignees = {
    load: jest.fn().mockResolvedValue(new Map()),
    assertAssignable: jest.fn(),
    lock: jest.fn().mockResolvedValue(undefined),
  };
  const service = new CareTeamService(
    {} as never,
    repo as never,
    {
      resolve: jest
        .fn()
        .mockResolvedValue({ scope: {}, actor: { userId: ACTOR } }),
    } as never,
    refs as never,
    assignees as never,
    { record: jest.fn().mockResolvedValue(undefined) } as never,
    { dispatch: jest.fn().mockResolvedValue({ created: 0 }) } as never,
  );
  return { service, refs };
};

describe('CareTeamService: response nhóm chăm sóc mang isLocked và role (FR-09, FR-18)', () => {
  it('GET care-team: PRIMARY bị khóa hiện isLocked=true và role', async () => {
    const { service, refs } = build();
    const response = await service.get(
      { sub: String(ACTOR) } as never,
      CUSTOMER,
    );
    // Truyền cả userStates xuống mapper (không chỉ bản đồ tên): kiểm bằng kết quả cuối.
    expect(refs.resolve).toHaveBeenCalledTimes(1);
    expect(response.members[0].user).toEqual({
      id: String(PRIMARY),
      displayName: 'Chính',
      isLocked: true,
      role: UserRole.MANAGER,
    });
    expect(response.primary?.isLocked).toBe(true);
  });

  it('mutation thêm thành viên: response mới cũng có isLocked/role của người vừa thêm', async () => {
    const { service } = build();
    const mutation: CareTeamMutation = {
      authorize: () => undefined,
      plan: (current, now) =>
        planAddMembers(current, { userIds: [NEW_MEMBER] }, ACTOR, now, {
          skipExisting: true,
          allowPrimaryChange: true,
        }),
      restrictToActorScope: true,
      source: 'WEB',
      origin: 'TEAM_ADD',
    };
    const response = await service.applyInSession(
      {
        actor: { userId: ACTOR, displayName: 'Lan' },
        scope: {},
      } as never,
      CUSTOMER,
      mutation,
      { id: 's' } as never,
    );
    const added = response.members.find(
      (item) => item.user.id === String(NEW_MEMBER),
    );
    expect(added?.user).toMatchObject({
      isLocked: false,
      role: UserRole.STAFF,
    });
    expect(
      response.members.find((item) => item.user.id === String(PRIMARY))?.user,
    ).toMatchObject({ isLocked: true, role: UserRole.MANAGER });
  });
});
