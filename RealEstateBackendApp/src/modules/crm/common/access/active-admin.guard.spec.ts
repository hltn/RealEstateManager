import {
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import { UserRole } from '../../../../common/enums/user-role.enum';
import { ActiveAdminGuard } from './active-admin.guard';
import { CrmActor } from './crm-actor';
import { CrmActorService } from './crm-actor.service';

const context = (user: unknown): ExecutionContext =>
  ({
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  }) as unknown as ExecutionContext;

const actor = (role: UserRole): CrmActor => ({
  userId: new Types.ObjectId(),
  role,
  displayName: 'x',
  teamId: null,
  managedTeamIds: [],
});

describe('ActiveAdminGuard (role/status lấy từ DB, không tin JWT)', () => {
  const resolve = jest.fn();
  const guard = new ActiveAdminGuard({ resolve } as unknown as CrmActorService);

  beforeEach(() => resolve.mockReset());

  it('ADMIN đang hoạt động trong DB: cho qua', async () => {
    resolve.mockResolvedValue(actor(UserRole.ADMIN));
    await expect(
      guard.canActivate(context({ sub: 'u1', role: 'ADMIN' })),
    ).resolves.toBe(true);
    expect(resolve).toHaveBeenCalledWith({ sub: 'u1', role: 'ADMIN' });
  });

  it('token còn ghi ADMIN nhưng DB đã hạ xuống vai trò khác: 403', async () => {
    for (const role of [UserRole.EDITOR, UserRole.MANAGER, UserRole.STAFF]) {
      resolve.mockResolvedValue(actor(role));
      await expect(
        guard.canActivate(context({ sub: 'u1', role: 'ADMIN' })),
      ).rejects.toThrow(ForbiddenException);
    }
  });

  it('ADMIN bị khóa/xóa (resolve ném 401): lỗi được giữ nguyên là 401', async () => {
    resolve.mockRejectedValue(new UnauthorizedException());
    await expect(
      guard.canActivate(context({ sub: 'u1', role: 'ADMIN' })),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('không có request.user: 403 và không truy vấn DB', async () => {
    await expect(guard.canActivate(context(undefined))).rejects.toThrow(
      ForbiddenException,
    );
    expect(resolve).not.toHaveBeenCalled();
  });
});
