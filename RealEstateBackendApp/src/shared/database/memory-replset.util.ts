import { MongoMemoryReplSet } from 'mongodb-memory-server';

/**
 * Dựng MongoMemoryReplSet 1 node cho integration test, chờ khởi động tối đa 120s (mặc định 10s hay hết hạn khi chạy
 * cả bộ test lúc máy tải: "Instance failed to start within 10000ms").
 */
export const createMemoryReplSet = (): Promise<MongoMemoryReplSet> =>
  MongoMemoryReplSet.create({
    replSet: { count: 1 },
    instanceOpts: [{ launchTimeout: 120_000 }],
  });
