/* eslint-disable @typescript-eslint/unbound-method -- mock jest.fn() được truyền vào expect(), không gọi tách khỏi object */
/**
 * UsersController unit spec — contract mục 6.4 / 16.6 (rule "không block chính mình").
 *
 * Bao phủ:
 * - PATCH /users/:id/status với `String(currentUser.sub) === String(params.id)`
 *   → throw ForbiddenException("Cannot block your own account") TRƯỚC khi gọi service.
 * - Block user khác → service.updateStatus được gọi.
 * - PATCH /users/:id/role KHÔNG áp dụng rule block self (ADMIN được đổi role chính mình).
 * - GET /users, POST /users → gọi service tương ứng (decorator @Roles(ADMIN) test ở guard spec).
 *
 * Gọi method trực tiếp (param decorator @CurrentUser() chỉ active qua Nest runtime,
 * khi gọi unit thì truyền payload trực tiếp làm tham số).
 */
import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { TeamsService } from '../teams/teams.service';
import { CrmActorService } from '../crm/common/access/crm-actor.service';
import { FeatureFlagService } from '../../shared/feature-flags/feature-flag.service';
import { UserRole } from '../../common/enums/user-role.enum';
import { UserStatus } from '../../common/enums/user-status.enum';
import type { JwtPayload } from '../../common/decorators/current-user.decorator';

describe('UsersController — contract mục 6.4/16.6', () => {
  let controller: UsersController;
  let usersService: jest.Mocked<UsersService>;
  let teamsService: jest.Mocked<TeamsService>;

  beforeEach(async () => {
    usersService = {
      findAll: jest.fn(),
      create: jest.fn(),
      updateStatus: jest.fn(),
      updateRole: jest.fn(),
    } as unknown as jest.Mocked<UsersService>;

    teamsService = {
      assignUserToTeam: jest.fn(),
    } as unknown as jest.Mocked<TeamsService>;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [
        { provide: UsersService, useValue: usersService },
        { provide: TeamsService, useValue: teamsService },
        // CrmFeatureGuard (gắn ở PATCH /users/:id/team) cần FeatureFlagService để khởi tạo.
        { provide: FeatureFlagService, useValue: { isEnabled: jest.fn() } },
        // ActiveAdminGuard (AdminOnly) cần CrmActorService để khởi tạo; guard được kiểm riêng ở active-admin.guard.spec.
        { provide: CrmActorService, useValue: { resolve: jest.fn() } },
      ],
    }).compile();

    controller = module.get<UsersController>(UsersController);
  });

  it('block chính mình (sub === params.id) → ForbiddenException("Cannot block your own account") TRƯỚC service', () => {
    const myId = '65e1f0a1b2c3d4e5f6a7b8c9';
    const me: JwtPayload = {
      sub: myId,
      email: 'admin@example.com',
      role: UserRole.ADMIN,
    };

    // updateStatus throw đồng bộ (trước khi xuống service) — dùng toThrow thay vì rejects.
    expect(() =>
      controller.updateStatus(myId, { status: UserStatus.BLOCKED }, me),
    ).toThrow(ForbiddenException);
    expect(() =>
      controller.updateStatus(myId, { status: UserStatus.BLOCKED }, me),
    ).toThrow('Cannot block your own account');
    // Service KHÔNG được gọi (rule chặn ở controller trước khi xuống service).
    expect(usersService.updateStatus).not.toHaveBeenCalled();
  });

  it('block user khác → service.updateStatus được gọi với id + dto', async () => {
    const myId = '65e1f0a1b2c3d4e5f6a7b8c9';
    const otherId = '65e1f0a1b2c3d4e5f6a7b8d0';
    const me: JwtPayload = {
      sub: myId,
      email: 'admin@example.com',
      role: UserRole.ADMIN,
    };
    usersService.updateStatus.mockResolvedValue({
      _id: otherId,
      email: 'editor@example.com',
      displayName: 'Editor',
      role: UserRole.EDITOR,
      status: UserStatus.BLOCKED,
      teamId: null,
    });

    await controller.updateStatus(otherId, { status: UserStatus.BLOCKED }, me);

    expect(usersService.updateStatus).toHaveBeenCalledWith(
      otherId,
      { status: UserStatus.BLOCKED },
      me,
    );
  });

  it('so sánh String(sub) === String(id) — ObjectId string dạng chuỗi, không lệch type', () => {
    // sub dạng string, id dạng string — trùng giá trị → chặn (throw đồng bộ).
    const me: JwtPayload = {
      sub: 'abc123',
      email: 'a@b.c',
      role: UserRole.ADMIN,
    };
    expect(() =>
      controller.updateStatus('abc123', { status: UserStatus.ACTIVE }, me),
    ).toThrow('Cannot block your own account');
  });

  it('PATCH /users/:id/role KHÔNG áp dụng rule block self — đổi role chính mình OK', async () => {
    const myId = '65e1f0a1b2c3d4e5f6a7b8c9';
    usersService.updateRole.mockResolvedValue({
      _id: myId,
      email: 'admin@example.com',
      displayName: 'Admin',
      role: UserRole.EDITOR,
      status: UserStatus.ACTIVE,
      teamId: null,
    });

    // Không throw — service được gọi.
    const me: JwtPayload = {
      sub: myId,
      email: 'admin@example.com',
      role: UserRole.ADMIN,
    };
    await controller.updateRole(myId, { role: UserRole.EDITOR }, me);

    expect(usersService.updateRole).toHaveBeenCalledWith(
      myId,
      { role: UserRole.EDITOR },
      me,
    );
  });

  it('GET /users → gọi service.findAll với page/limit', async () => {
    usersService.findAll.mockResolvedValue({
      data: [],
      meta: { total: 0, page: 1, limit: 20, totalPages: 1 },
    });

    await controller.findAll({ page: 1, limit: 20 });

    expect(usersService.findAll).toHaveBeenCalledWith(1, 20, {
      role: undefined,
      teamId: undefined,
      status: undefined,
      q: undefined,
    });
  });

  it('GET /users chuyển nguyên bộ lọc role/teamId/status/q xuống service', async () => {
    usersService.findAll.mockResolvedValue({
      data: [],
      meta: { total: 0, page: 2, limit: 10, totalPages: 1 },
    });
    const filters = {
      role: UserRole.STAFF,
      teamId: '65e1f0a1b2c3d4e5f6a7b8c9',
      status: UserStatus.ACTIVE,
      q: 'hạnh',
    };

    await controller.findAll({ page: 2, limit: 10, ...filters });

    expect(usersService.findAll).toHaveBeenCalledWith(2, 10, filters);
  });

  it('PATCH /users/:id/team → gán nhóm qua TeamsService và bọc { data }', async () => {
    const me: JwtPayload = {
      sub: '65e1f0a1b2c3d4e5f6a7b8c9',
      email: 'admin@example.com',
      role: UserRole.ADMIN,
    };
    const profile = {
      _id: '65e1f0a1b2c3d4e5f6a7b8d0',
      email: 'staff@example.com',
      displayName: 'Thảo',
      role: UserRole.STAFF,
      status: UserStatus.ACTIVE,
      teamId: '65e1f0a1b2c3d4e5f6a7b8d1',
    };
    teamsService.assignUserToTeam.mockResolvedValue(profile);

    const result = await controller.updateTeam(me, profile._id, {
      teamId: profile.teamId,
    });

    expect(teamsService.assignUserToTeam).toHaveBeenCalledWith(
      me,
      profile._id,
      profile.teamId,
    );
    expect(result).toEqual({ data: profile });
  });

  it('POST /users → gọi service.create với dto', async () => {
    const dto = {
      email: 'editor@example.com',
      password: 'Editor@123456',
      displayName: 'Editor One',
      role: UserRole.EDITOR,
    };
    usersService.create.mockResolvedValue({
      _id: 'new-id',
      email: 'editor@example.com',
      displayName: 'Editor One',
      role: UserRole.EDITOR,
      status: UserStatus.ACTIVE,
      teamId: null,
    });

    await controller.create(dto);

    expect(usersService.create).toHaveBeenCalledWith(dto);
  });
});
