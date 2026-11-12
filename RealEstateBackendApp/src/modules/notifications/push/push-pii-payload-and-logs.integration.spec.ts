/**
 * INTEGRATION — T-38 (2/3 và 3/3): payload push THẬT do Dispatcher + worker dựng không chứa PII, và log của luồng push
 * (Dispatcher, processor `push.send`, limiter, sweep, cleanup) không chứa PII/endpoint thô (FR-06, FR-12).
 *
 * Chạy trên MongoDB Replica Set thật (mongodb-memory-server) với `NotificationsModule` thật. Nhà cung cấp push và
 * hàng đợi BullMQ là bản giả (không gọi mạng), Redis là bản giả (`createRedisClientStub`) nên KHÔNG cần Redis thật,
 * không đụng dev/prod. Worker được gọi qua `PushQueueWorker.handle` như BullMQ gọi.
 *
 * Chống tautology: bẫy PII đi vào hệ thống qua đúng đường nghiệp vụ (`vars` của `NotificationRequest`, `inApp`,
 * `deepLink`), đầu ra đọc từ DB và từ lời gọi `provider.send` thật; so với chuỗi bẫy gốc, không so với chính
 * `redactPii`. Có ca đối chứng (dữ liệu sạch phải ra đúng mẫu) và kiểm log không rỗng.
 *
 * Chạy: npx jest --testRegex "push-pii-payload-and-logs.integration.spec" --testPathIgnorePatterns /node_modules/ --runInBand --forceExit
 */
import { Logger } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { getConnectionToken, MongooseModule } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import type { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Connection, Types } from 'mongoose';
import { redactPii } from '../../../common/logger/pii-redactor.util';
import { createMemoryReplSet } from '../../../shared/database/memory-replset.util';
import { FeatureFlagModule } from '../../../shared/feature-flags/feature-flag.module';
import { QueueRuntimeService } from '../../../shared/queue/queue-runtime.service';
import { REDIS_CLIENT } from '../../../shared/redis/redis.constants';
import { createRedisClientStub } from '../../../shared/redis/redis-client.fixture';
import { PiiCryptoService } from '../../crm/common/crypto/pii-crypto.service';
import {
  NotificationPriority,
  NotificationPushStatus,
  NotificationType,
} from '../notification.constants';
import {
  NotificationDispatcher,
  NotificationRequest,
} from '../notification-dispatcher.service';
import { NotificationsModule } from '../notifications.module';
import {
  PUSH_CATALOG,
  PUSH_FALLBACK_BODY,
  PUSH_FALLBACK_TITLE,
  PushContext,
  PushVarName,
} from './push-catalog';
import { PushRenderError } from './push-content.renderer';
import { PushCleanupService } from './push-cleanup.service';
import { buildPushAuthAad } from './push-endpoint.policy';
import { PushQueueWorker } from './push-queue-worker.service';
import {
  PUSH_PROVIDER,
  PushPayload,
  PushSendOptions,
  PushSendResult,
  PushSubscriptionTarget,
} from './push-provider.interface';
import { PushSweepService } from './push-sweep.service';

jest.setTimeout(300_000);

const ATTEMPTS = 5;
const DAY_MS = 24 * 60 * 60 * 1000;
/** Nội dung nhật ký/ghi chú/lời nhắn: chỉ được nằm ở hộp thông báo trong app, KHÔNG được sang push. */
const SECRET_NOTE =
  'NHATKY-BIMAT khách vay 2 tỷ, nợ xấu, SĐT 0912345678, CCCD 012345678901, mail kin@gmail.com';
const SECRET_REQUEST_ID = 'req-SECRETREQ-7f3a9c';
const GROUP_KEY = `BULK:${SECRET_REQUEST_ID}`;
const CLEAN_NAME = 'Nguyễn Văn Minh';
const CLEAN_ACTOR = 'Trần Thị Lan';

/** Giá trị sạch cho từng biến. */
const CLEAN: Record<PushVarName, string> = {
  customerName: CLEAN_NAME,
  actorName: CLEAN_ACTOR,
  appointmentTypeLabel: 'Xem nhà',
  appointmentTimeLabel: '09:30 07/11',
  newStatusLabel: 'Đã đặt cọc',
};

/** Ngữ cảnh để `pushWhen` của từng loại cho phép push. */
const CONTEXT: Partial<Record<NotificationType, PushContext>> = {
  [NotificationType.CUSTOMER_ASSIGNED]: {
    careRole: 'MEMBER',
    origin: 'TEAM_ADD',
  },
};

const TRAPS: Array<{ name: string; value: string; pieces: string[] }> = [
  { name: 'SĐT', value: 'Lan 0912345678', pieces: ['0912345678'] },
  { name: 'CCCD', value: 'Hà 012345678901', pieces: ['012345678901'] },
  { name: 'email', value: 'Linh lan@gmail.com', pieces: ['lan@gmail.com'] },
  {
    name: 'SĐT +84 có cách',
    value: 'An +84 912 345 678',
    pieces: ['912 345 678'],
  },
];

describe('T-38 PII của payload push thật và log luồng push (tích hợp)', () => {
  let replSet: MongoMemoryReplSet;
  let moduleRef: TestingModule;
  let connection: Connection;
  let dispatcher: NotificationDispatcher;
  let worker: PushQueueWorker;
  let sweep: PushSweepService;
  let cleanup: PushCleanupService;
  let crypto: PiiCryptoService;
  let redisStub: ReturnType<typeof createRedisClientStub>;
  const queueAdd = jest.fn();
  const queueGetJob = jest.fn();
  const outcomes = new Map<string, PushSendResult>();
  const throwing = new Set<string>();
  const sent: Array<{
    endpoint: string;
    auth: string;
    p256dh: string;
    payload: PushPayload;
    options: PushSendOptions;
  }> = [];
  let logSpies: jest.SpyInstance[];

  const send = jest.fn(
    (
      subscription: PushSubscriptionTarget,
      payload: PushPayload,
      options: PushSendOptions,
    ): Promise<PushSendResult> => {
      sent.push({
        endpoint: subscription.endpoint,
        auth: subscription.keys.auth,
        p256dh: subscription.keys.p256dh,
        payload,
        options,
      });
      if (throwing.has(subscription.endpoint)) {
        // Lỗi "độc": thông điệp chứa endpoint và nội dung push. Processor không được ghi `error.message`.
        throw new Error(
          `boom ${subscription.endpoint} ${payload.body} ${subscription.keys.auth}`,
        );
      }
      return Promise.resolve(
        outcomes.get(subscription.endpoint) ?? {
          outcome: 'SENT',
          statusCode: 201,
        },
      );
    },
  );

  const col = (name: string) => connection.collection(name);
  const allLogs = () =>
    logSpies.flatMap((spy) => spy.mock.calls.flat()).join('\n');

  const createUser = async (
    overrides: Record<string, unknown> = {},
  ): Promise<Types.ObjectId> => {
    const _id = new Types.ObjectId();
    await col('users').insertOne({
      _id,
      status: 'ACTIVE',
      deletedAt: null,
      email: `${String(_id)}@example.test`,
      username: String(_id),
      ...overrides,
    });
    return _id;
  };

  const createSubscription = async (userId: Types.ObjectId, tag: string) => {
    const _id = new Types.ObjectId();
    const endpoint = `https://fcm.googleapis.com/fcm/send/SECRETENDPOINT-${tag}-${String(_id)}`;
    const endpointHash = `${String(_id)}${tag}`.padEnd(64, 'a');
    await col('push_subscriptions').insertOne({
      _id,
      userId,
      endpoint,
      endpointHash,
      keys: {
        p256dh: `P256DHSECRET-${tag}`,
        authEnc: crypto.encrypt(
          `AUTHSECRET-${tag}`,
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

  /** Người nhận ACTIVE có một thiết bị. */
  const seedRecipient = async (tag = 'a') => {
    const userId = await createUser();
    const subscription = await createSubscription(userId, tag);
    return { userId, subscription };
  };

  const varsFor = (
    type: NotificationType,
    overrides: Partial<Record<PushVarName, string>> = {},
  ): Partial<Record<PushVarName, string>> => {
    const entry = PUSH_CATALOG.find((e) => e.type === type);
    const vars: Partial<Record<PushVarName, string>> = {};
    for (const name of entry?.allowedVars ?? []) {
      vars[name] = overrides[name] ?? CLEAN[name];
    }
    return vars;
  };

  let seq = 0;
  const buildRequest = (
    type: NotificationType,
    recipientId: Types.ObjectId,
    extra: Partial<NotificationRequest> = {},
  ): NotificationRequest => {
    const customerId = new Types.ObjectId();
    return {
      type,
      recipientIds: [recipientId],
      inApp: {
        title: 'Thông báo trong app',
        // Nội dung nghiệp vụ nhạy cảm của hộp thông báo; push không được lấy từ đây.
        body: SECRET_NOTE,
        priority: NotificationPriority.NORMAL,
      },
      vars: varsFor(type),
      data: { customerId, deepLink: `/crm/customers/${String(customerId)}` },
      context: CONTEXT[type],
      dedupeKey: `t38:${type}:${(seq += 1)}:${String(recipientId)}`,
      ...extra,
    };
  };

  /** Dispatcher ghi, worker gửi; trả thông báo đã lưu và payload thật đã tới `provider.send`. */
  const dispatchAndSend = async (request: NotificationRequest) => {
    const { created } = await dispatcher.dispatch([request]);
    expect(created).toBe(1);
    const stored = await col('notifications').findOne({
      userId: request.recipientIds[0],
      dedupeKey: request.dedupeKey,
    });
    expect(stored).not.toBeNull();
    await runWorker(stored!._id);
    return { stored: stored!, sent: [...sent] };
  };

  const runWorker = async (notificationId: Types.ObjectId, attemptsMade = 0) =>
    worker.handle({
      name: 'push.send',
      data: { notificationId: String(notificationId) },
      attemptsMade,
      opts: { attempts: ATTEMPTS },
    });

  /** Mọi dấu vết bẫy phải biến mất khỏi một đoạn văn bản đầu ra. */
  const expectClean = (text: string, pieces: string[] = []) => {
    expect(redactPii(text)).toBe(text);
    for (const piece of [
      ...pieces,
      'NHATKY-BIMAT',
      '2 tỷ',
      '0912345678',
      '012345678901',
      'kin@gmail.com',
    ]) {
      expect(text).not.toContain(piece);
    }
  };

  beforeAll(async () => {
    process.env.FEATURE_CRM_ENABLED = 'true';
    process.env.FEATURE_CRM_PUSH = 'true';
    process.env.CRM_PII_ENCRYPTION_KEY = 'ab'.repeat(32);
    replSet = await createMemoryReplSet();
    redisStub = createRedisClientStub();
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
        getJob: queueGetJob,
        registerWorker: jest.fn(),
        upsertSchedulers: jest.fn().mockResolvedValue(undefined),
      })
      .overrideProvider(REDIS_CLIENT)
      .useValue(redisStub)
      .compile();
    await moduleRef.init();
    connection = moduleRef.get<Connection>(getConnectionToken());
    dispatcher = moduleRef.get(NotificationDispatcher);
    worker = moduleRef.get(PushQueueWorker);
    sweep = moduleRef.get(PushSweepService);
    cleanup = moduleRef.get(PushCleanupService);
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

  beforeEach(async () => {
    process.env.FEATURE_CRM_PUSH = 'true';
    await Promise.all(
      [
        'notifications',
        'push_deliveries',
        'push_subscriptions',
        'users',
        'notification_preferences',
      ].map((name) => col(name).deleteMany({})),
    );
    outcomes.clear();
    throwing.clear();
    sent.length = 0;
    send.mockClear();
    queueAdd.mockReset();
    queueAdd.mockResolvedValue(undefined);
    queueGetJob.mockReset();
    queueGetJob.mockResolvedValue(null);
    redisStub.eval.mockReset();
    redisStub.eval.mockResolvedValue(1);
    logSpies = [
      jest.spyOn(Logger.prototype, 'log').mockImplementation(),
      jest.spyOn(Logger.prototype, 'warn').mockImplementation(),
      jest.spyOn(Logger.prototype, 'error').mockImplementation(),
      jest.spyOn(Logger.prototype, 'debug').mockImplementation(),
      jest.spyOn(Logger.prototype, 'verbose').mockImplementation(),
    ];
  });

  afterEach(() => jest.restoreAllMocks());

  describe('payload thật: dữ liệu bẫy đi qua Dispatcher + worker', () => {
    it('đối chứng: dữ liệu sạch ra ĐÚNG mẫu của từng loại (không rơi về dự phòng), nội dung nhật ký chỉ ở hộp thông báo', async () => {
      for (const entry of PUSH_CATALOG) {
        sent.length = 0;
        const { userId } = await seedRecipient(entry.type.slice(0, 3));
        const result = await dispatchAndSend(buildRequest(entry.type, userId));

        // Hộp thông báo trong app giữ nguyên nội dung nghiệp vụ (chứng tỏ bẫy có đi vào hệ thống).
        expect(result.stored.body).toBe(SECRET_NOTE);
        expect(
          (await col('notifications').findOne({ _id: result.stored._id }))
            ?.pushStatus,
        ).toBe('SENT');
        expect(result.sent).toHaveLength(1);
        const payload = result.sent[0].payload;
        expect(payload.title).not.toBe(PUSH_FALLBACK_TITLE);
        expect(payload.title).toBe(entry.titleTemplate);
        expect(payload.body).toContain(CLEAN_NAME);
        expect(payload.type).toBe(entry.type);
        expect(payload.url).toBe(
          `/crm/customers/${String(result.stored.data.customerId)}`,
        );
        expectClean(`${payload.title}\n${payload.body}\n${payload.url}`);
      }
    });

    it('payload chỉ gồm 5 trường title/body/url/tag/type; tag = id thông báo; không lộ endpoint/khóa/userId/inApp', async () => {
      const { userId, subscription } = await seedRecipient();
      const { stored, sent: calls } = await dispatchAndSend(
        buildRequest(NotificationType.CARE_LOG_ADDED, userId),
      );
      const payload = calls[0].payload;
      expect(Object.keys(payload).sort()).toEqual([
        'body',
        'tag',
        'title',
        'type',
        'url',
      ]);
      expect(payload.tag).toBe(String(stored._id));
      const json = JSON.stringify(payload);
      for (const secret of [
        subscription.endpoint,
        'SECRETENDPOINT',
        'AUTHSECRET',
        'P256DHSECRET',
        String(userId),
        'Thông báo trong app',
      ]) {
        expect(json).not.toContain(secret);
      }
      // Tùy chọn gửi cũng không mang nội dung.
      expect(JSON.stringify(calls[0].options)).not.toMatch(/NHATKY|0912/);
    });

    const matrix = PUSH_CATALOG.flatMap((entry) =>
      TRAPS.map((trap) => [entry.type, trap.name, trap] as const),
    );

    it.each(matrix)(
      '%s / bẫy %s trong tên khách: push lưu và push gửi đều là nội dung chung',
      async (type, _name, trap) => {
        const { userId } = await seedRecipient();
        const request = buildRequest(type, userId, {
          vars: varsFor(type, { customerName: trap.value }),
        });
        const { stored, sent: calls } = await dispatchAndSend(request);

        // Lưu trong DB (do Dispatcher dựng).
        expect(stored.push.title).toBe(PUSH_FALLBACK_TITLE);
        expect(stored.push.body).toBe(PUSH_FALLBACK_BODY);
        expectClean(JSON.stringify(stored.push), trap.pieces);
        // Gửi thật (do worker lấy ra).
        expect(calls).toHaveLength(1);
        expect(calls[0].payload.title).toBe(PUSH_FALLBACK_TITLE);
        expect(calls[0].payload.body).toBe(PUSH_FALLBACK_BODY);
        expectClean(JSON.stringify(calls[0].payload), trap.pieces);
        // Giữ đúng loại và url nội bộ theo id khách để bấm vào vẫn mở đúng khách.
        expect(calls[0].payload.type).toBe(type);
        expect(calls[0].payload.url).toBe(
          `/crm/customers/${String(stored.data.customerId)}`,
        );
        // Trạng thái vẫn SENT: PII bị chặn không làm mất thông báo.
        expect(stored.pushStatus).toBe('PENDING');
        expect(
          (await col('notifications').findOne({ _id: stored._id }))?.pushStatus,
        ).toBe('SENT');
      },
    );

    it('bẫy ở tên người thực hiện (actorName) cũng bị chặn', async () => {
      const { userId } = await seedRecipient();
      const { calls } = await (async () => {
        const result = await dispatchAndSend(
          buildRequest(NotificationType.CARE_LOG_ADDED, userId, {
            vars: varsFor(NotificationType.CARE_LOG_ADDED, {
              actorName: 'Hùng 0912345678',
            }),
          }),
        );
        return { calls: result.sent };
      })();
      expectClean(JSON.stringify(calls[0].payload));
      expect(calls[0].payload.body).toBe(PUSH_FALLBACK_BODY);
    });

    it('deepLink mang PII (query) bị bỏ, url rơi về mẫu + id khách', async () => {
      const { userId } = await seedRecipient();
      const customerId = new Types.ObjectId();
      const { sent: calls } = await dispatchAndSend(
        buildRequest(NotificationType.CARE_LOG_ADDED, userId, {
          data: {
            customerId,
            deepLink: '/crm/customers/x?phone=0912345678&mail=kin@gmail.com',
          },
        }),
      );
      expect(calls[0].payload.url).toBe(`/crm/customers/${String(customerId)}`);
      expectClean(calls[0].payload.url);
    });

    it('thông báo cũ chưa có nội dung push dựng sẵn: worker dựng lại KHÔNG biến, ra nội dung chung', async () => {
      const { userId } = await seedRecipient();
      const _id = new Types.ObjectId();
      await col('notifications').insertOne({
        _id,
        userId,
        type: 'CARE_LOG_ADDED',
        title: 'Cũ',
        body: SECRET_NOTE,
        data: {
          customerId: new Types.ObjectId(),
          deepLink: '/crm/customers/z',
        },
        priority: 'NORMAL',
        readAt: null,
        pushStatus: 'PENDING',
        push: null,
        pushGroupKey: null,
        pushSentAt: null,
        dedupeKey: null,
        createdAt: new Date(),
      });
      await runWorker(_id);
      expect(sent).toHaveLength(1);
      expect(sent[0].payload.title).toBe(PUSH_FALLBACK_TITLE);
      expect(sent[0].payload.body).toBe(PUSH_FALLBACK_BODY);
      expectClean(JSON.stringify(sent[0].payload));
    });

    it('biến ngoài danh sách đóng (nội dung nhật ký/ghi chú/lời nhắn/SĐT) bị Dispatcher từ chối, không ghi gì và không xếp job', async () => {
      const { userId } = await seedRecipient();
      for (const forbidden of [
        'careLogContent',
        'note',
        'message',
        'customerPhone',
        'resultNote',
      ]) {
        const request = buildRequest(NotificationType.CARE_LOG_ADDED, userId, {
          vars: {
            ...varsFor(NotificationType.CARE_LOG_ADDED),
            [forbidden]: SECRET_NOTE,
          } as Partial<Record<PushVarName, string>>,
        });
        await expect(dispatcher.dispatch([request])).rejects.toBeInstanceOf(
          PushRenderError,
        );
      }
      expect(await col('notifications').countDocuments()).toBe(0);
      expect(queueAdd).not.toHaveBeenCalled();
      // Thông báo lỗi và log không mang nội dung bẫy.
      expectClean(allLogs());
    });

    it('loại ngoài danh mục (SECURITY_ALERT, STALE_CUSTOMER) không có push dù nội dung app chứa PII: không lưu nội dung push, worker không gửi', async () => {
      const admin = await createUser({ roles: ['ADMIN'], status: 'ACTIVE' });
      await createSubscription(admin, 'adm');
      const created = await dispatcher.notifyAdmins({
        type: NotificationType.SECURITY_ALERT,
        inApp: { title: 'Cảnh báo', body: SECRET_NOTE },
        data: { deepLink: '/crm/security' },
        dedupeKey: 't38:security:1',
      });
      expect(created).toBe(1);
      const stored = await col('notifications').findOne({ userId: admin });
      expect(stored).toMatchObject({ pushStatus: 'SKIPPED', push: null });
      await runWorker(stored!._id);
      expect(send).not.toHaveBeenCalled();
    });
  });

  describe('log luồng push không chứa PII/endpoint thô', () => {
    /** Mọi thứ nhạy cảm của kịch bản: không được xuất hiện ở bất kỳ dòng log nào. */
    const FORBIDDEN_IN_LOGS = [
      'SECRETENDPOINT',
      'fcm.googleapis.com',
      'AUTHSECRET',
      'P256DHSECRET',
      SECRET_REQUEST_ID,
      GROUP_KEY,
      'NHATKY-BIMAT',
      '0912345678',
      '012345678901',
      'kin@gmail.com',
      'boom',
      CLEAN_NAME,
      CLEAN_ACTOR,
    ];
    const expectLogsClean = () => {
      const logs = allLogs();
      for (const secret of FORBIDDEN_IN_LOGS) {
        expect(logs).not.toContain(secret);
      }
      expect(redactPii(logs)).toBe(logs);
    };

    it('Dispatcher + processor: mọi kết quả (SENT, GONE, PERMANENT, TRANSIENT, provider ném, giải mã lỗi, người nhận bị khóa, PII bị chặn) chỉ log id/mã/endpointHash', async () => {
      // SENT với tên khách là bẫy (renderer ghi log ERROR "phát hiện PII").
      const sentCase = await seedRecipient('s');
      await dispatchAndSend(
        buildRequest(NotificationType.CARE_LOG_ADDED, sentCase.userId, {
          vars: varsFor(NotificationType.CARE_LOG_ADDED, {
            customerName: 'Lan 0912345678',
          }),
        }),
      );
      // Dữ liệu sạch (tên khách thật không được vào log).
      const clean = await seedRecipient('c');
      await dispatchAndSend(
        buildRequest(NotificationType.APPOINTMENT_DUE, clean.userId),
      );
      // GONE.
      const gone = await seedRecipient('g');
      outcomes.set(gone.subscription.endpoint, {
        outcome: 'GONE',
        statusCode: 410,
      });
      await dispatchAndSend(
        buildRequest(NotificationType.CARE_LOG_ADDED, gone.userId),
      );
      // PERMANENT.
      const perm = await seedRecipient('p');
      outcomes.set(perm.subscription.endpoint, {
        outcome: 'PERMANENT',
        statusCode: 403,
      });
      await dispatchAndSend(
        buildRequest(NotificationType.CARE_LOG_ADDED, perm.userId),
      );
      // TRANSIENT (job retry lần cuối): worker chốt và ném lỗi.
      const trans = await seedRecipient('t');
      outcomes.set(trans.subscription.endpoint, {
        outcome: 'TRANSIENT',
        statusCode: 503,
      });
      await dispatcher.dispatch([
        buildRequest(NotificationType.CARE_LOG_ADDED, trans.userId),
      ]);
      const transStored = await col('notifications').findOne({
        userId: trans.userId,
      });
      await expect(runWorker(transStored!._id, ATTEMPTS - 1)).rejects.toThrow();
      // Provider ném lỗi "độc" (thông điệp chứa endpoint + nội dung + auth).
      const boom = await seedRecipient('b');
      throwing.add(boom.subscription.endpoint);
      await dispatchAndSend(
        buildRequest(NotificationType.CARE_LOG_ADDED, boom.userId),
      );
      // Giải mã `auth` hỏng.
      const bad = await seedRecipient('d');
      await col('push_subscriptions').updateOne(
        { _id: bad.subscription._id },
        { $set: { 'keys.authEnc': { iv: 'x', tag: 'y', data: 'z' } } },
      );
      await dispatchAndSend(
        buildRequest(NotificationType.CARE_LOG_ADDED, bad.userId),
      );
      // Người nhận bị khóa sau khi ghi thông báo.
      const blocked = await seedRecipient('k');
      await dispatcher.dispatch([
        buildRequest(NotificationType.CARE_LOG_ADDED, blocked.userId),
      ]);
      await col('users').updateOne(
        { _id: blocked.userId },
        { $set: { status: 'BLOCKED' } },
      );
      await runWorker(
        (await col('notifications').findOne({ userId: blocked.userId }))!._id,
      );

      const logs = allLogs();
      // Không vacuous: log có các phần tử định danh an toàn.
      expect(logs).toContain('push.send notificationId=');
      expect(logs).toContain('endpointHash=');
      expect(logs).toContain('result=SENT');
      expect(logs).toContain('result=GONE');
      expect(logs).toContain('result=PERMANENT');
      expect(logs).toContain('result=TRANSIENT');
      expect(logs).toContain('result=PROVIDER_ERROR');
      expect(logs).toContain('result=DECRYPT_ERROR');
      expect(logs).toContain('Phát hiện PII trong nội dung push');
      expectLogsClean();
    });

    it('Dispatcher: xếp job lỗi (Redis chết) chỉ log id thông báo, không log nội dung', async () => {
      queueAdd.mockRejectedValue(new Error('ECONNREFUSED 127.0.0.1:6379'));
      const { userId } = await seedRecipient();
      await dispatcher.dispatch([
        buildRequest(NotificationType.CARE_LOG_ADDED, userId, {
          vars: varsFor(NotificationType.CARE_LOG_ADDED, {
            customerName: 'Lan 0912345678',
          }),
        }),
      ]);
      const logs = allLogs();
      expect(logs).toContain('Không xếp được job push cho thông báo');
      expectLogsClean();
    });

    it('limiter: Redis lỗi (fail-open) log cảnh báo KHÔNG chứa groupKey/X-Request-ID, vẫn gửi', async () => {
      redisStub.eval.mockRejectedValue(
        new Error('ECONNREFUSED 127.0.0.1:6379'),
      );
      const { userId } = await seedRecipient();
      const { sent: calls } = await dispatchAndSend(
        buildRequest(NotificationType.CUSTOMER_ASSIGNED, userId, {
          context: {
            careRole: 'MEMBER',
            origin: 'BULK_ADD',
            groupKey: GROUP_KEY,
          },
        }),
      );
      expect(calls).toHaveLength(1);
      // Thông báo thật sự có groupKey (bẫy đi vào hệ thống) và limiter thật sự đã được gọi.
      expect(
        (await col('notifications').findOne({ userId }))?.pushGroupKey,
      ).toBe(GROUP_KEY);
      expect(redisStub.eval).toHaveBeenCalled();
      expect(allLogs()).toContain('giới hạn đợt không kiểm tra được');
      expectLogsClean();
    });

    it('limiter: vượt hạn mức (SKIPPED) không log groupKey', async () => {
      redisStub.eval.mockResolvedValue(0);
      const { userId } = await seedRecipient();
      await dispatcher.dispatch([
        buildRequest(NotificationType.CUSTOMER_ASSIGNED, userId, {
          context: {
            careRole: 'MEMBER',
            origin: 'BULK_ADD',
            groupKey: GROUP_KEY,
          },
        }),
      ]);
      const stored = await col('notifications').findOne({ userId });
      await runWorker(stored!._id);
      expect(send).not.toHaveBeenCalled();
      expect(
        (await col('notifications').findOne({ _id: stored!._id }))?.pushStatus,
      ).toBe('SKIPPED');
      expectLogsClean();
    });

    it('sweep: xếp lại, quá TTL, cờ tắt và Redis lỗi đều chỉ log số lượng/thông điệp chung', async () => {
      const { userId } = await seedRecipient();
      await dispatcher.dispatch([
        buildRequest(NotificationType.CARE_LOG_ADDED, userId, {
          vars: varsFor(NotificationType.CARE_LOG_ADDED, {
            customerName: 'Lan 0912345678',
          }),
        }),
      ]);
      const future = new Date(Date.now() + 60_000);
      // (a) xếp lại được.
      queueAdd.mockClear();
      expect(await sweep.run(future)).toMatchObject({ enqueued: 1 });
      // (b) quá TTL của loại (24 giờ) chuyển SKIPPED.
      const old = await seedRecipient('o');
      await dispatcher.dispatch([
        buildRequest(NotificationType.CARE_LOG_ADDED, old.userId),
      ]);
      expect(await sweep.run(new Date(Date.now() + 3 * DAY_MS))).toMatchObject({
        skipped: expect.any(Number),
      });
      // (c) Redis lỗi ở getJob: dừng lượt, log cảnh báo.
      const again = await seedRecipient('r');
      await dispatcher.dispatch([
        buildRequest(NotificationType.CARE_LOG_ADDED, again.userId),
      ]);
      queueGetJob.mockRejectedValue(new Error('ECONNREFUSED 127.0.0.1:6379'));
      await sweep.run(new Date(Date.now() + 60_000));
      // (d) cờ tắt.
      queueGetJob.mockResolvedValue(null);
      const flagOff = await seedRecipient('f');
      await dispatcher.dispatch([
        buildRequest(NotificationType.CARE_LOG_ADDED, flagOff.userId),
      ]);
      process.env.FEATURE_CRM_PUSH = 'false';
      await sweep.run(new Date(Date.now() + 60_000));

      const logs = allLogs();
      expect(logs).toContain('push.sweep:');
      expectLogsClean();
    });

    it('cleanup: log chỉ có số đếm, không có endpoint/khóa của thiết bị bị xóa/thu hồi', async () => {
      const keep = await seedRecipient('keep');
      const stale = await seedRecipient('stale');
      await col('push_subscriptions').updateOne(
        { _id: stale.subscription._id },
        { $set: { lastSeenAt: new Date(Date.now() - 100 * DAY_MS) } },
      );
      const expired = await seedRecipient('exp');
      await col('push_subscriptions').updateOne(
        { _id: expired.subscription._id },
        { $set: { expirationTime: new Date(Date.now() - DAY_MS) } },
      );
      const disabled = await seedRecipient('dis');
      await col('users').updateOne(
        { _id: disabled.userId },
        { $set: { status: 'BLOCKED' } },
      );
      const result = await cleanup.run();
      expect(result).toEqual({ deleted: 1, expired: 1, accountDisabled: 1 });
      expect(
        await col('push_subscriptions').countDocuments({
          _id: keep.subscription._id,
        }),
      ).toBe(1);
      const logs = allLogs();
      expect(logs).toContain('push.cleanup:');
      expectLogsClean();
    });
  });
});
