import {
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import { UserRole } from '../../../../common/enums/user-role.enum';
import { ActiveCrmUserGuard } from './active-crm-user.guard';
import { CrmActor } from './crm-actor';
import { CrmActorService } from './crm-actor.service';

const context = (user: unknown): ExecutionContext =>
  ({
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  }) as unknown as ExecutionContext;

const actor = (roles: UserRole[]): CrmActor => ({
  userId: new Types.ObjectId(),
  role: roles[0],
  roles,
  displayName: 'x',
  teamId: null,
  teamIds: [],
  managedTeamIds: [],
});

describe('ActiveCrmUserGuard (FR-21: role/status lấy từ DB, không tin JWT)', () => {
  const resolve = jest.fn();
  const guard = new ActiveCrmUserGuard({
    resolve,
  } as unknown as CrmActorService);

  beforeEach(() => resolve.mockReset());

  it.each([UserRole.ADMIN, UserRole.MANAGER, UserRole.STAFF])(
    'FR-21: %s đang hoạt động trong DB: cho qua',
    async (role) => {
      resolve.mockResolvedValue(actor([role]));
      await expect(
        guard.canActivate(context({ sub: 'u1', role })),
      ).resolves.toBe(true);
      expect(resolve).toHaveBeenCalledWith({ sub: 'u1', role });
    },
  );

  it('FR-21: tài khoản nhiều vai trò, có một vai trò CRM (EDITOR + STAFF): cho qua', async () => {
    resolve.mockResolvedValue(actor([UserRole.EDITOR, UserRole.STAFF]));
    await expect(
      guard.canActivate(context({ sub: 'u1', role: 'EDITOR' })),
    ).resolves.toBe(true);
  });

  it('FR-21: token còn ghi STAFF nhưng DB chỉ còn EDITOR (mất vai trò CRM): 403', async () => {
    resolve.mockResolvedValue(actor([UserRole.EDITOR]));
    await expect(
      guard.canActivate(context({ sub: 'u1', role: 'STAFF' })),
    ).rejects.toThrow(ForbiddenException);
  });

  it('FR-21: tài khoản bị khóa/xóa (resolve ném 401): lỗi được giữ nguyên là 401', async () => {
    resolve.mockRejectedValue(new UnauthorizedException());
    await expect(
      guard.canActivate(context({ sub: 'u1', role: 'STAFF' })),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('FR-21: không có request.user (hoặc thiếu sub): 403 và không truy vấn DB', async () => {
    await expect(guard.canActivate(context(undefined))).rejects.toThrow(
      ForbiddenException,
    );
    await expect(guard.canActivate(context({}))).rejects.toThrow(
      ForbiddenException,
    );
    expect(resolve).not.toHaveBeenCalled();
  });
});
