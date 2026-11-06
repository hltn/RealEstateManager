/**
 * INTEGRATION — T-32 job lặp `push.sweep` (qua router `PushQueueWorker.handle`) trên MongoDB Replica Set thật
 * (mongodb-memory-server). Hàng đợi BullMQ là bản giả có hành vi `jobId` của BullMQ (đã có thì bỏ qua) và công tắc
 * "Redis lỗi"; dịch vụ push là bản giả để chứng minh cờ tắt thì không gọi `send`.
 *
 * Chạy: npx jest --testRegex ".*\.integration\.spec\.ts$" --testPathIgnorePatterns "/node_modules/" --runInBand push-sweep --forceExit
 */
import { ConfigModule } from '@nestjs/config';
import { getConnectionToken, MongooseModule } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import type { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Connection, Types } from 'mongoose';
import { createMemoryReplSet } from '../../../shared/database/memory-replset.util';
import { FeatureFlagModule } from '../../../shared/feature-flags/feature-flag.module';
import { QueueRuntimeService } from '../../../shared/queue/queue-runtime.service';
import { REDIS_CLIENT } from '../../../shared/redis/redis.constants';
import { createRedisClientStub } from '../../../shared/redis/redis-client.fixture';
import {
  NotificationPushStatus,
  NotificationType,
} from '../notification.constants';
import { NotificationDispatcher } from '../notification-dispatcher.service';
import { NotificationsModule } from '../notifications.module';
import { PUSH_PROVIDER } from './push-provider.interface';
import { PushQueueWorker } from './push-queue-worker.service';

jest.setTimeout(300_000);

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

describe('T-32 push.sweep (tích hợp)', () => {
  let replSet: MongoMemoryReplSet;
  let moduleRef: TestingModule;
  let connection: Connection;
  let worker: PushQueueWorker;
  let dispatcher: NotificationDispatcher;
  /** Hàng đợi giả: `jobId` đã có thì bỏ qua như BullMQ. */
  const jobs = new Map<string, { name: string; data: unknown }>();
  let isRedisDown = false;
  const queueAdd = jest.fn(
    (
      _queue: string,
      name: string,
      data: Record<string, unknown>,
      options: { jobId: string },
    ) => {
      if (isRedisDown) return Promise.reject(new Error('redis down'));
      if (!jobs.has(options.jobId)) jobs.set(options.jobId, { name, data });
      return Promise.resolve({});
    },
  );
  const send = jest.fn();

  const col = (name: string) => connection.collection(name);
  const sweep = () => worker.handle({ name: 'push.sweep' });

  const createNotification = async (
    overrides: Record<string, unknown> = {},
  ) => {
    const _id = new Types.ObjectId();
    await col('notifications').insertOne({
      _id,
      userId: new Types.ObjectId(),
      type: 'CARE_LOG_ADDED',
      title: 'Nhật ký mới',
      body: 'Nội dung trong app',
      data: { customerId: null, deepLink: '/crm/customers/abc' },
      priority: 'NORMAL',
      readAt: null,
      pushStatus: 'PENDING',
      push: { title: 'T', body: 'B', url: '/crm/customers/abc' },
      pushGroupKey: null,
      pushSentAt: null,
      dedupeKey: null,
      createdAt: new Date(Date.now() - 5 * MINUTE),
      ...overrides,
    });
    return _id;
  };
  const statusOf = async (id: Types.ObjectId) =>
    (await col('notifications').findOne({ _id: id }))?.pushStatus;

  beforeAll(async () => {
    process.env.FEATURE_CRM_ENABLED = 'true';
    process.env.FEATURE_CRM_PUSH = 'true';
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
        isEnabled: () => process.env.FEATURE_CRM_PUSH === 'true',
        initialStatus: () => NotificationPushStatus.PENDING,
        send,
      })
      // Không cần Redis thật: không dùng bộ đếm đợt push (T-33).
      .overrideProvider(REDIS_CLIENT)
      .useValue(createRedisClientStub())
      .overrideProvider(QueueRuntimeService)
      .useValue({
        isEnabled: () => false,
        add: queueAdd,
        registerWorker: jest.fn(),
        upsertSchedulers: jest.fn().mockResolvedValue(undefined),
      })
      .compile();
    await moduleRef.init();
    connection = moduleRef.get<Connection>(getConnectionToken());
    worker = moduleRef.get(PushQueueWorker);
    dispatcher = moduleRef.get(NotificationDispatcher);
    await Promise.all(
      connection.modelNames().map((name) => connection.model(name).init()),
    );
  });

  afterAll(async () => {
    delete process.env.FEATURE_CRM_PUSH;
    await moduleRef?.close();
    await replSet?.stop();
  });

  beforeEach(async () => {
    process.env.FEATURE_CRM_PUSH = 'true';
    isRedisDown = false;
    jobs.clear();
    queueAdd.mockClear();
    send.mockClear();
    await col('notifications').deleteMany({});
  });

  it('Redis lỗi lúc commit: thông báo kẹt PENDING, sweep sau 30 giây xếp lại đúng jobId push-{id}', async () => {
    isRedisDown = true;
    const customerId = new Types.ObjectId();
    const result = await dispatcher.dispatch([
      {
        type: NotificationType.CUSTOMER_ASSIGNED,
        recipientIds: [new Types.ObjectId()],
        inApp: { title: 'Được thêm', body: 'Nội dung' },
        vars: { actorName: 'Lan', customerName: 'Minh' },
        data: {
          customerId,
          deepLink: `/crm/customers/${String(customerId)}`,
        },
        context: { careRole: 'MEMBER', origin: 'TEAM_ADD' },
        dedupeKey: `ASSIGN:ADD:${String(customerId)}:x`,
      },
    ]);
    expect(result.created).toBe(1);
    expect(jobs.size).toBe(0);
    const doc = await col('notifications').findOne({});
    expect(doc?.pushStatus).toBe('PENDING');

    // Vừa tạo (dưới 30 giây): sweep chưa đụng tới.
    isRedisDown = false;
    await sweep();
    expect(jobs.size).toBe(0);

    // Quá 30 giây: được xếp lại.
    await col('notifications').updateOne(
      { _id: doc!._id },
      { $set: { createdAt: new Date(Date.now() - 31 * 1000) } },
    );
    await sweep();
    expect([...jobs.keys()]).toEqual([`push-${String(doc!._id)}`]);
    expect(jobs.get(`push-${String(doc!._id)}`)).toEqual({
      name: 'push.send',
      data: { notificationId: String(doc!._id) },
    });
    expect(await statusOf(doc!._id)).toBe('PENDING');
  });

  it('Redis vẫn lỗi lúc quét: không ném, thông báo vẫn PENDING, lượt sau xếp được', async () => {
    const id = await createNotification();
    isRedisDown = true;
    await expect(sweep()).resolves.toBeUndefined();
    expect(jobs.size).toBe(0);
    expect(await statusOf(id)).toBe('PENDING');

    isRedisDown = false;
    await sweep();
    expect(jobs.has(`push-${String(id)}`)).toBe(true);
  });

  it('không xếp trùng khi job đã có: quét nhiều lần vẫn đúng một job cho mỗi thông báo', async () => {
    const a = await createNotification();
    const b = await createNotification();
    jobs.set(`push-${String(a)}`, { name: 'push.send', data: 'đã có' });

    await sweep();
    await sweep();

    expect(jobs.size).toBe(2);
    expect(jobs.get(`push-${String(a)}`)?.data).toBe('đã có');
    expect(jobs.has(`push-${String(b)}`)).toBe(true);
  });

  it('chỉ lấy PENDING quá 30 giây: bỏ qua thông báo mới, SENT/FAILED/SKIPPED', async () => {
    await createNotification({ createdAt: new Date() });
    await createNotification({ pushStatus: 'SENT' });
    await createNotification({ pushStatus: 'FAILED' });
    await createNotification({ pushStatus: 'SKIPPED' });
    const old = await createNotification();

    await sweep();

    expect([...jobs.keys()]).toEqual([`push-${String(old)}`]);
  });

  it('tối đa 200 thông báo mỗi lượt, cũ nhất trước; lượt sau xếp nốt', async () => {
    const base = Date.now() - 10 * MINUTE;
    await col('notifications').insertMany(
      Array.from({ length: 205 }, (_, index) => ({
        userId: new Types.ObjectId(),
        type: 'CARE_LOG_ADDED',
        title: 'T',
        body: 'B',
        data: { customerId: null, deepLink: '/x' },
        pushStatus: 'PENDING',
        push: { title: 'T', body: 'B', url: '/x' },
        createdAt: new Date(base + index * 1000),
      })),
    );

    await sweep();
    expect(jobs.size).toBe(200);

    const oldest = await col('notifications')
      .find({})
      .sort({ createdAt: 1 })
      .limit(200)
      .toArray();
    expect(oldest.every((doc) => jobs.has(`push-${String(doc._id)}`))).toBe(
      true,
    );
    // Giả lập worker đã xử lý xong 200 cái cũ nhất: lượt sau chỉ còn 5 cái.
    await col('notifications').updateMany(
      { _id: { $in: oldest.map((doc) => doc._id) } },
      { $set: { pushStatus: 'SENT' } },
    );
    await sweep();
    expect(jobs.size).toBe(205);
  });

  it('quá ttlSeconds của loại thì SKIPPED, không xếp job; còn hạn thì xếp', async () => {
    // APPOINTMENT_DUE có TTL 1 giờ, CUSTOMER_ASSIGNED 24 giờ (push-catalog).
    const expired = await createNotification({
      type: 'APPOINTMENT_DUE',
      createdAt: new Date(Date.now() - 61 * MINUTE),
    });
    const fresh = await createNotification({
      type: 'APPOINTMENT_DUE',
      createdAt: new Date(Date.now() - 59 * MINUTE),
    });
    const longTtl = await createNotification({
      type: 'CUSTOMER_ASSIGNED',
      createdAt: new Date(Date.now() - 2 * HOUR),
    });
    const expiredLong = await createNotification({
      type: 'CUSTOMER_ASSIGNED',
      createdAt: new Date(Date.now() - 25 * HOUR),
    });

    await sweep();

    expect(await statusOf(expired)).toBe('SKIPPED');
    expect(await statusOf(expiredLong)).toBe('SKIPPED');
    expect(await statusOf(fresh)).toBe('PENDING');
    expect(await statusOf(longTtl)).toBe('PENDING');
    expect([...jobs.keys()].sort()).toEqual(
      [`push-${String(fresh)}`, `push-${String(longTtl)}`].sort(),
    );
  });

  it('cờ tắt: mọi PENDING (kể cả mới) thành SKIPPED, không xếp job, không gọi dịch vụ push; SENT giữ nguyên', async () => {
    process.env.FEATURE_CRM_PUSH = 'false';
    const old = await createNotification();
    const fresh = await createNotification({ createdAt: new Date() });
    const sent = await createNotification({ pushStatus: 'SENT' });

    await sweep();

    expect(await statusOf(old)).toBe('SKIPPED');
    expect(await statusOf(fresh)).toBe('SKIPPED');
    expect(await statusOf(sent)).toBe('SENT');
    expect(queueAdd).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });
});
