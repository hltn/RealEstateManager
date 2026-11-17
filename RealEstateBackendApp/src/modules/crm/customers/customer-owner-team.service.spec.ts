import { Types } from 'mongoose';
import { UserRole } from '../../../common/enums/user-role.enum';
import { UserStatus } from '../../../common/enums/user-status.enum';
import { CustomerOwnerTeamService } from './customer-owner-team.service';

const id = () => new Types.ObjectId();

interface FakeUser {
  _id: Types.ObjectId;
  fullName: string;
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

const user = (over: Partial<FakeUser> & { fullName: string }): FakeUser => ({
  _id: id(),
  roles: [UserRole.STAFF],
  status: UserStatus.ACTIVE,
  deletedAt: null,
  teamId: null,
  teamIds: [],
  ...over,
});

/** Model giả chỉ đủ cho chuỗi `.select().session().lean().exec()`; lọc theo `_id`, `deletedAt`, `status`, `roles`. */
const build = (users: FakeUser[], teams: FakeTeam[]) => {
  const chain = <T>(rows: T[]) => {
    const api = {
      select: jest.fn().mockReturnThis(),
      session: jest.fn().mockReturnThis(),
      lean: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue(rows),
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
  const userFindOne = jest.fn((filter: { _id: Types.ObjectId }) => {
    const api = chain([] as FakeUser[]);
    api.exec.mockResolvedValue(
      users.find((u) => u._id.equals(filter._id)) ?? null,
    );
    return api;
  });
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
    it('FR-30: đọc người tạo bằng MỘT truy vấn users với select đủ fullName roles status deletedAt, rồi managerIds nhóm chủ', async () => {
      const team: FakeTeam = {
        _id: id(),
        managerIds: [id(), id()],
        deletedAt: null,
      };
      const creator = user({
        fullName: 'Tạo',
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
        'teamId teamIds fullName roles status deletedAt',
      );
      expect(teamFind).toHaveBeenCalledTimes(1);
      expect(result.ownerTeamIds).toEqual([team._id]);
      expect(result.managerIds.map(String)).toEqual(
        team.managerIds.map(String),
      );
      expect(result.creator?._id).toEqual(creator._id);
    });

    it('FR-30: người tạo là Admin thuần (không nhóm) thì không đọc teams và không có Manager nhóm chủ', async () => {
      const admin = user({ fullName: 'Admin', roles: [UserRole.ADMIN] });
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
        fullName: 'Tạo',
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
        fullName: 'Tạo',
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

  describe('buildOwnerRefs: ownerManagers và creator của chi tiết khách', () => {
    const setup = () => {
      const team: FakeTeam = { _id: id(), managerIds: [], deletedAt: null };
      const mk = (over: Partial<FakeUser> & { fullName: string }) =>
        user({ teamId: team._id, teamIds: [team._id], ...over });
      return { team, mk };
    };

    it('FR-30: ownerManagers đúng định dạng, sắp theo fullName, không trùng thành viên careTeam', async () => {
      const { team, mk } = setup();
      const creator = mk({ fullName: 'Người tạo', roles: [UserRole.STAFF] });
      const mB = mk({ fullName: 'Bình', roles: [UserRole.MANAGER] });
      const mA = mk({ fullName: 'An', roles: [UserRole.MANAGER] });
      const mInTeam = mk({
        fullName: 'Có trong nhóm',
        roles: [UserRole.MANAGER],
      });
      team.managerIds = [mB._id, mA._id, mInTeam._id];
      const { service } = build([creator, mA, mB, mInTeam], [team]);

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
      const creator = mk({ fullName: 'Tạo' });
      const ok = mk({ fullName: 'Ổn', roles: [UserRole.MANAGER] });
      const blocked = mk({
        fullName: 'Khóa',
        roles: [UserRole.MANAGER],
        status: UserStatus.BLOCKED,
      });
      const deleted = mk({
        fullName: 'Xóa',
        roles: [UserRole.MANAGER],
        deletedAt: new Date(),
      });
      const demoted = mk({ fullName: 'Hạ cấp', roles: [UserRole.STAFF] });
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
        fullName: 'Quản lý tạo',
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
        fullName: 'Admin tạo',
        roles: [UserRole.STAFF, UserRole.ADMIN],
      });
      const staff = mk({ fullName: 'Staff tạo', roles: [UserRole.STAFF] });
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
      const staff = mk({ fullName: 'Staff tạo' });
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
      const creator = mk({ fullName: 'Tạo', ...over });
      const { service } = build([creator], [team]);
      const result = await service.buildOwnerRefs({ createdBy: creator._id });
      expect(result.creator).toBeNull();
    });

    it('FR-30: creator = null và ownerManagers theo teamIds khi khách cũ thiếu createdBy', async () => {
      const { team, mk } = setup();
      const manager = mk({ fullName: 'Quản lý', roles: [UserRole.MANAGER] });
      team.managerIds = [manager._id];
      const { service } = build([manager], [team]);
      const result = await service.buildOwnerRefs({
        createdBy: null,
        teamIds: [team._id],
      });
      expect(result.creator).toBeNull();
      expect(result.ownerManagers.map((m) => m.fullName)).toEqual(['Quản lý']);
    });
  });
});
