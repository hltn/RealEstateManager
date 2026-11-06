/**
 * INTEGRATION — T-31 worker `push.send` (`PushDeliveryProcessor` qua router `PushQueueWorker.handle`) trên MongoDB
 * Replica Set thật (mongodb-memory-server). Nhà cung cấp push là bản giả (không gọi mạng), hàng đợi BullMQ là bản giả
 * (không cần Redis). Retry của BullMQ được mô phỏng bằng cách gọi `handle` lại với `attemptsMade` tăng dần.
 *
 * Chạy: npx jest --testRegex ".*\.integration\.spec\.ts$" --testPathIgnorePatterns "/node_modules/" --runInBand push-delivery
 */
import { Logger } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { getConnectionToken, MongooseModule } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { UnrecoverableError } from 'bullmq';
import type { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Connection, Types } from 'mongoose';
import { createMemoryReplSet } from '../../../shared/database/memory-replset.util';
import { FeatureFlagModule } from '../../../shared/feature-flags/feature-flag.module';
import { QueueRuntimeService } from '../../../shared/queue/queue-runtime.service';
import { PiiCryptoService } from '../../crm/common/crypto/pii-crypto.service';
import { NotificationPushStatus } from '../notification.constants';
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
        add: jest.fn(),
        registerWorker: jest.fn(),
        upsertSchedulers: jest.fn().mockResolvedValue(undefined),
      })
      .compile();
    await moduleRef.init();
    connection = moduleRef.get<Connection>(getConnectionToken());
    worker = moduleRef.get(PushQueueWorker);
    crypto = moduleRef.get(PiiCryptoService);
    await Promise.all(
      connection.modelNames().map((name) => connection.model(name).init()),
    );
  });

  afterAll(async () => {
    delete process.env.FEATURE_CRM_PUSH;
    await moduleRef?.close();
    await replSet?.stop();
  });

  beforeEach(() => {
    process.env.FEATURE_CRM_PUSH = 'true';
    outcomes.clear();
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
});
