import { Types } from 'mongoose';
import { UserRole } from '../../../common/enums/user-role.enum';
import { UserStatus } from '../../../common/enums/user-status.enum';
import {
  AssigneeInfo,
  CareTeamAssigneesService,
} from './care-team-assignees.service';

/**
 * FR-13: `assertAssignable` chỉ còn kiểm tồn tại/chưa xóa mềm/ACTIVE/role Manager-Staff; KHÔNG còn giới hạn theo nhóm
 * của người mời (không còn tham số người thực hiện hay cờ phạm vi).
 */
const oid = () => new Types.ObjectId();
const OTHER_TEAM = oid();

const info = (over: Partial<AssigneeInfo> = {}): AssigneeInfo => ({
  _id: oid(),
  roles: [UserRole.STAFF],
  status: UserStatus.ACTIVE,
  teamIds: [OTHER_TEAM],
  ...over,
});

const mapOf = (...items: AssigneeInfo[]) =>
  new Map(items.map((item) => [String(item._id), item]));

const build = () => new CareTeamAssigneesService({} as never);

/** `expect.objectContaining` trả `any`; ép về `Error` để `toThrow` không dính no-unsafe-argument. */
const errorLike = (fields: Record<string, unknown>): Error =>
  expect.objectContaining(fields) as Error;

describe('CareTeamAssigneesService.assertAssignable (FR-13)', () => {
  it.each([
    ['Nhân viên ACTIVE', [UserRole.STAFF]],
    ['Quản lý ACTIVE', [UserRole.MANAGER]],
    [
      'Nhân viên kèm role Biên tập (đa role)',
      [UserRole.STAFF, UserRole.EDITOR],
    ],
  ])('%s ở nhóm KHÁC nhóm người mời ⇒ hợp lệ', (_name, roles) => {
    const invitee = info({ roles, teamIds: [OTHER_TEAM] });
    expect(() =>
      build().assertAssignable([invitee._id], mapOf(invitee)),
    ).not.toThrow();
  });

  it('người mời không có nhóm nào (teamIds rỗng) vẫn hợp lệ', () => {
    const invitee = info({ teamIds: [] });
    expect(() =>
      build().assertAssignable([invitee._id], mapOf(invitee)),
    ).not.toThrow();
  });

  it.each([
    ['BLOCKED', { status: UserStatus.BLOCKED }],
    ['chỉ có role Quản trị', { roles: [UserRole.ADMIN] }],
    ['chỉ có role Biên tập', { roles: [UserRole.EDITOR] }],
    ['không có role nào', { roles: [] }],
  ])('người %s ⇒ 400 USER_NOT_ASSIGNABLE kèm userIds', (_name, over) => {
    const invalid = info(over);
    const valid = info();
    expect(() =>
      build().assertAssignable([valid._id, invalid._id], mapOf(valid, invalid)),
    ).toThrow(
      errorLike({
        errorCode: 'USER_NOT_ASSIGNABLE',
        status: 400,
        details: { userIds: [String(invalid._id)] },
      }),
    );
  });

  it('người không có trong map (không tồn tại hoặc đã xóa mềm nên `load` bỏ qua) ⇒ USER_NOT_ASSIGNABLE', () => {
    const missing = oid();
    expect(() => build().assertAssignable([missing], new Map())).toThrow(
      errorLike({
        errorCode: 'USER_NOT_ASSIGNABLE',
        details: { userIds: [String(missing)] },
      }),
    );
  });

  it('nhiều người sai: liệt kê đủ từng người, bỏ người hợp lệ', () => {
    const blocked = info({ status: UserStatus.BLOCKED });
    const adminOnly = info({ roles: [UserRole.ADMIN] });
    const ok = info();
    expect(() =>
      build().assertAssignable(
        [blocked._id, ok._id, adminOnly._id],
        mapOf(blocked, ok, adminOnly),
      ),
    ).toThrow(
      errorLike({
        details: { userIds: [String(blocked._id), String(adminOnly._id)] },
      }),
    );
  });

  it('danh sách rỗng ⇒ không lỗi', () => {
    expect(() => build().assertAssignable([], new Map())).not.toThrow();
  });
});

describe('CareTeamAssigneesService.load', () => {
  it('chỉ đọc người chưa xóa mềm, một truy vấn cho cả lô; map ra roles/status/teamIds', async () => {
    const user = {
      _id: oid(),
      role: UserRole.STAFF,
      roles: [UserRole.STAFF],
      status: UserStatus.ACTIVE,
      teamIds: [OTHER_TEAM],
    };
    const exec = jest.fn().mockResolvedValue([user]);
    const find = jest.fn().mockReturnValue({
      select: () => ({
        session: () => ({ lean: () => ({ exec }) }),
      }),
    });
    const service = new CareTeamAssigneesService({ find } as never);
    const ids = [user._id, oid()];

    const result = await service.load(ids, {} as never);

    expect(find).toHaveBeenCalledTimes(1);
    expect(find).toHaveBeenCalledWith({
      _id: { $in: ids },
      deletedAt: null,
    });
    expect([...result.keys()]).toEqual([String(user._id)]);
    expect(result.get(String(user._id))).toMatchObject({
      roles: [UserRole.STAFF],
      status: UserStatus.ACTIVE,
    });
    expect(result.get(String(user._id))?.teamIds[0].equals(OTHER_TEAM)).toBe(
      true,
    );
  });

  it('danh sách rỗng ⇒ không truy vấn DB', async () => {
    const find = jest.fn();
    const service = new CareTeamAssigneesService({ find } as never);
    expect((await service.load([], {} as never)).size).toBe(0);
    expect(find).not.toHaveBeenCalled();
  });
});
