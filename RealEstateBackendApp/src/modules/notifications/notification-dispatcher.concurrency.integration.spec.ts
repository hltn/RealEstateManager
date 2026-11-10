/**
 * INTEGRATION (FR-25, T-51) — đua đồng thời lên upsert `(userId, dedupeKey)` của `NotificationDispatcher` trên
 * MongoDB Replica Set thật (mongodb-memory-server chạy `mongod` thật, không phải mock). Mục tiêu: chứng minh upsert
 * đua trên unique index `{ userId, dedupeKey }` có ném E11000 (`isDuplicateKeyError`) ra ngoài hay không. Kết quả
 * quyết định T-52 (đỏ ⇒ bọc thử lại một lần; xanh ⇒ đóng "không cần"). Hàng đợi BullMQ được thay bằng bản giả đếm
 * lượt `add` (Dispatcher chỉ dùng hàng đợi để xếp job `push.send`), nên không cần Redis thật.
 *
 * Mọi test ghi tham chiếu FR-25. Chạy:
 * npx jest --testRegex ".*\.integration\.spec\.ts$" --testPathIgnorePatterns "/node_modules/" --runInBand notification-dispatcher.concurrency
 */
import { ConfigModule } from '@nestjs/config';
import { getConnectionToken, MongooseModule } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import type { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Connection, Types } from 'mongoose';
import { isDuplicateKeyError } from '../../common/utils/mongo-error.util';
import { createMemoryReplSet } from '../../shared/database/memory-replset.util';
import { withTransaction } from '../../shared/database/with-transaction.util';
import { FeatureFlagModule } from '../../shared/feature-flags/feature-flag.module';
import { QueueRuntimeService } from '../../shared/queue/queue-runtime.service';
import { REDIS_CLIENT } from '../../shared/redis/redis.constants';
import { createRedisClientStub } from '../../shared/redis/redis-client.fixture';
import {
  NotificationPushStatus,
  NotificationType,
} from './notification.constants';
import {
  NotificationDispatcher,
  NotificationRequest,
} from './notification-dispatcher.service';
import { NotificationsModule } from './notifications.module';
import { PUSH_PROVIDER } from './push/push-provider.interface';

jest.setTimeout(300_000);

/** Số lần gọi song song tối thiểu theo Architecture FR-25 (≥ 50). */
const PARALLEL = 60;

describe('FR-25 / T-51 NotificationDispatcher: upsert (userId, dedupeKey) đồng thời', () => {
  let replSet: MongoMemoryReplSet;
  let moduleRef: TestingModule;
  let connection: Connection;
  let dispatcher: NotificationDispatcher;
  const queueAdd = jest.fn().mockResolvedValue({});

  const notifications = () => connection.collection('notifications');

  /** Người nhận phải là tài khoản ACTIVE chưa xóa (T-12, FR-18) mới được ghi thông báo. */
  const seedActiveUser = async (): Promise<Types.ObjectId> => {
    const _id = new Types.ObjectId();
    await connection
      .collection('users')

      .insertOne({
        _id,
        status: 'ACTIVE',
        deletedAt: null,
        email: `${String(_id)}@example.test`,
        username: String(_id),
      });
    return _id;
  };

  const buildRequest = (
    userId: Types.ObjectId,
    dedupeKey: string,
  ): NotificationRequest => {
    const customerId = new Types.ObjectId();
    return {
      type: NotificationType.CUSTOMER_ASSIGNED,
      recipientIds: [userId],
      inApp: { title: 'Được thêm', body: 'Nội dung' },
      vars: { actorName: 'Lan', customerName: 'Minh' },
      data: { customerId, deepLink: `/crm/customers/${String(customerId)}` },
      context: { careRole: 'MEMBER', origin: 'TEAM_ADD' },
      dedupeKey,
    };
  };

  const uniqueKey = (label: string): string =>
    `FR25:${label}:${new Types.ObjectId().toHexString()}`;

  /** Tổng `created` của các lần gọi đã thành công. */
  const sumCreated = (results: { created: number }[]): number =>
    results.reduce((total, result) => total + result.created, 0);

  /** Danh sách lỗi E11000 trong kết quả `allSettled` (bằng chứng upsert đua ném lỗi trùng khóa). */
  const duplicateKeyFailures = (
    settled: PromiseSettledResult<unknown>[],
  ): unknown[] =>
    settled
      .filter(
        (item): item is PromiseRejectedResult => item.status === 'rejected',
      )
      .map((item) => item.reason as unknown)
      .filter((reason) => isDuplicateKeyError(reason));

  /** Mọi lần gọi phải fulfilled; nếu có lỗi thì in ra lỗi đầu tiên để log đỏ nói rõ nguyên nhân. */
  const expectAllFulfilled = <T>(
    settled: PromiseSettledResult<T>[],
  ): { created: number }[] => {
    const rejected = settled.filter(
      (item): item is PromiseRejectedResult => item.status === 'rejected',
    );
    expect({
      rejectedCount: rejected.length,
      duplicateKeyCount: duplicateKeyFailures(settled).length,
      firstError: rejected[0] ? String(rejected[0].reason) : null,
    }).toEqual({ rejectedCount: 0, duplicateKeyCount: 0, firstError: null });
    return (settled as PromiseFulfilledResult<{ created: number }>[]).map(
      (item) => item.value,
    );
  };

  beforeAll(async () => {
    process.env.FEATURE_CRM_ENABLED = 'true';
    process.env.CRM_PII_ENCRYPTION_KEY = 'ab'.repeat(32);
    replSet = await createMemoryReplSet();
    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        MongooseModule.forRoot(replSet.getUri()),
        FeatureFlagModule,
        NotificationsModule,
      ],
    })
      .overrideProvider(PUSH_PROVIDER)
      .useValue({
        name: 'fake',
        isEnabled: () => true,
        initialStatus: () => NotificationPushStatus.PENDING,
      })
      .overrideProvider(REDIS_CLIENT)
      .useValue(createRedisClientStub())
      .overrideProvider(QueueRuntimeService)
      .useValue({
        isEnabled: () => true,
        add: queueAdd,
        registerWorker: jest.fn(),
        upsertSchedulers: jest.fn().mockResolvedValue(undefined),
      })
      .compile();
    await moduleRef.init();
    connection = moduleRef.get<Connection>(getConnectionToken());
    dispatcher = moduleRef.get(NotificationDispatcher);
    // Bảo đảm unique index `{ userId, dedupeKey }` đã dựng xong trước khi đua (nếu không test vô nghĩa).
    await Promise.all(
      connection.modelNames().map((name) => connection.model(name).init()),
    );
  });

  afterAll(async () => {
    await moduleRef?.close();
    await replSet?.stop();
  });

  beforeEach(() => queueAdd.mockClear());

  it('FR-25: unique index (userId, dedupeKey) có thật (tiền đề của mọi test đua bên dưới)', async () => {
    const indexes = await notifications().indexes();
    const unique = indexes.find(
      (index) =>
        index.unique === true &&
        index.key?.userId === 1 &&
        index.key?.dedupeKey === 1,
    );
    expect(unique).toBeDefined();
  });

  it(`FR-25: ${PARALLEL} dispatch song song cùng (userId, dedupeKey) ngoài transaction: không E11000, đúng 1 thông báo, đúng 1 job`, async () => {
    const userId = await seedActiveUser();
    const dedupeKey = uniqueKey('same-outside-tx');

    const settled = await Promise.allSettled(
      Array.from({ length: PARALLEL }, () =>
        dispatcher.dispatch([buildRequest(userId, dedupeKey)]),
      ),
    );

    const results = expectAllFulfilled(settled);
    expect(sumCreated(results)).toBe(1);
    expect(await notifications().countDocuments({ userId, dedupeKey })).toBe(1);
    expect(queueAdd).toHaveBeenCalledTimes(1);
  });

  it(`FR-25: ${PARALLEL} dispatch song song cùng (userId, dedupeKey) trong transaction riêng: không E11000, đúng 1 thông báo, đúng 1 job sau commit`, async () => {
    const userId = await seedActiveUser();
    const dedupeKey = uniqueKey('same-in-tx');

    const settled = await Promise.allSettled(
      Array.from({ length: PARALLEL }, () =>
        withTransaction(connection, (session) =>
          dispatcher.dispatch([buildRequest(userId, dedupeKey)], session),
        ),
      ),
    );

    const results = expectAllFulfilled(settled);
    expect(sumCreated(results)).toBe(1);
    expect(await notifications().countDocuments({ userId, dedupeKey })).toBe(1);
    expect(queueAdd).toHaveBeenCalledTimes(1);
  });

  it(`FR-25: ${PARALLEL} dispatch song song với HAI dedupeKey khác nhau (cùng user) ngoài transaction: mỗi khóa đúng 1 bản`, async () => {
    const userId = await seedActiveUser();
    const keyA = uniqueKey('two-keys-A');
    const keyB = uniqueKey('two-keys-B');

    const settled = await Promise.allSettled(
      Array.from({ length: PARALLEL }, (_, index) =>
        dispatcher.dispatch([
          buildRequest(userId, index % 2 === 0 ? keyA : keyB),
        ]),
      ),
    );

    const results = expectAllFulfilled(settled);
    expect(sumCreated(results)).toBe(2);
    expect(
      await notifications().countDocuments({ userId, dedupeKey: keyA }),
    ).toBe(1);
    expect(
      await notifications().countDocuments({ userId, dedupeKey: keyB }),
    ).toBe(1);
    expect(queueAdd).toHaveBeenCalledTimes(2);
  });

  it(`FR-25: ${PARALLEL} dispatch song song với HAI dedupeKey khác nhau (cùng user) trong transaction: mỗi khóa đúng 1 bản`, async () => {
    const userId = await seedActiveUser();
    const keyA = uniqueKey('two-keys-tx-A');
    const keyB = uniqueKey('two-keys-tx-B');

    const settled = await Promise.allSettled(
      Array.from({ length: PARALLEL }, (_, index) =>
        withTransaction(connection, (session) =>
          dispatcher.dispatch(
            [buildRequest(userId, index % 2 === 0 ? keyA : keyB)],
            session,
          ),
        ),
      ),
    );

    const results = expectAllFulfilled(settled);
    expect(sumCreated(results)).toBe(2);
    expect(
      await notifications().countDocuments({ userId, dedupeKey: keyA }),
    ).toBe(1);
    expect(
      await notifications().countDocuments({ userId, dedupeKey: keyB }),
    ).toBe(1);
    expect(queueAdd).toHaveBeenCalledTimes(2);
  });

  it('FR-25: một dispatch chứa nhiều yêu cầu trùng (userId, dedupeKey) trong cùng lô bulkWrite: không E11000, đúng 1 bản', async () => {
    const userId = await seedActiveUser();
    const dedupeKey = uniqueKey('same-batch');

    const settled = await Promise.allSettled([
      dispatcher.dispatch(
        Array.from({ length: PARALLEL }, () => buildRequest(userId, dedupeKey)),
      ),
    ]);

    const results = expectAllFulfilled(settled);
    expect(sumCreated(results)).toBe(1);
    expect(await notifications().countDocuments({ userId, dedupeKey })).toBe(1);
    expect(queueAdd).toHaveBeenCalledTimes(1);
  });

  it(`FR-25: ${PARALLEL} dispatch song song, mỗi lô gồm nhiều người nhận trùng nhau và khóa trùng nhau: mỗi (user, khóa) đúng 1 bản`, async () => {
    const users = await Promise.all(
      Array.from({ length: 5 }, () => seedActiveUser()),
    );
    const dedupeKey = uniqueKey('multi-recipient');

    const settled = await Promise.allSettled(
      Array.from({ length: PARALLEL }, () =>
        dispatcher.dispatch([
          { ...buildRequest(users[0], dedupeKey), recipientIds: users },
        ]),
      ),
    );

    const results = expectAllFulfilled(settled);
    expect(sumCreated(results)).toBe(users.length);
    expect(
      await notifications().countDocuments({
        dedupeKey,
        userId: { $in: users },
      }),
    ).toBe(users.length);
    expect(queueAdd).toHaveBeenCalledTimes(users.length);
  });

  it('FR-25: đua xen kẽ lô trong transaction với lô ngoài transaction cùng (userId, dedupeKey): không E11000, đúng 1 bản', async () => {
    const userId = await seedActiveUser();
    const dedupeKey = uniqueKey('mixed-tx');

    const settled = await Promise.allSettled(
      Array.from({ length: PARALLEL }, (_, index) =>
        index % 2 === 0
          ? dispatcher.dispatch([buildRequest(userId, dedupeKey)])
          : withTransaction(connection, (session) =>
              dispatcher.dispatch([buildRequest(userId, dedupeKey)], session),
            ),
      ),
    );

    const results = expectAllFulfilled(settled);
    expect(sumCreated(results)).toBe(1);
    expect(await notifications().countDocuments({ userId, dedupeKey })).toBe(1);
    expect(queueAdd).toHaveBeenCalledTimes(1);
  });
});
