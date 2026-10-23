import { Types } from 'mongoose';
import { UserRole } from '../../../../common/enums/user-role.enum';
import { CrmActor, resolveVisibleTeamIds } from './crm-actor';

const id = () => new Types.ObjectId();

const buildActor = (overrides: Partial<CrmActor>): CrmActor => ({
  userId: id(),
  role: UserRole.STAFF,
  displayName: 'Tester',
  teamId: null,
  managedTeamIds: [],
  ...overrides,
});

describe('resolveVisibleTeamIds (phạm vi nhóm theo vai trò)', () => {
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
