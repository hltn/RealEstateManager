import { Types } from 'mongoose';
import { UserRole } from '../../../../common/enums/user-role.enum';
import { CrmActor, resolveVisibleTeamIds } from './crm-actor';

const id = () => new Types.ObjectId();

const buildActor = (overrides: Partial<CrmActor>): CrmActor => ({
  userId: id(),
  role: UserRole.STAFF,
  roles: [overrides.role ?? UserRole.STAFF],
  displayName: 'Tester',
  teamId: null,
  teamIds: overrides.teamId ? [overrides.teamId] : [],
  managedTeamIds: [],
  ...overrides,
});

describe('resolveVisibleTeamIds (phạm vi nhóm theo vai trò)', () => {
  it('nhiều nhóm: STAFF thấy MỌI nhóm mình thuộc; MANAGER thấy nhóm quản lý + mọi nhóm thuộc, khử trùng', () => {
    const [a, b, c] = [id(), id(), id()];
    expect(
      resolveVisibleTeamIds(
        buildActor({ role: UserRole.STAFF, teamId: a, teamIds: [a, b] }),
      )?.map(String),
    ).toEqual([String(a), String(b)]);

    expect(
      resolveVisibleTeamIds(
        buildActor({
          role: UserRole.MANAGER,
          roles: [UserRole.MANAGER, UserRole.STAFF],
          teamId: a,
          teamIds: [a, b],
          managedTeamIds: [c, b],
        }),
      )
        ?.map(String)
        .sort(),
    ).toEqual([String(a), String(b), String(c)].sort());
  });

  it('ADMIN+STAFF (role cao nhất ADMIN): không giới hạn dù có nhóm', () => {
    expect(
      resolveVisibleTeamIds(
        buildActor({
          role: UserRole.ADMIN,
          roles: [UserRole.ADMIN, UserRole.STAFF],
          teamIds: [id()],
        }),
      ),
    ).toBeNull();
  });

  it('ADMIN: không giới hạn (null)', () => {
    expect(
      resolveVisibleTeamIds(buildActor({ role: UserRole.ADMIN })),
    ).toBeNull();
  });

  it('MANAGER: nhóm mình quản lý + nhóm mình thuộc về, không trùng lặp', () => {
    const managed = id();
    const own = id();
    const actor = buildActor({
      role: UserRole.MANAGER,
      teamId: own,
      managedTeamIds: [managed, own],
    });
    const ids = resolveVisibleTeamIds(actor)!.map((item) => item.toHexString());
    expect(ids.sort()).toEqual(
      [managed.toHexString(), own.toHexString()].sort(),
    );
  });

  it('STAFF: chỉ nhóm của mình; bỏ qua managedTeamIds dư thừa (dữ liệu cũ sau khi bị hạ vai trò)', () => {
    const own = id();
    const stale = id();
    const actor = buildActor({
      role: UserRole.STAFF,
      teamId: own,
      managedTeamIds: [stale],
    });
    expect(resolveVisibleTeamIds(actor)).toEqual([own]);
  });

  it('STAFF chưa có nhóm và EDITOR: không thấy nhóm nào', () => {
    expect(resolveVisibleTeamIds(buildActor({ role: UserRole.STAFF }))).toEqual(
      [],
    );
    expect(
      resolveVisibleTeamIds(
        buildActor({ role: UserRole.EDITOR, teamId: id() }),
      ),
    ).toEqual([]);
  });
});
