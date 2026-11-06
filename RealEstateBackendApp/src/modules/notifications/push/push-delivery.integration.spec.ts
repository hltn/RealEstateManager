/**
 * INTEGRATION — T-31 worker `push.send` (`PushDeliveryProcessor` qua router `PushQueueWorker.handle`) trên MongoDB
 * Replica Set thật (mongodb-memory-server). Nhà cung cấp push là bản giả (không gọi mạng), hàng đợi BullMQ là bản giả
 * (không gọi Redis). T-33 (giới hạn 3 push/người/đợt) dùng Redis THẬT qua biến môi trường `REDIS_URL` (bắt buộc đặt, ví dụ
 * container tạm `redis://127.0.0.1:16399`), mỗi lần chạy dùng tiền tố khóa riêng. Retry của BullMQ được mô phỏng bằng cách gọi `handle` lại với `attemptsMade` tăng dần.
 *
 * Chạy: npx jest --testRegex ".*\.integration\.spec\.ts$" --testPathIgnorePatterns "/node_modules/" --runInBand push-delivery
 */
import { Logger } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { getConnectionToken, MongooseModule } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { UnrecoverableError } from 'bullmq';
import type { MongoMemoryReplSet } from 'mongodb-memory-server';
import type Redis from 'ioredis';
import { Connection, Types } from 'mongoose';
import { createMemoryReplSet } from '../../../shared/database/memory-replset.util';
import { FeatureFlagModule } from '../../../shared/feature-flags/feature-flag.module';
import { QueueRuntimeService } from '../../../shared/queue/queue-runtime.service';
import { REDIS_CLIENT } from '../../../shared/redis/redis.constants';
import { PiiCryptoService } from '../../crm/common/crypto/pii-crypto.service';
import {
  NotificationPriority,
  NotificationPushStatus,
  NotificationType,
} from '../notification.constants';
import { NotificationDispatcher } from '../notification-dispatcher.service';
import { NotificationsModule } from '../notifications.module';
import * as renderer from './push-content.renderer';
import { buildPushAuthAad } from './push-endpoint.policy';
import { PushQueueWorker } from './push-queue-worker.service';
import {
  PUSH_PROVIDER,
  PushSendResult,
  PushSubscriptionTarget,
} from './push-provider.interface';

// Chỉ bọc `renderPushContent` bằng mock để ép `PushRenderError` ở một ca; renderer thật đã có spec riêng
// (`push-content.renderer.spec.ts`) và mặc định vẫn chạy hàm thật.
jest.mock('./push-content.renderer', () => {
  const actual = jest.requireActual<typeof import('./push-content.renderer')>(
    './push-content.renderer',
  );
  return { ...actual, renderPushContent: jest.fn(actual.renderPushContent) };
});

jest.setTimeout(300_000);

const ATTEMPTS = 5;

describe('T-31 push.send worker (tích hợp)', () => {
  let replSet: MongoMemoryReplSet;
  let moduleRef: TestingModule;
  let connection: Connection;
  let worker: PushQueueWorker;
  let crypto: PiiCryptoService;
  let dispatcher: NotificationDispatcher;
  let redis: Redis;
  const queueAdd = jest.fn();
  /** Kết quả giả theo `endpoint`; không khai báo thì `SENT`. */
  const outcomes = new Map<string, PushSendResult>();
  const sent: Array<{ endpoint: string; auth: string; payload: unknown }> = [];
  let logSpies: jest.SpyInstance[];

  const send = jest.fn(
    (
      subscription: PushSubscriptionTarget,
      payload: unknown,
    ): Promise<PushSendResult> => {
      sent.push({
        endpoint: subscription.endpoint,
        auth: subscription.keys.auth,
        payload,
      });
      return Promise.resolve(
        outcomes.get(subscription.endpoint) ?? {
          outcome: 'SENT',
          statusCode: 201,
        },
      );
    },
  );

  const col = (name: string) => connection.collection(name);

  const createUser = async (status = 'ACTIVE') => {
    const _id = new Types.ObjectId();
    await col('users').insertOne({
      _id,
      status,
      deletedAt: null,
      email: `${String(_id)}@example.test`,
      username: String(_id),
    });
    return _id;
  };

  const createSubscription = async (userId: Types.ObjectId, tag: string) => {
    const _id = new Types.ObjectId();
    const endpoint = `https://fcm.googleapis.com/fcm/send/SECRET-${tag}-${String(_id)}`;
    const endpointHash = `${tag}${String(_id)}`.padEnd(64, '0');
    await col('push_subscriptions').insertOne({
      _id,
      userId,
      endpoint,
      endpointHash,
      keys: {
        p256dh: 'p256dh-public',
        authEnc: crypto.encrypt(
          `auth-${tag}`,
          buildPushAuthAad(String(userId), endpointHash),
        ),
      },
      expirationTime: null,
      platform: 'OTHER',
      deviceLabel: 'Thiết bị thử',
      lastSeenAt: new Date(),
      revokedAt: null,
      revokedReason: null,
      purgeAt: null,
    });
    return { _id, endpoint };
  };

  const createNotification = async (
    userId: Types.ObjectId,
    overrides: Record<string, unknown> = {},
  ) => {
    const _id = new Types.ObjectId();
    await col('notifications').insertOne({
      _id,
      userId,
      type: 'CARE_LOG_ADDED',
      title: 'Nhật ký mới',
      body: 'Nội dung trong app',
      data: { customerId: null, deepLink: '/crm/customers/abc' },
      priority: 'NORMAL',
      readAt: null,
      pushStatus: 'PENDING',
      push: {
        title: 'Có nhật ký chăm sóc mới',
        body: 'Lan vừa ghi nhật ký cho khách Minh.',
        url: '/crm/customers/abc',
      },
      pushGroupKey: null,
      pushSentAt: null,
      dedupeKey: null,
      createdAt: new Date(),
      ...overrides,
    });
    return _id;
  };

  const run = (notificationId: Types.ObjectId, attemptsMade = 0) =>
    worker.handle({
      name: 'push.send',
      data: { notificationId: String(notificationId) },
      attemptsMade,
      opts: { attempts: ATTEMPTS },
    });

  const notificationOf = (id: Types.ObjectId) =>
    col('notifications').findOne({ _id: id });
  const deliveryOf = (id: Types.ObjectId, subscriptionId: Types.ObjectId) =>
    col('push_deliveries').findOne({
      notificationId: id,
      subscriptionId,
    });
  const allLogs = () => logSpies.flatMap((s) => s.mock.calls.flat()).join('\n');

  beforeAll(async () => {
    process.env.FEATURE_CRM_ENABLED = 'true';
    process.env.FEATURE_CRM_PUSH = 'true';
    process.env.CRM_PII_ENCRYPTION_KEY = 'ab'.repeat(32);
    // Khóa Redis riêng cho lần chạy, không đụng khóa của môi trường khác dùng chung Redis.
    process.env.REDIS_KEY_PREFIX = `it-t33-${Date.now()}:`;
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
    crypto = moduleRef.get(PiiCryptoService);
    dispatcher = moduleRef.get(NotificationDispatcher);
    redis = moduleRef.get<Redis>(REDIS_CLIENT);
    await Promise.all(
      connection.modelNames().map((name) => connection.model(name).init()),
    );
  });

  afterAll(async () => {
    delete process.env.FEATURE_CRM_PUSH;
    delete process.env.REDIS_KEY_PREFIX;
    await moduleRef?.close();
    await replSet?.stop();
  });

  beforeEach(() => {
    process.env.FEATURE_CRM_PUSH = 'true';
    outcomes.clear();
    queueAdd.mockReset();
    sent.length = 0;
    send.mockClear();
    logSpies = [
      jest.spyOn(Logger.prototype, 'log').mockImplementation(),
      jest.spyOn(Logger.prototype, 'warn').mockImplementation(),
      jest.spyOn(Logger.prototype, 'error').mockImplementation(),
    ];
  });
  afterEach(() => jest.restoreAllMocks());

  it('SENT: gửi với auth giải mã đúng, delivery SENT, thông báo SENT + pushSentAt, lastSeenAt được làm mới', async () => {
    const userId = await createUser();
    const subscription = await createSubscription(userId, 'a');
    const id = await createNotification(userId);
    const before = new Date(Date.now() - 1000);
    await col('push_subscriptions').updateOne(
      { _id: subscription._id },
      { $set: { lastSeenAt: new Date(0) } },
    );

    await run(id);

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      endpoint: subscription.endpoint,
      auth: 'auth-a',
      payload: {
        title: 'Có nhật ký chăm sóc mới',
        url: '/crm/customers/abc',
        tag: String(id),
        type: 'CARE_LOG_ADDED',
      },
    });
    expect(await notificationOf(id)).toMatchObject({ pushStatus: 'SENT' });
    expect((await notificationOf(id))?.pushSentAt).toBeInstanceOf(Date);
    expect(await deliveryOf(id, subscription._id)).toMatchObject({
      status: 'SENT',
      attempts: 1,
    });
    const refreshed = await col('push_subscriptions').findOne({
      _id: subscription._id,
    });
    expect((refreshed?.lastSeenAt as Date).getTime()).toBeGreaterThan(
      before.getTime(),
    );
  });

  it('chạy lại job đã xong (idempotent): không gửi thêm', async () => {
    const userId = await createUser();
    await createSubscription(userId, 'a');
    const id = await createNotification(userId);
    await run(id);
    await run(id);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('TRANSIENT 5 lần rồi FAILED: 4 lần đầu ném lỗi thường và vẫn PENDING, lần 5 ném UnrecoverableError và FAILED', async () => {
    const userId = await createUser();
    const subscription = await createSubscription(userId, 'a');
    outcomes.set(subscription.endpoint, {
      outcome: 'TRANSIENT',
      statusCode: 503,
    });
    const id = await createNotification(userId);

    for (let attempt = 0; attempt < ATTEMPTS - 1; attempt += 1) {
      const error = await run(id, attempt).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(Error);
      expect(error).not.toBeInstanceOf(UnrecoverableError);
      expect(await notificationOf(id)).toMatchObject({ pushStatus: 'PENDING' });
    }
    await expect(run(id, ATTEMPTS - 1)).rejects.toBeInstanceOf(
      UnrecoverableError,
    );

    expect(send).toHaveBeenCalledTimes(ATTEMPTS);
    expect(await notificationOf(id)).toMatchObject({ pushStatus: 'FAILED' });
    expect(await deliveryOf(id, subscription._id)).toMatchObject({
      status: 'SENDING',
      attempts: ATTEMPTS,
      lastErrorCode: '503',
    });
  });

  it('retry chỉ làm lại thiết bị chưa xong: thiết bị đã SENT không bị gửi lại', async () => {
    const userId = await createUser();
    const ok = await createSubscription(userId, 'ok');
    const flaky = await createSubscription(userId, 'flaky');
    outcomes.set(flaky.endpoint, { outcome: 'TRANSIENT', statusCode: 429 });
    const id = await createNotification(userId);

    await expect(run(id, 0)).rejects.toThrow('PUSH_TRANSIENT');
    outcomes.delete(flaky.endpoint);
    await run(id, 1);

    const okSends = sent.filter((s) => s.endpoint === ok.endpoint);
    const flakySends = sent.filter((s) => s.endpoint === flaky.endpoint);
    expect(okSends).toHaveLength(1);
    expect(flakySends).toHaveLength(2);
    expect(await notificationOf(id)).toMatchObject({ pushStatus: 'SENT' });
  });

  it('A đã SENT, B luôn TRANSIENT, lần cuối: UnrecoverableError, thông báo SENT + pushSentAt', async () => {
    const userId = await createUser();
    await createSubscription(userId, 'ok');
    const flaky = await createSubscription(userId, 'flaky');
    outcomes.set(flaky.endpoint, { outcome: 'TRANSIENT', statusCode: 503 });
    const id = await createNotification(userId);

    await expect(run(id, ATTEMPTS - 1)).rejects.toBeInstanceOf(
      UnrecoverableError,
    );

    const doc = await notificationOf(id);
    expect(doc).toMatchObject({ pushStatus: 'SENT' });
    expect(doc?.pushSentAt).toBeInstanceOf(Date);
  });

  it('còn hàng SENDING dở (chưa hết lần): không chốt, ném lỗi thường; lần cuối mới chốt FAILED', async () => {
    const userId = await createUser();
    const subscription = await createSubscription(userId, 'a');
    const id = await createNotification(userId);
    await col('push_deliveries').insertOne({
      notificationId: id,
      subscriptionId: subscription._id,
      userId,
      status: 'SENDING',
      attempts: 1,
      lastErrorCode: null,
      sentAt: null,
      createdAt: new Date(),
    });
    outcomes.set(subscription.endpoint, { outcome: 'TRANSIENT' });

    const error = await run(id, 0).catch((e: unknown) => e);
    expect(error).not.toBeInstanceOf(UnrecoverableError);
    expect(await notificationOf(id)).toMatchObject({ pushStatus: 'PENDING' });
    await expect(run(id, ATTEMPTS - 1)).rejects.toBeInstanceOf(
      UnrecoverableError,
    );
    expect(await notificationOf(id)).toMatchObject({ pushStatus: 'FAILED' });
  });

  it('GONE (410) thu hồi đúng subscription, thiết bị còn lại vẫn nhận, thông báo SENT', async () => {
    const userId = await createUser();
    const gone = await createSubscription(userId, 'gone');
    const alive = await createSubscription(userId, 'alive');
    outcomes.set(gone.endpoint, { outcome: 'GONE', statusCode: 410 });
    const id = await createNotification(userId);

    await run(id);

    const goneDoc = await col('push_subscriptions').findOne({ _id: gone._id });
    expect(goneDoc).toMatchObject({ revokedReason: 'GONE' });
    expect(goneDoc?.revokedAt).toBeInstanceOf(Date);
    expect(goneDoc?.purgeAt).toBeInstanceOf(Date);
    expect(
      await col('push_subscriptions').findOne({ _id: alive._id }),
    ).toMatchObject({ revokedAt: null });
    expect(await deliveryOf(id, gone._id)).toMatchObject({ status: 'GONE' });
    expect(await deliveryOf(id, alive._id)).toMatchObject({ status: 'SENT' });
    expect(await notificationOf(id)).toMatchObject({ pushStatus: 'SENT' });
  });

  it('chỉ có thiết bị GONE (404): SKIPPED', async () => {
    const userId = await createUser();
    const gone = await createSubscription(userId, 'gone');
    outcomes.set(gone.endpoint, { outcome: 'GONE', statusCode: 404 });
    const id = await createNotification(userId);
    await run(id);
    expect(await notificationOf(id)).toMatchObject({ pushStatus: 'SKIPPED' });
  });

  it('PERMANENT (403): FAILED, không retry (không ném)', async () => {
    const userId = await createUser();
    const subscription = await createSubscription(userId, 'a');
    outcomes.set(subscription.endpoint, {
      outcome: 'PERMANENT',
      statusCode: 403,
    });
    const id = await createNotification(userId);
    await run(id);
    expect(await notificationOf(id)).toMatchObject({ pushStatus: 'FAILED' });
    expect(await deliveryOf(id, subscription._id)).toMatchObject({
      status: 'FAILED',
      lastErrorCode: '403',
    });
  });

  it('người nhận bị khóa: SKIPPED, thu hồi ACCOUNT_DISABLED, không gửi', async () => {
    const userId = await createUser('BLOCKED');
    const subscription = await createSubscription(userId, 'a');
    const id = await createNotification(userId);
    await run(id);
    expect(send).not.toHaveBeenCalled();
    expect(await notificationOf(id)).toMatchObject({ pushStatus: 'SKIPPED' });
    expect(
      await col('push_subscriptions').findOne({ _id: subscription._id }),
    ).toMatchObject({ revokedReason: 'ACCOUNT_DISABLED' });
  });

  it('cài đặt tắt push của loại: SKIPPED, không gửi', async () => {
    const userId = await createUser();
    await createSubscription(userId, 'a');
    await col('notification_preferences').insertOne({
      userId,
      types: { CARE_LOG_ADDED: { push: false, inApp: true } },
      quietHours: null,
    });
    const id = await createNotification(userId);
    await run(id);
    expect(send).not.toHaveBeenCalled();
    expect(await notificationOf(id)).toMatchObject({ pushStatus: 'SKIPPED' });
  });

  it('trong giờ yên lặng: SKIPPED; ngoài khung: gửi', async () => {
    const vnNow = new Date(Date.now() + 7 * 3600 * 1000);
    const hhmm = (offsetMinutes: number) => {
      const d = new Date(vnNow.getTime() + offsetMinutes * 60_000);
      return d.toISOString().slice(11, 16);
    };
    const quietUser = await createUser();
    await createSubscription(quietUser, 'q');
    await col('notification_preferences').insertOne({
      userId: quietUser,
      types: {},
      // Khung 2 giờ bao quanh hiện tại (xử lý được cả qua nửa đêm).
      quietHours: { start: hhmm(-60), end: hhmm(60) },
    });
    const quietId = await createNotification(quietUser);
    await run(quietId);
    expect(await notificationOf(quietId)).toMatchObject({
      pushStatus: 'SKIPPED',
    });
    expect(send).not.toHaveBeenCalled();

    const openUser = await createUser();
    await createSubscription(openUser, 'o');
    await col('notification_preferences').insertOne({
      userId: openUser,
      types: {},
      quietHours: { start: hhmm(120), end: hhmm(180) },
    });
    const openId = await createNotification(openUser);
    await run(openId);
    expect(await notificationOf(openId)).toMatchObject({ pushStatus: 'SENT' });
  });

  it('cờ tắt: SKIPPED, không gửi', async () => {
    process.env.FEATURE_CRM_PUSH = 'false';
    const userId = await createUser();
    await createSubscription(userId, 'a');
    const id = await createNotification(userId);
    await run(id);
    expect(send).not.toHaveBeenCalled();
    expect(await notificationOf(id)).toMatchObject({ pushStatus: 'SKIPPED' });
  });

  it('không có subscription hiệu lực: SKIPPED; chỉ lấy tối đa 3 thiết bị mới hoạt động nhất', async () => {
    const none = await createUser();
    const noneId = await createNotification(none);
    await run(noneId);
    expect(await notificationOf(noneId)).toMatchObject({
      pushStatus: 'SKIPPED',
    });

    const userId = await createUser();
    for (const tag of ['a', 'b', 'c', 'd']) {
      const subscription = await createSubscription(userId, tag);
      await col('push_subscriptions').updateOne(
        { _id: subscription._id },
        { $set: { lastSeenAt: new Date(tag === 'a' ? 0 : Date.now()) } },
      );
    }
    const id = await createNotification(userId);
    await run(id);
    expect(send).toHaveBeenCalledTimes(3);
    expect(sent.some((s) => s.auth === 'auth-a')).toBe(false);
  });

  it('thông báo không còn PENDING hoặc đã xóa: không gửi, không đổi trạng thái', async () => {
    const userId = await createUser();
    await createSubscription(userId, 'a');
    const done = await createNotification(userId, { pushStatus: 'SENT' });
    await run(done);
    await run(new Types.ObjectId());
    expect(send).not.toHaveBeenCalled();
    expect(await notificationOf(done)).toMatchObject({ pushStatus: 'SENT' });
  });

  it('PushRenderError (push chưa dựng + loại biến lạ): chỉ chạy một lần, UnrecoverableError, FAILED, log không PII', async () => {
    const userId = await createUser();
    await createSubscription(userId, 'a');
    // Loại không thuộc danh mục sẽ rơi về nội dung dự phòng; ép lỗi lập trình bằng renderer ném lỗi.
    (renderer.renderPushContent as jest.Mock).mockImplementationOnce(() => {
      throw new renderer.PushRenderError('biến lạ Nguyễn Văn A 0901234567');
    });
    const id = await createNotification(userId, { push: null });

    await expect(run(id, 0)).rejects.toBeInstanceOf(UnrecoverableError);

    expect(send).not.toHaveBeenCalled();
    expect(await notificationOf(id)).toMatchObject({ pushStatus: 'FAILED' });
    expect(allLogs()).toContain(`notificationId=${String(id)}`);
    expect(allLogs()).not.toContain('Nguyễn');
    expect(allLogs()).not.toContain('0901234567');
  });

  it('log không chứa endpoint thô, payload, tên khách; có notificationId, subscriptionId, endpointHash, mã', async () => {
    const userId = await createUser();
    const subscription = await createSubscription(userId, 'a');
    const id = await createNotification(userId);
    await run(id);
    const all = allLogs();
    expect(all).toContain(`notificationId=${String(id)}`);
    expect(all).toContain(`subscriptionId=${String(subscription._id)}`);
    expect(all).toContain('endpointHash=');
    expect(all).toContain('result=SENT');
    expect(all).not.toContain('SECRET-');
    expect(all).not.toContain('fcm.googleapis.com');
    expect(all).not.toContain('Minh');
    expect(all).not.toContain('auth-a');
  });

  describe('T-33 giới hạn 3 push/người/đợt hàng loạt (Redis thật)', () => {
    /** Mô phỏng `ASSIGN` hàng loạt: mỗi khách một yêu cầu `BULK_ADD`, cùng `groupKey` và cùng người nhận. */
    const bulkAssign = async (
      recipientId: Types.ObjectId,
      groupKey: string,
      customers: number,
    ): Promise<Types.ObjectId[]> => {
      queueAdd.mockClear();
      const tag = new Types.ObjectId().toHexString();
      for (let index = 0; index < customers; index += 1) {
        const customerId = new Types.ObjectId();
        await dispatcher.dispatch([
          {
            type: NotificationType.CUSTOMER_ASSIGNED,
            recipientIds: [recipientId],
            inApp: {
              title: 'Bạn được thêm vào nhóm chăm sóc',
              body: `Khách số ${index + 1}`,
              priority: NotificationPriority.NORMAL,
            },
            vars: { actorName: 'Lan', customerName: `Khách ${index + 1}` },
            data: {
              customerId,
              deepLink: `/crm/customers/${String(customerId)}`,
            },
            context: { careRole: 'MEMBER', origin: 'BULK_ADD', groupKey },
            dedupeKey: `T33:${tag}:${String(customerId)}`,
          },
        ]);
      }
      return queueAdd.mock.calls.map(
        (call) =>
          new Types.ObjectId(
            (call[2] as { notificationId: string }).notificationId,
          ),
      );
    };

    const statuses = async (ids: Types.ObjectId[]) =>
      (
        await col('notifications')
          .find({ _id: { $in: ids } })
          .toArray()
      ).map((doc) => doc.pushStatus as string);
    const counter = (userId: Types.ObjectId, groupKey: string) =>
      redis.get(`push:group:${String(userId)}:${groupKey}`);

    it('bulk ASSIGN 6 khách cho cùng một người: đúng 3 push, 3 còn lại SKIPPED, đủ 6 thông báo trong hộp', async () => {
      const userId = await createUser();
      await createSubscription(userId, 'a');
      const ids = await bulkAssign(userId, 'BULK:req-6', 6);
      expect(ids).toHaveLength(6);

      for (const id of ids) await run(id);

      expect(send).toHaveBeenCalledTimes(3);
      const result = await statuses(ids);
      expect(result.filter((x) => x === 'SENT')).toHaveLength(3);
      expect(result.filter((x) => x === 'SKIPPED')).toHaveLength(3);
      expect(await col('notifications').countDocuments({ userId })).toBe(6);
      expect(await counter(userId, 'BULK:req-6')).toBe('6');
      // Phần bị bỏ qua không claim, không gọi nhà cung cấp.
      expect(await col('push_deliveries').countDocuments({ userId })).toBe(3);
    });

    it('chạy lại job đã xong sau khi vượt hạn mức: không gửi thêm, không đếm lại', async () => {
      const userId = await createUser();
      await createSubscription(userId, 'a');
      const ids = await bulkAssign(userId, 'BULK:rerun', 4);
      for (const id of ids) await run(id);
      for (const id of ids) await run(id);
      expect(send).toHaveBeenCalledTimes(3);
      expect(await counter(userId, 'BULK:rerun')).toBe('4');
    });

    it('đợt khác dùng bộ đếm khác; người khác trong cùng đợt có bộ đếm riêng', async () => {
      const userId = await createUser();
      const otherId = await createUser();
      await createSubscription(userId, 'a');
      await createSubscription(otherId, 'b');

      for (const id of await bulkAssign(userId, 'BULK:batch-1', 4)) {
        await run(id);
      }
      expect(send).toHaveBeenCalledTimes(3);

      for (const id of await bulkAssign(userId, 'BULK:batch-2', 4)) {
        await run(id);
      }
      expect(send).toHaveBeenCalledTimes(6);

      for (const id of await bulkAssign(otherId, 'BULK:batch-1', 4)) {
        await run(id);
      }
      expect(send).toHaveBeenCalledTimes(9);

      expect(await counter(userId, 'BULK:batch-1')).toBe('4');
      expect(await counter(userId, 'BULK:batch-2')).toBe('4');
      expect(await counter(otherId, 'BULK:batch-1')).toBe('4');
    });

    it('bộ đếm có hạn 10 phút (EXPIRE)', async () => {
      const userId = await createUser();
      await createSubscription(userId, 'a');
      const [id] = await bulkAssign(userId, 'BULK:ttl', 1);
      await run(id);
      const ttl = await redis.ttl(`push:group:${String(userId)}:BULK:ttl`);
      expect(ttl).toBeGreaterThan(590);
      expect(ttl).toBeLessThanOrEqual(600);
    });

    it('retry của cùng một thông báo (TRANSIENT) không tăng bộ đếm lần hai', async () => {
      const userId = await createUser();
      const subscription = await createSubscription(userId, 'a');
      outcomes.set(subscription.endpoint, {
        outcome: 'TRANSIENT',
        statusCode: 503,
      });
      const [id] = await bulkAssign(userId, 'BULK:retry', 1);

      await expect(run(id, 0)).rejects.toThrow('PUSH_TRANSIENT');
      await expect(run(id, 1)).rejects.toThrow('PUSH_TRANSIENT');
      outcomes.delete(subscription.endpoint);
      await run(id, 2);

      expect(await counter(userId, 'BULK:retry')).toBe('1');
      expect(await notificationOf(id)).toMatchObject({ pushStatus: 'SENT' });
    });

    it('retry của thông báo bị vượt hạn mức vẫn bị chặn (quyết định được nhớ theo thông báo)', async () => {
      const userId = await createUser();
      await createSubscription(userId, 'a');
      const ids = await bulkAssign(userId, 'BULK:memo', 4);
      for (const id of ids) await run(id);
      const skipped = (await statuses(ids)).indexOf('SKIPPED');
      expect(skipped).toBe(3);
      // Ép thông báo thứ 4 về PENDING như thể sweep xếp lại: vẫn SKIPPED, bộ đếm giữ nguyên 4.
      await col('notifications').updateOne(
        { _id: ids[3] },
        { $set: { pushStatus: 'PENDING' } },
      );
      await run(ids[3]);
      expect(await notificationOf(ids[3])).toMatchObject({
        pushStatus: 'SKIPPED',
      });
      expect(send).toHaveBeenCalledTimes(3);
      expect(await counter(userId, 'BULK:memo')).toBe('4');
    });

    it('không có thiết bị: SKIPPED trước khi tiêu hạn mức', async () => {
      const userId = await createUser();
      const ids = await bulkAssign(userId, 'BULK:no-device', 2);
      for (const id of ids) await run(id);
      expect(await statuses(ids)).toEqual(['SKIPPED', 'SKIPPED']);
      expect(await counter(userId, 'BULK:no-device')).toBeNull();
    });

    it('thông báo không thuộc đợt (không pushGroupKey): không giới hạn', async () => {
      const userId = await createUser();
      await createSubscription(userId, 'a');
      const ids: Types.ObjectId[] = [];
      for (let index = 0; index < 5; index += 1) {
        ids.push(await createNotification(userId));
      }
      for (const id of ids) await run(id);
      expect(send).toHaveBeenCalledTimes(5);
    });

    it('Redis lỗi: không chặn, vẫn gửi cả 5 thông báo (fail-open), job không ném', async () => {
      const userId = await createUser();
      await createSubscription(userId, 'a');
      const ids = await bulkAssign(userId, 'BULK:redis-down', 5);
      const spy = jest
        .spyOn(redis, 'eval')
        .mockRejectedValue(new Error('Command timed out'));

      for (const id of ids) await expect(run(id)).resolves.toBeUndefined();

      expect(spy).toHaveBeenCalledTimes(5);
      expect(send).toHaveBeenCalledTimes(5);
      expect(await statuses(ids)).toEqual(Array(5).fill('SENT'));
      expect(allLogs()).not.toContain('redis-down');
    });
  });
});
