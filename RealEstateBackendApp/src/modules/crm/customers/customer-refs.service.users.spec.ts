import { Types } from 'mongoose';
import { UserRole } from '../../../common/enums/user-role.enum';
import { UserStatus } from '../../../common/enums/user-status.enum';
import { CustomerRefsService, toUserRef } from './customer-refs.service';

/** Query giả của Mongoose: mọi bước chuỗi trả lại chính nó, `exec` trả kết quả. */
const query = <T>(result: T) => {
  const q: Record<string, jest.Mock> = {};
  for (const step of ['select', 'session', 'lean']) {
    q[step] = jest.fn().mockReturnValue(q);
  }
  q.exec = jest.fn().mockResolvedValue(result);
  return q;
};

const active = {
  _id: new Types.ObjectId(),
  displayName: 'Hạnh',
  status: UserStatus.ACTIVE,
  role: UserRole.MANAGER,
  roles: [UserRole.STAFF, UserRole.MANAGER],
};
const blocked = {
  _id: new Types.ObjectId(),
  displayName: 'Nghỉ việc',
  status: UserStatus.BLOCKED,
  role: UserRole.STAFF,
  roles: [UserRole.STAFF],
};
const legacy = {
  _id: new Types.ObjectId(),
  displayName: 'Tài khoản cũ',
  role: UserRole.ADMIN,
};

const build = () => {
  const userModel = { find: jest.fn(() => query([active, blocked, legacy])) };
  const empty = { find: jest.fn(() => query([])) };
  const service = new CustomerRefsService(
    {} as never,
    empty as never,
    empty as never,
    empty as never,
    empty as never,
    userModel as never,
    empty as never,
  );
  return { service, userModel };
};

describe('FR-18: CustomerRefsService.resolve trả trạng thái khóa và role của người dùng', () => {
  it('đọc status/role/roles trong cùng MỘT truy vấn người dùng (không N+1) và không đọc password', async () => {
    const { service, userModel } = build();
    const q = query([active, blocked, legacy]);
    userModel.find.mockReturnValue(q);

    await service.resolve({ userIds: [active._id, blocked._id, active._id] });

    expect(userModel.find).toHaveBeenCalledTimes(1);
    expect(q.select).toHaveBeenCalledWith('displayName status role roles');
  });

  it('isLocked chỉ true với BLOCKED; tài khoản cũ không có status coi như chưa khóa', async () => {
    const { service } = build();
    const maps = await service.resolve({
      userIds: [active._id, blocked._id, legacy._id],
    });

    expect(maps.userStates?.get(String(active._id))?.isLocked).toBe(false);
    expect(maps.userStates?.get(String(blocked._id))?.isLocked).toBe(true);
    expect(maps.userStates?.get(String(legacy._id))?.isLocked).toBe(false);
  });

  it('role là role cao nhất trong roles (MANAGER > STAFF); tài khoản cũ rơi về role đơn', async () => {
    const { service } = build();
    const maps = await service.resolve({
      userIds: [active._id, blocked._id, legacy._id],
    });

    expect(maps.userStates?.get(String(active._id))?.role).toBe(
      UserRole.MANAGER,
    );
    expect(maps.userStates?.get(String(blocked._id))?.role).toBe(
      UserRole.STAFF,
    );
    expect(maps.userStates?.get(String(legacy._id))?.role).toBe(UserRole.ADMIN);
  });

  it('không có userIds thì không truy vấn người dùng và userStates rỗng', async () => {
    const { service, userModel } = build();
    const maps = await service.resolve({});
    expect(userModel.find).not.toHaveBeenCalled();
    expect(maps.userStates?.size).toBe(0);
  });
});

describe('FR-18: toUserRef gắn isLocked tùy chọn', () => {
  const id = new Types.ObjectId();
  const users = new Map([[String(id), 'Hạnh']]);

  it('không truyền states thì giữ nguyên hợp đồng cũ (chỉ id + displayName)', () => {
    expect(toUserRef(id, users)).toEqual({
      id: String(id),
      displayName: 'Hạnh',
    });
  });

  it('có states thì gắn isLocked đúng giá trị', () => {
    const states = new Map([[String(id), { isLocked: true, role: null }]]);
    expect(toUserRef(id, users, states)).toEqual({
      id: String(id),
      displayName: 'Hạnh',
      isLocked: true,
    });
  });

  it('người không có trong states thì không gắn isLocked; id null trả null', () => {
    expect(toUserRef(id, users, new Map())).not.toHaveProperty('isLocked');
    expect(toUserRef(null, users, new Map())).toBeNull();
    expect(toUserRef(undefined, users)).toBeNull();
  });
});
