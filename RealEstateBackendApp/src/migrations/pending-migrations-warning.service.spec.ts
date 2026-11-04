import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Connection } from 'mongoose';
import { PendingMigrationsWarningService } from './pending-migrations-warning.service';
import type { Migration } from './migration.types';

const migration = (id: string): Migration => ({
  id,
  description: id,
  up: () => Promise.resolve(),
});

/** Db giả: `system` trả sổ cho trước (hoặc lỗi), `users` có dữ liệu. */
const buildConnection = (
  appliedIds: string[],
  options: { fail?: boolean } = {},
): Connection => {
  const collection = (name: string) => ({
    find: () => ({
      toArray: () =>
        options.fail
          ? Promise.reject(new Error('lỗi mongodb://u:p@h/db'))
          : Promise.resolve([
              {
                _id: 'version',
                value: '1.0.2',
                commit: null,
                updatedAt: new Date(),
              },
              ...appliedIds.map((id) => ({
                _id: `migration:${id}`,
                at: new Date(),
                by: 'cli',
              })),
            ]),
    }),
    findOne: () => Promise.resolve(name === 'users' ? { _id: 1 } : null),
  });
  return {
    name: 'realestate',
    getClient: () => ({ db: () => ({ collection }) }),
  } as unknown as Connection;
};

const build = (
  connection: Connection,
  nodeEnv: string,
  migrations: readonly Migration[],
) => {
  const service = new PendingMigrationsWarningService(connection, {
    get: () => nodeEnv,
  } as unknown as ConfigService);
  (service as unknown as { migrations: readonly Migration[] }).migrations =
    migrations;
  return service;
};

describe('PendingMigrationsWarningService', () => {
  let warn: jest.SpyInstance;

  beforeEach(() => {
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  });
  afterEach(() => jest.restoreAllMocks());

  it('ghi cảnh báo (không ném lỗi) khi còn migration chờ', async () => {
    const service = build(buildConnection(['007_a']), 'production', [
      migration('007_a'),
      migration('008_b'),
    ]);
    await expect(service.onApplicationBootstrap()).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('1 migration chờ');
  });

  it('im lặng khi không còn migration chờ', async () => {
    const service = build(buildConnection(['007_a']), 'production', [
      migration('007_a'),
    ]);
    await service.onApplicationBootstrap();
    expect(warn).not.toHaveBeenCalled();
  });

  it('registry rỗng: không truy vấn DB, không cảnh báo', async () => {
    const connection = buildConnection([]);
    const getClient = jest.spyOn(connection, 'getClient');
    await build(connection, 'production', []).onApplicationBootstrap();
    expect(getClient).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it('NODE_ENV=test: bỏ qua hoàn toàn', async () => {
    const connection = buildConnection([]);
    const getClient = jest.spyOn(connection, 'getClient');
    await build(connection, 'test', [
      migration('007_a'),
    ]).onApplicationBootstrap();
    expect(getClient).not.toHaveBeenCalled();
  });

  it('lỗi khi kiểm tra bị nuốt (không chặn khởi động) và không lộ chuỗi kết nối', async () => {
    const service = build(buildConnection([], { fail: true }), 'production', [
      migration('007_a'),
    ]);
    await expect(service.onApplicationBootstrap()).resolves.toBeUndefined();
    expect(String(warn.mock.calls[0][0])).not.toContain('u:p@');
  });
});
