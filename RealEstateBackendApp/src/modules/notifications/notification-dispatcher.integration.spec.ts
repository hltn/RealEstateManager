/**
 * INTEGRATION — T-23 `NotificationDispatcher` trên MongoDB Replica Set thật (mongodb-memory-server): upsert theo
 * `(userId, dedupeKey)`, `upsertedIds` thật của driver, job `push.send` chỉ được xếp SAU commit và không bao giờ khi
 * rollback. Hàng đợi BullMQ được thay bằng bản giả (không cần Redis).
 *
 * Chạy: npx jest --testRegex ".*\.integration\.spec\.ts$" --testPathIgnorePatterns "/node_modules/" --runInBand notification-dispatcher
 */
import { ConfigModule } from '@nestjs/config';
import { getConnectionToken, MongooseModule } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import type { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Connection, Types } from 'mongoose';
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

describe('T-23 NotificationDispatcher (tích hợp)', () => {
  let replSet: MongoMemoryReplSet;
  let moduleRef: TestingModule;
  let connection: Connection;
  let dispatcher: NotificationDispatcher;
  const queueAdd = jest.fn().mockResolvedValue({});

  const notifications = () => connection.collection('notifications');
  const request = (
    overrides: Partial<NotificationRequest> = {},
  ): NotificationRequest => {
    const customerId = new Types.ObjectId();
    return {
      type: NotificationType.CUSTOMER_ASSIGNED,
      recipientIds: [new Types.ObjectId()],
      inApp: { title: 'Được thêm', body: 'Nội dung' },
      vars: { actorName: 'Lan', customerName: 'Minh' },
      data: { customerId, deepLink: `/crm/customers/${String(customerId)}` },
      context: { careRole: 'MEMBER', origin: 'TEAM_ADD' },
      dedupeKey: `ASSIGN:ADD:${String(customerId)}:${new Types.ObjectId().toHexString()}`,
      ...overrides,
    };
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
      // Không cần Redis thật: không dùng bộ đếm đợt push (T-33).
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
    await Promise.all(
      connection.modelNames().map((name) => connection.model(name).init()),
    );
  });

  afterAll(async () => {
    await moduleRef?.close();
    await replSet?.stop();
  });

  beforeEach(() => queueAdd.mockClear());

  it('ghi PENDING + nội dung push, xếp đúng một job; gọi lại cùng dedupeKey không tạo thêm', async () => {
    const req = request();
    await expect(dispatcher.dispatch([req])).resolves.toEqual({ created: 1 });
    const doc = await notifications().findOne({ dedupeKey: req.dedupeKey });
    expect(doc).toMatchObject({
      pushStatus: 'PENDING',
      pushGroupKey: null,
      pushSentAt: null,
      push: {
        title: 'Bạn được mời cùng phụ trách một khách',
        body: 'Lan đã thêm bạn vào nhóm chăm sóc khách Minh.',
      },
    });
    expect(queueAdd).toHaveBeenCalledTimes(1);
    expect(queueAdd.mock.calls[0][3]).toEqual({
      jobId: `push-${String(doc!._id)}`,
    });

    await expect(dispatcher.dispatch([req])).resolves.toEqual({ created: 0 });
    expect(queueAdd).toHaveBeenCalledTimes(1);
    expect(
      await notifications().countDocuments({ dedupeKey: req.dedupeKey }),
    ).toBe(1);
  });

  it('nhiều người nhận: mỗi người một thông báo và một job riêng', async () => {
    const recipients = [
      new Types.ObjectId(),
      new Types.ObjectId(),
      new Types.ObjectId(),
    ];
    const req = request({ recipientIds: recipients });
    await expect(dispatcher.dispatch([req])).resolves.toEqual({ created: 3 });
    expect(queueAdd).toHaveBeenCalledTimes(3);
    const ids = queueAdd.mock.calls.map((call) => call[3].jobId);
    expect(new Set(ids).size).toBe(3);
  });

  it('trong transaction: chỉ xếp job SAU commit', async () => {
    const req = request();
    await withTransaction(connection, async (session) => {
      await dispatcher.dispatch([req], session);
      expect(queueAdd).not.toHaveBeenCalled();
    });
    expect(queueAdd).toHaveBeenCalledTimes(1);
    expect(
      await notifications().countDocuments({ dedupeKey: req.dedupeKey }),
    ).toBe(1);
  });

  it('rollback: không có thông báo và không xếp job nào', async () => {
    const req = request();
    await expect(
      withTransaction(connection, async (session) => {
        await dispatcher.dispatch([req], session);
        throw new Error('nghiệp vụ lỗi');
      }),
    ).rejects.toThrow('nghiệp vụ lỗi');
    expect(
      await notifications().countDocuments({ dedupeKey: req.dedupeKey }),
    ).toBe(0);
    expect(queueAdd).not.toHaveBeenCalled();
  });

  it('Redis lỗi lúc commit: thông báo vẫn PENDING, dispatch không ném', async () => {
    queueAdd.mockRejectedValueOnce(new Error('redis down'));
    const req = request();
    await expect(dispatcher.dispatch([req])).resolves.toEqual({ created: 1 });
    expect(
      (await notifications().findOne({ dedupeKey: req.dedupeKey }))?.pushStatus,
    ).toBe('PENDING');
  });

  it('tình huống không push (phụ trách chính): ghi SKIPPED, không lưu push, không xếp job', async () => {
    const req = request({
      context: { careRole: 'PRIMARY', origin: 'TEAM_ADD' },
    });
    await dispatcher.dispatch([req]);
    expect(
      await notifications().findOne({ dedupeKey: req.dedupeKey }),
    ).toMatchObject({
      pushStatus: 'SKIPPED',
      push: null,
    });
    expect(queueAdd).not.toHaveBeenCalled();
  });

  it('người tắt push trong notification_preferences: SKIPPED, người khác vẫn PENDING', async () => {
    const muted = new Types.ObjectId();
    const other = new Types.ObjectId();
    await connection.collection('notification_preferences').insertOne({
      userId: muted,
      types: { CUSTOMER_ASSIGNED: { push: false, inApp: true } },
      quietHours: null,
    });
    const req = request({ recipientIds: [muted, other] });
    await expect(dispatcher.dispatch([req])).resolves.toEqual({ created: 2 });
    const docs = await notifications()
      .find({ dedupeKey: req.dedupeKey })
      .toArray();
    const byUser = new Map(docs.map((d) => [String(d.userId), d.pushStatus]));
    expect(byUser.get(String(muted))).toBe('SKIPPED');
    expect(byUser.get(String(other))).toBe('PENDING');
    expect(queueAdd).toHaveBeenCalledTimes(1);
  });
});
