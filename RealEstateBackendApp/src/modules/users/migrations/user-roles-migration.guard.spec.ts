import { Logger } from '@nestjs/common';
import {
  USER_ROLES_MIGRATION_COMMAND,
  UserRolesMigrationGuard,
} from './user-roles-migration.guard';
import { USERS_PENDING_ROLES_TEAM_IDS_FILTER } from './backfill-user-roles-team-ids';

describe('UserRolesMigrationGuard — chặn chạy code mới khi chưa migrate 005', () => {
  let countDocuments: jest.Mock;
  let warn: jest.SpyInstance;

  const guardFor = (nodeEnv: string | undefined, pending: number) => {
    countDocuments = jest
      .fn()
      .mockReturnValue({ exec: jest.fn().mockResolvedValue(pending) });
    return new UserRolesMigrationGuard(
      { countDocuments } as never,
      { get: jest.fn().mockReturnValue(nodeEnv) } as never,
    );
  };

  beforeEach(() => {
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  });
  afterEach(() => warn.mockRestore());

  it('dữ liệu đủ (không còn tài khoản thiếu roles/teamIds): im lặng, kể cả production', async () => {
    await guardFor('production', 0).onModuleInit();
    expect(countDocuments).toHaveBeenCalledWith(
      USERS_PENDING_ROLES_TEAM_IDS_FILTER,
    );
    expect(warn).not.toHaveBeenCalled();
  });

  it('còn dữ liệu thiếu ở môi trường dev: cảnh báo nêu số lượng và lệnh migration, KHÔNG chặn khởi động', async () => {
    await expect(
      guardFor('development', 3).onModuleInit(),
    ).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
    const message = String(warn.mock.calls[0][0]);
    expect(message).toContain('3 tài khoản');
    expect(message).toContain(USER_ROLES_MIGRATION_COMMAND);
    expect(message).toContain('005_users_roles_teamids.ts --apply');
  });

  it('còn dữ liệu thiếu ở production: ném lỗi (fail-fast) kèm số lượng và lệnh', async () => {
    await expect(guardFor('production', 2).onModuleInit()).rejects.toThrow(
      /2 tài khoản.*005_users_roles_teamids\.ts --apply/s,
    );
  });

  it('NODE_ENV=test: bỏ qua hoàn toàn, không truy vấn DB', async () => {
    await guardFor('test', 5).onModuleInit();
    expect(countDocuments).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });
});
