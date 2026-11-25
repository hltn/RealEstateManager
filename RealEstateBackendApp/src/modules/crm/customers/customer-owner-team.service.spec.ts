import { Types } from 'mongoose';
import { UserRole } from '../../../common/enums/user-role.enum';
import { UserStatus } from '../../../common/enums/user-status.enum';
import { CrmActor } from '../common/access/crm-actor';
import { CustomerOwnerTeamService } from './customer-owner-team.service';

const id = () => new Types.ObjectId();

interface FakeUser {
  _id: Types.ObjectId;
  displayName: string;
  roles: UserRole[];
  status: UserStatus;
  deletedAt: Date | null;
  teamId: Types.ObjectId | null;
  teamIds: Types.ObjectId[];
}

interface FakeTeam {
  _id: Types.ObjectId;
  managerIds: Types.ObjectId[];
  deletedAt: Date | null;
}

const user = (over: Partial<FakeUser> & { displayName: string }): FakeUser => ({
  _id: id(),
  roles: [UserRole.STAFF],
  status: UserStatus.ACTIVE,
  deletedAt: null,
  teamId: null,
  teamIds: [],
  ...over,
});

/**
 * Áp `.select('a b')` như Mongo: chỉ giữ `_id` và các trường được chọn, nên service quên chọn `displayName` (hoặc đọc
 * nhầm `fullName`, trường KHÔNG có trong schema User) thì tên ra rỗng và test đỏ.
 */
const project = <T extends object>(row: T, fields: string | null): T => {
  if (fields === null) return row;
  const keep = new Set(['_id', ...fields.split(' ')]);
  return Object.fromEntries(
    Object.entries(row).filter(([key]) => keep.has(key)),
  ) as T;
};

/** Model giả chỉ đủ cho chuỗi `.select().session().lean().exec()`; lọc theo `_id`, `deletedAt`, `status`, `roles`. */
const build = (users: FakeUser[], teams: FakeTeam[]) => {
  const chain = <T extends object>(result: T[] | T | null) => {
    let fields: string | null = null;
    const api = {
      select: jest.fn((selected: string) => {
        fields = selected;
        return api;
      }),
      session: jest.fn().mockReturnThis(),
      lean: jest.fn().mockReturnThis(),
      exec: jest.fn(() =>
        Promise.resolve(
          Array.isArray(result)
            ? result.map((row) => project(row, fields))
            : result && project(result, fields),
        ),
      ),
    };
    return api;
  };
  const userFind = jest.fn((filter: Record<string, unknown>) => {
    const ids = (filter._id as { $in: Types.ObjectId[] }).$in.map(String);
    return chain(
      users.filter(
        (u) =>
          ids.includes(String(u._id)) &&
          u.status === filter.status &&
          u.deletedAt === null &&
          u.roles.includes(filter.roles as UserRole),
      ),
    );
  });
  const userFindOne = jest.fn((filter: { _id: Types.ObjectId }) =>
    chain(users.find((u) => u._id.equals(filter._id)) ?? null),
  );
  const teamFind = jest.fn((filter: { _id: { $in: Types.ObjectId[] } }) =>
    chain(
      teams.filter(
        (t) =>
          filter._id.$in.some((x) => x.equals(t._id)) && t.deletedAt === null,
      ),
    ),
  );
  const service = new CustomerOwnerTeamService(
    { find: userFind, findOne: userFindOne } as never,
    { find: teamFind } as never,
  );
  return { service, userFind, userFindOne, teamFind };
};

describe('CustomerOwnerTeamService (FR-30)', () => {
  describe('loadCandidates: MỘT hàm dựng ứng viên', () => {
    it('FR-30: đọc người tạo bằng MỘT truy vấn users với select đủ displayName roles status deletedAt, rồi managerIds nhóm chủ', async () => {
      const team: FakeTeam = {
        _id: id(),
        managerIds: [id(), id()],
        deletedAt: null,
      };
      const creator = user({
        displayName: 'Tạo',
        teamId: team._id,
        teamIds: [team._id],
      });
      const { service, userFindOne, teamFind } = build([creator], [team]);

      const result = await service.loadCandidates({
        createdBy: creator._id,
        teamIds: [id()],
      });

      expect(userFindOne).toHaveBeenCalledTimes(1);
      const select = userFindOne.mock.results[0].value.select as jest.Mock;
      expect(select).toHaveBeenCalledWith(
        'teamId teamIds displayName roles status deletedAt',
      );
      expect(teamFind).toHaveBeenCalledTimes(1);
      expect(result.ownerTeamIds).toEqual([team._id]);
      expect(result.managerIds.map(String)).toEqual(
        team.managerIds.map(String),
      );
      expect(result.creator?._id).toEqual(creator._id);
    });

    it('FR-30: người tạo là Admin thuần (không nhóm) thì không đọc teams và không có Manager nhóm chủ', async () => {
      const admin = user({ displayName: 'Admin', roles: [UserRole.ADMIN] });
      const { service, teamFind } = build([admin], []);
      const result = await service.loadCandidates({
        createdBy: admin._id,
        teamIds: [id()],
      });
      expect(teamFind).not.toHaveBeenCalled();
      expect(result.managerIds).toEqual([]);
    });

    it('FR-30: khách cũ thiếu createdBy dự phòng customer.teamIds, không đọc users', async () => {
      const team: FakeTeam = { _id: id(), managerIds: [id()], deletedAt: null };
      const { service, userFindOne } = build([], [team]);
      const result = await service.loadCandidates({
        createdBy: null,
        teamIds: [team._id],
      });
      expect(userFindOne).not.toHaveBeenCalled();
      expect(result.creator).toBeNull();
      expect(result.managerIds).toEqual(team.managerIds);
    });

    it('FR-30: có createdBy nhưng không tìm thấy user thì dự phòng customer.teamIds', async () => {
      const team: FakeTeam = { _id: id(), managerIds: [id()], deletedAt: null };
      const { service } = build([], [team]);
      const result = await service.loadCandidates({
        createdBy: id(),
        teamIds: [team._id],
      });
      expect(result.creator).toBeNull();
      expect(result.managerIds).toEqual(team.managerIds);
    });

    it('FR-30: nhóm đã xóa mềm không tính', async () => {
      const team: FakeTeam = {
        _id: id(),
        managerIds: [id()],
        deletedAt: new Date(),
      };
      const creator = user({
        displayName: 'Tạo',
        teamId: team._id,
        teamIds: [team._id],
      });
      const { service } = build([creator], [team]);
      const result = await service.loadCandidates({ createdBy: creator._id });
      expect(result.managerIds).toEqual([]);
    });

    it('FR-30: truyền session xuống cả hai truy vấn (đọc trong transaction của bên gọi)', async () => {
      const team: FakeTeam = { _id: id(), managerIds: [id()], deletedAt: null };
      const creator = user({
        displayName: 'Tạo',
        teamId: team._id,
        teamIds: [team._id],
      });
      const { service, userFindOne, teamFind } = build([creator], [team]);
      const session = { id: 'session' } as never;
      await service.loadCandidates({ createdBy: creator._id }, session);
      expect(userFindOne.mock.results[0].value.session).toHaveBeenCalledWith(
        session,
      );
      expect(teamFind.mock.results[0].value.session).toHaveBeenCalledWith(
        session,
      );
    });
  });

  describe('hasOwnerRights (FR-31): Admin, người tạo, Manager nhóm chủ', () => {
    const actorOf = (role: UserRole, userId = id()): CrmActor => ({
      userId,
      role,
      roles: [role],
      displayName: 'x',
      teamId: null,
      teamIds: [],
      managedTeamIds: [],
    });

    it('FR-31: Admin và người tạo được ngay, KHÔNG đọc DB', async () => {
      const { service, userFindOne, teamFind } = build([], []);
      const admin = actorOf(UserRole.ADMIN);
      const staffCreator = actorOf(UserRole.STAFF);
      expect(await service.hasOwnerRights(admin, { createdBy: id() })).toBe(
        true,
      );
      expect(
        await service.hasOwnerRights(staffCreator, {
          createdBy: staffCreator.userId,
        }),
      ).toBe(true);
      expect(userFindOne).not.toHaveBeenCalled();
      expect(teamFind).not.toHaveBeenCalled();
    });

    it('FR-31: Staff không phải người tạo bị từ chối, KHÔNG đọc DB', async () => {
      const { service, userFindOne, teamFind } = build([], []);
      const staff = actorOf(UserRole.STAFF);
      expect(await service.hasOwnerRights(staff, { createdBy: id() })).toBe(
        false,
      );
      expect(userFindOne).not.toHaveBeenCalled();
      expect(teamFind).not.toHaveBeenCalled();
    });

    it('FR-31: Manager của nhóm chủ (nhóm của người tạo) được, dù chưa trong careTeam', async () => {
      const manager = actorOf(UserRole.MANAGER);
      const team: FakeTeam = {
        _id: id(),
        managerIds: [manager.userId],
        deletedAt: null,
      };
      const creator = user({
        displayName: 'Tạo',
        teamId: team._id,
        teamIds: [team._id],
      });
      const { service } = build([creator], [team]);
      expect(
        await service.hasOwnerRights(manager, { createdBy: creator._id }),
      ).toBe(true);
    });

    it('FR-31: Manager của nhóm KHÁC (không phải nhóm của người tạo) bị từ chối dù khách có teamIds của nhóm mình', async () => {
      const manager = actorOf(UserRole.MANAGER);
      const ownerTeam: FakeTeam = {
        _id: id(),
        managerIds: [id()],
        deletedAt: null,
      };
      const otherTeam: FakeTeam = {
        _id: id(),
        managerIds: [manager.userId],
        deletedAt: null,
      };
      const creator = user({
        displayName: 'Tạo',
        teamId: ownerTeam._id,
        teamIds: [ownerTeam._id],
      });
      const { service } = build([creator], [ownerTeam, otherTeam]);
      expect(
        await service.hasOwnerRights(manager, {
          createdBy: creator._id,
          teamIds: [ownerTeam._id, otherTeam._id],
        }),
      ).toBe(false);
    });

    it('FR-31: nhóm chủ đã xóa mềm không tính; người tạo không nhóm thì không có Manager nhóm chủ', async () => {
      const manager = actorOf(UserRole.MANAGER);
      const deletedTeam: FakeTeam = {
        _id: id(),
        managerIds: [manager.userId],
        deletedAt: new Date(),
      };
      const creatorInDeleted = user({
        displayName: 'Tạo',
        teamId: deletedTeam._id,
        teamIds: [deletedTeam._id],
      });
      const adminCreator = user({
        displayName: 'Admin',
        roles: [UserRole.ADMIN],
      });
      const { service } = build(
        [creatorInDeleted, adminCreator],
        [deletedTeam],
      );
      expect(
        await service.hasOwnerRights(manager, {
          createdBy: creatorInDeleted._id,
        }),
      ).toBe(false);
      expect(
        await service.hasOwnerRights(manager, {
          createdBy: adminCreator._id,
          teamIds: [deletedTeam._id],
        }),
      ).toBe(false);
    });

    it('FR-31: truyền session xuống truy vấn (đọc trong transaction của bên gọi)', async () => {
      const manager = actorOf(UserRole.MANAGER);
      const team: FakeTeam = {
        _id: id(),
        managerIds: [manager.userId],
        deletedAt: null,
      };
      const creator = user({
        displayName: 'Tạo',
        teamId: team._id,
        teamIds: [team._id],
      });
      const { service, userFindOne } = build([creator], [team]);
      const session = { id: 'session' } as never;
      await service.hasOwnerRights(
        manager,
        { createdBy: creator._id },
        session,
      );
      expect(userFindOne.mock.results[0].value.session).toHaveBeenCalledWith(
        session,
      );
    });
  });

  describe('buildOwnerRefs: ownerManagers và creator của chi tiết khách', () => {
    const setup = () => {
      const team: FakeTeam = { _id: id(), managerIds: [], deletedAt: null };
      const mk = (over: Partial<FakeUser> & { displayName: string }) =>
        user({ teamId: team._id, teamIds: [team._id], ...over });
      return { team, mk };
    };

    it('FR-30: ownerManagers đúng định dạng, sắp theo tên hiển thị, không trùng thành viên careTeam', async () => {
      const { team, mk } = setup();
      const creator = mk({ displayName: 'Người tạo', roles: [UserRole.STAFF] });
      const mB = mk({ displayName: 'Bình', roles: [UserRole.MANAGER] });
      const mA = mk({ displayName: 'An', roles: [UserRole.MANAGER] });
      const mInTeam = mk({
        displayName: 'Có trong nhóm',
        roles: [UserRole.MANAGER],
      });
      team.managerIds = [mB._id, mA._id, mInTeam._id];
      // Thứ tự nạp cố ý đảo (Bình trước An) để bỏ bước sắp là test đỏ.
      const { service } = build([creator, mB, mA, mInTeam], [team]);

      const result = await service.buildOwnerRefs({
        createdBy: creator._id,
        careTeam: [{ userId: mInTeam._id }],
      });

      expect(result.ownerManagers).toEqual([
        { userId: String(mA._id), fullName: 'An', role: UserRole.MANAGER },
        { userId: String(mB._id), fullName: 'Bình', role: UserRole.MANAGER },
      ]);
    });

    it('FR-30: ownerManagers loại Manager bị khóa, đã xóa mềm hoặc không còn vai trò MANAGER', async () => {
      const { team, mk } = setup();
      const creator = mk({ displayName: 'Tạo' });
      const ok = mk({ displayName: 'Ổn', roles: [UserRole.MANAGER] });
      const blocked = mk({
        displayName: 'Khóa',
        roles: [UserRole.MANAGER],
        status: UserStatus.BLOCKED,
      });
      const deleted = mk({
        displayName: 'Xóa',
        roles: [UserRole.MANAGER],
        deletedAt: new Date(),
      });
      const demoted = mk({ displayName: 'Hạ cấp', roles: [UserRole.STAFF] });
      team.managerIds = [ok._id, blocked._id, deleted._id, demoted._id];
      const { service } = build(
        [creator, ok, blocked, deleted, demoted],
        [team],
      );
      const result = await service.buildOwnerRefs({ createdBy: creator._id });
      expect(result.ownerManagers.map((m) => m.fullName)).toEqual(['Ổn']);
    });

    it('FR-30: ownerManagers gồm người tạo nếu là Manager (kể cả khi không nằm trong managerIds), và creator là null (đã ở ownerManagers)', async () => {
      const { team, mk } = setup();
      const creator = mk({
        displayName: 'Quản lý tạo',
        roles: [UserRole.MANAGER],
      });
      const { service } = build([creator], [team]);
      const result = await service.buildOwnerRefs({ createdBy: creator._id });
      expect(result.ownerManagers).toEqual([
        {
          userId: String(creator._id),
          fullName: 'Quản lý tạo',
          role: UserRole.MANAGER,
        },
      ]);
      expect(result.creator).toBeNull();
    });

    it('FR-30: creator khác null cho người tạo Admin hoặc Staff ngoài careTeam và ACTIVE, role = vai trò cao nhất', async () => {
      const { team, mk } = setup();
      const admin = mk({
        displayName: 'Admin tạo',
        roles: [UserRole.STAFF, UserRole.ADMIN],
      });
      const staff = mk({ displayName: 'Staff tạo', roles: [UserRole.STAFF] });
      const { service } = build([admin, staff], [team]);

      const forAdmin = await service.buildOwnerRefs({ createdBy: admin._id });
      expect(forAdmin.creator).toEqual({
        userId: String(admin._id),
        fullName: 'Admin tạo',
        role: UserRole.ADMIN,
      });
      const forStaff = await service.buildOwnerRefs({ createdBy: staff._id });
      expect(forStaff.creator).toEqual({
        userId: String(staff._id),
        fullName: 'Staff tạo',
        role: UserRole.STAFF,
      });
    });

    it('FR-30: creator = null khi người tạo đã trong careTeam', async () => {
      const { team, mk } = setup();
      const staff = mk({ displayName: 'Staff tạo' });
      const { service } = build([staff], [team]);
      const result = await service.buildOwnerRefs({
        createdBy: staff._id,
        careTeam: [{ userId: staff._id }],
      });
      expect(result.creator).toBeNull();
    });

    it.each([
      ['bị khóa', { status: UserStatus.BLOCKED }],
      ['đã xóa mềm', { deletedAt: new Date() }],
      ['chỉ EDITOR (không có vai trò CRM)', { roles: [UserRole.EDITOR] }],
    ])('FR-30: creator = null khi người tạo %s', async (_label, over) => {
      const { team, mk } = setup();
      const creator = mk({ displayName: 'Tạo', ...over });
      const { service } = build([creator], [team]);
      const result = await service.buildOwnerRefs({ createdBy: creator._id });
      expect(result.creator).toBeNull();
    });

    it('FR-30: creator = null và ownerManagers theo teamIds khi khách cũ thiếu createdBy', async () => {
      const { team, mk } = setup();
      const manager = mk({ displayName: 'Quản lý', roles: [UserRole.MANAGER] });
      team.managerIds = [manager._id];
      const { service } = build([manager], [team]);
      const result = await service.buildOwnerRefs({
        createdBy: null,
        teamIds: [team._id],
      });
      expect(result.creator).toBeNull();
      expect(result.ownerManagers.map((m) => m.fullName)).toEqual(['Quản lý']);
    });

    it('FR-30: sắp ownerManagers theo tên hiển thị với collation tiếng Việt; Manager là người tạo (nối cuối) vẫn vào đúng vị trí', async () => {
      const { team, mk } = setup();
      const creator = mk({ displayName: 'Ân', roles: [UserRole.MANAGER] });
      const mB = mk({ displayName: 'Bình', roles: [UserRole.MANAGER] });
      const mA = mk({ displayName: 'An', roles: [UserRole.MANAGER] });
      team.managerIds = [mB._id, mA._id];
      const { service } = build([creator, mB, mA], [team]);

      const result = await service.buildOwnerRefs({ createdBy: creator._id });

      // So sánh theo mã ký tự sẽ đẩy "Ân" ra sau "Bình"; collation vi xếp An < Ân < Bình.
      expect(result.ownerManagers.map((m) => m.fullName)).toEqual([
        'An',
        'Ân',
        'Bình',
      ]);
    });

    it('FR-30: collation "vi" (không phải "en"): Â đứng SAU A (Ab < Âa) và Đ đứng SAU D (Dung < Đức), khớp thứ tự sort của Mongo', async () => {
      const { team, mk } = setup();
      const creator = mk({ displayName: 'Tạo', roles: [UserRole.STAFF] });
      const names = ['Đức', 'Âa', 'Dung', 'Ab'];
      const managers = names.map((displayName) =>
        mk({ displayName, roles: [UserRole.MANAGER] }),
      );
      team.managerIds = managers.map((m) => m._id);
      const { service } = build([creator, ...managers], [team]);

      const result = await service.buildOwnerRefs({ createdBy: creator._id });

      // Locale "en" xếp Âa trước Ab và Đức trước Dung; chỉ "vi" cho đúng thứ tự dưới đây.
      expect(result.ownerManagers.map((m) => m.fullName)).toEqual([
        'Ab',
        'Âa',
        'Dung',
        'Đức',
      ]);
    });

    it('FR-30: tên trả ra (`fullName` của API) lấy từ `displayName` của User, đọc bằng select có displayName', async () => {
      const { team, mk } = setup();
      const creator = mk({ displayName: 'Chị Tạo', roles: [UserRole.STAFF] });
      const manager = mk({
        displayName: 'Anh Quản',
        roles: [UserRole.MANAGER],
      });
      team.managerIds = [manager._id];
      const { service, userFind } = build([creator, manager], [team]);

      const result = await service.buildOwnerRefs({ createdBy: creator._id });

      expect(result.creator?.fullName).toBe('Chị Tạo');
      expect(result.ownerManagers[0].fullName).toBe('Anh Quản');
      expect(userFind.mock.results[0].value.select).toHaveBeenCalledWith(
        'displayName roles',
      );
    });

    it('FR-30: User thật không có `fullName`: dữ liệu chỉ có `fullName` (sai trường) cho tên rỗng, không đoán', async () => {
      const { team } = setup();
      const creator = {
        ...user({ displayName: 'x', teamId: team._id, teamIds: [team._id] }),
        displayName: undefined,
        fullName: 'Tên sai trường',
      } as unknown as FakeUser;
      const { service } = build([creator], [team]);

      const result = await service.buildOwnerRefs({ createdBy: creator._id });

      expect(result.creator?.fullName).toBe('');
    });
  });
});
