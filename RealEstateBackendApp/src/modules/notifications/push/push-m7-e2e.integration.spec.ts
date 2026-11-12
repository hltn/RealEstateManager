/**
 * INTEGRATION/E2E — T-37 bộ kiểm thử M7 (Web Push): luồng đầu-cuối phân khách -> PENDING -> job -> SENT, không gửi
 * trùng, 404/410, tắt cờ, quá hạn, giới hạn hàng loạt, và sweep với job cũ THẬT trong Redis (mục (b) của T-32).
 *
 * Thật: MongoDB Replica Set (mongodb-memory-server), Redis + BullMQ (`QueueRuntimeService`, worker `push` thật chạy
 * `PushQueueWorker.handle`), HTTP (Fastify + CrmModule). Giả duy nhất: dịch vụ push (`PUSH_PROVIDER`), để đếm lần gửi.
 *
 * YÊU CẦU: đặt `REDIS_URL` trỏ tới Redis TẠM (không phải dev/prod, không cổng 6379), ví dụ container `tmp-t37-redis`:
 *   docker run -d --name tmp-t37-redis -p 127.0.0.1:16437:6379 redis:7-alpine
 * Mỗi lần chạy dùng tiền tố khóa riêng (`REDIS_KEY_PREFIX`), không đụng khóa khác.
 *
 * Chạy: REDIS_URL=redis://127.0.0.1:16437 npx jest --testRegex ".*\.integration\.spec\.ts$" --testPathIgnorePatterns "/node_modules/" --runInBand push-m7-e2e --forceExit
 */
import { randomUUID } from 'crypto';
import {
  MiddlewareConsumer,
  Module,
  NestModule,
  ValidationPipe,
} from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule, JwtService } from '@nestjs/jwt';
import {
  getConnectionToken,
  getModelToken,
  MongooseModule,
} from '@nestjs/mongoose';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { Job, Queue, Worker } from 'bullmq';
import type { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Connection, Model, Types } from 'mongoose';
import { UserRole } from '../../../common/enums/user-role.enum';
import { UserStatus } from '../../../common/enums/user-status.enum';
import { GlobalExceptionFilter } from '../../../common/filters/global-exception.filter';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { RequestContextMiddleware } from '../../../common/middleware/request-context.middleware';
import { createMemoryReplSet } from '../../../shared/database/memory-replset.util';
import { withTransaction } from '../../../shared/database/with-transaction.util';
import { FeatureFlagModule } from '../../../shared/feature-flags/feature-flag.module';
import { QueueNames } from '../../../shared/queue/queue.constants';
import { QueueRuntimeService } from '../../../shared/queue/queue-runtime.service';
import { PiiCryptoService } from '../../crm/common/crypto/pii-crypto.service';
import { CrmModule } from '../../crm/crm.module';
import { CrmSeedService } from '../../crm/seed/crm-seed.service';
import { TeamsModule } from '../../teams/teams.module';
import { User, UserDocument } from '../../users/schemas/user.schema';
import { UsersModule } from '../../users/users.module';
import { NotificationPushStatus } from '../notification.constants';
import {
  NotificationDispatcher,
  NotificationRequest,
} from '../notification-dispatcher.service';
import { buildPushAuthAad } from './push-endpoint.policy';
import {
  PUSH_PROVIDER,
  PushSendOptions,
  PushSendResult,
  PushSubscriptionTarget,
} from './push-provider.interface';
import { pushSendJobId } from './push-queue.constants';
import { PushQueueWorker } from './push-queue-worker.service';
import { PushSweepService } from './push-sweep.service';

jest.setTimeout(300_000);

const JWT_SECRET = 'integration-secret';
const RUN_ID = randomUUID().slice(0, 8);
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

/** Đăng ký middleware X-Request-ID như `AppModule` (module test không import AppModule). */
@Module({})
class RequestContextTestModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestContextMiddleware).forRoutes('*');
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Thăm dò đến khi `probe` trả giá trị thật (khác false/null/undefined) hoặc hết giờ thì ném lỗi rõ ràng. */
async function waitFor<T>(
  label: string,
  probe: () => Promise<T | false | null | undefined>,
  timeoutMs = 25_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (value !== false && value !== null && value !== undefined) return value;
    if (Date.now() > deadline) throw new Error(`Hết giờ chờ: ${label}`);
    await sleep(100);
  }
}

describe('T-37 M7 Web Push đầu-cuối (Redis + BullMQ thật)', () => {
  let replSet: MongoMemoryReplSet;
  let app: NestFastifyApplication;
  let connection: Connection;
  let userModel: Model<UserDocument>;
  let jwt: JwtService;
  let crypto: PiiCryptoService;
  let appWorker: PushQueueWorker;
  let dispatcher: NotificationDispatcher;
  let sweepService: PushSweepService;
  let runtime: QueueRuntimeService;
  let pushQueue: Queue;
  let redisConnection: { host: string; port: number };
  let bullPrefix: string;
  const extraQueues: Queue[] = [];
  const extraWorkers: Worker[] = [];

  const ids: Record<string, string> = {};
  const tokens: Record<string, string> = {};
  let phoneSeq = 0;
  let seq = 0;

  // ---------- Dịch vụ push giả ----------
  interface SendRecord {
    endpoint: string;
    tag: string;
    options: PushSendOptions;
    result?: PushSendResult;
  }
  const sendLog: SendRecord[] = [];
  const defaultBehavior = (): Promise<PushSendResult> =>
    Promise.resolve({ outcome: 'SENT', statusCode: 201 });
  let behavior: (
    subscription: PushSubscriptionTarget,
    callIndex: number,
  ) => Promise<PushSendResult> = defaultBehavior;
  const providerSend = (
    subscription: PushSubscriptionTarget,
    payload: { tag: string },
    options: PushSendOptions,
  ): Promise<PushSendResult> => {
    const record: SendRecord = {
      endpoint: subscription.endpoint,
      tag: payload.tag,
      options,
    };
    sendLog.push(record);
    return behavior(subscription, sendLog.length - 1).then((result) => {
      record.result = result;
      return result;
    });
  };
  const sendsFor = (endpoint: string) =>
    sendLog.filter((record) => record.endpoint === endpoint);
  const successfulSendsFor = (endpoint: string) =>
    sendsFor(endpoint).filter((record) => record.result?.outcome === 'SENT');

  const col = (name: string) => connection.collection(name);

  // ---------- Dữ liệu ----------
  const createRawUser = async () => {
    const _id = new Types.ObjectId();
    await col('users').insertOne({
      _id,
      status: 'ACTIVE',
      deletedAt: null,
      email: `${String(_id)}@example.test`,
      username: String(_id),
    });
    return _id;
  };

  const createSubscription = async (userId: Types.ObjectId, tag: string) => {
    const _id = new Types.ObjectId();
    const endpoint = `https://fcm.googleapis.com/fcm/send/T37-${tag}-${String(_id)}`;
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

  /** Ghi trực tiếp một thông báo (dùng khi cần tuổi/trạng thái cụ thể hoặc không muốn Dispatcher xếp job). */
  const insertNotification = async (
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
      dedupeKey: `t37-${String(_id)}`,
      createdAt: new Date(),
      ...overrides,
    });
    return _id;
  };

  const careLogRequest = (
    recipientIds: Types.ObjectId[],
  ): NotificationRequest => {
    seq += 1;
    return {
      type: 'CARE_LOG_ADDED' as NotificationRequest['type'],
      recipientIds,
      inApp: { title: 'Nhật ký mới', body: 'Có nhật ký mới' },
      vars: { actorName: 'Lan', customerName: 'Minh' },
      data: { deepLink: `/crm/customers/${String(new Types.ObjectId())}` },
      dedupeKey: `t37-dispatch-${RUN_ID}-${seq}`,
    };
  };

  const notificationOf = (id: Types.ObjectId) =>
    col('notifications').findOne({ _id: id });
  const notificationsOfUser = (userId: Types.ObjectId) =>
    col('notifications').find({ userId }).toArray();
  const statusOf = async (id: Types.ObjectId) =>
    (await notificationOf(id))?.pushStatus as string | undefined;
  const waitSettled = (id: Types.ObjectId) =>
    waitFor(`thông báo ${String(id)} rời PENDING`, async () => {
      const status = await statusOf(id);
      return status !== 'PENDING' ? status : false;
    });
  const jobStateOf = async (id: Types.ObjectId) =>
    (
      await runtime.getJob(QueueNames.PUSH, pushSendJobId(String(id)))
    )?.getState();
  const deliveriesOf = (id: Types.ObjectId) =>
    col('push_deliveries').find({ notificationId: id }).toArray();

  const sweepAt = (now: Date) => sweepService.run(now);
  /** Mốc "tương lai" để thông báo vừa tạo đủ 30 giây tuổi cho sweep. */
  const future = () => new Date(Date.now() + 45 * 1000);

  const makeQueue = (name: string) => {
    const queue = new Queue(name, {
      connection: redisConnection,
      prefix: bullPrefix,
    });
    extraQueues.push(queue);
    return queue;
  };
  const makeWorker = (
    name: string,
    processor: (job: Job) => Promise<unknown>,
    options: { concurrency?: number } = {},
  ) => {
    const worker = new Worker(name, processor, {
      connection: redisConnection,
      prefix: bullPrefix,
      lockDuration: 1500,
      stalledInterval: 500,
      ...options,
    });
    worker.on('error', () => undefined);
    extraWorkers.push(worker);
    return worker;
  };

  // ---------- HTTP ----------
  const call = async (
    method: 'GET' | 'POST' | 'PATCH',
    url: string,
    as: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ) => {
    const res = await app.inject({
      method,
      url: `/api/v1${url}`,
      headers: { authorization: `Bearer ${tokens[as]}`, ...headers },
      payload: body as never,
    });
    return {
      status: res.statusCode,
      body: res.body ? JSON.parse(res.body) : undefined,
    };
  };

  const createHttpUser = async (key: string, role: UserRole) => {
    const user = await userModel.create({
      email: `${key}@test.vn`,
      password: 'hash',
      displayName: key,
      role,
      status: UserStatus.ACTIVE,
    });
    ids[key] = String(user._id);
    tokens[key] = jwt.sign({ sub: ids[key], email: user.email, role });
  };

  const createCustomers = async (count: number): Promise<string[]> => {
    const created: string[] = [];
    for (let index = 0; index < count; index += 1) {
      // v1.0.5: DTO tạo khách không còn `careTeam`; người tạo luôn là PRIMARY -> staffA tạo để là chủ khách.
      const res = await call('POST', '/crm/customers', 'staffA', {
        fullName: 'Khách hàng thử',
        phone: `093${String(2_000_000 + ++phoneSeq)}`,
      });
      expect(res.status).toBe(201);
      created.push(res.body.data.id);
    }
    return created;
  };

  const bulkAssign = (customerIds: string[], requestId: string) =>
    call(
      'POST',
      '/crm/customer-bulk-operations',
      'admin',
      { type: 'ASSIGN', customerIds, payload: { memberIds: [ids.staffB] } },
      { 'x-request-id': requestId },
    );

  const assignedNotificationsOf = (customerIds: string[]) =>
    col('notifications')
      .find({
        userId: new Types.ObjectId(ids.staffB),
        type: 'CUSTOMER_ASSIGNED',
        'data.customerId': {
          $in: customerIds.map((id) => new Types.ObjectId(id)),
        },
      })
      .toArray();

  let staffBDevice: { _id: Types.ObjectId; endpoint: string };

  beforeAll(async () => {
    const redisUrl = process.env.REDIS_URL ?? '';
    if (!redisUrl || /:6379(\/|$)/.test(redisUrl)) {
      throw new Error(
        'Đặt REDIS_URL trỏ tới Redis TẠM (không dùng cổng 6379 của dev/prod), ví dụ redis://127.0.0.1:16437',
      );
    }
    const parsed = new URL(redisUrl);
    redisConnection = { host: parsed.hostname, port: Number(parsed.port) };
    process.env.FEATURE_CRM_ENABLED = 'true';
    process.env.FEATURE_CRM_PUSH = 'true';
    process.env.CRM_PII_ENCRYPTION_KEY = 'ab'.repeat(32);
    process.env.QUEUE_WORKERS_ENABLED = 'true';
    process.env.REDIS_KEY_PREFIX = `it-t37-${RUN_ID}:`;
    bullPrefix = `it-t37-${RUN_ID}:bull`;
    replSet = await createMemoryReplSet();

    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        MongooseModule.forRoot(replSet.getUri()),
        JwtModule.register({ secret: JWT_SECRET }),
        FeatureFlagModule,
        RequestContextTestModule,
        UsersModule,
        TeamsModule,
        CrmModule,
      ],
      providers: [
        { provide: APP_GUARD, useClass: JwtAuthGuard },
        { provide: APP_GUARD, useClass: RolesGuard },
      ],
    })
      .overrideProvider(PUSH_PROVIDER)
      .useValue({
        name: 'fake',
        isEnabled: () => process.env.FEATURE_CRM_PUSH === 'true',
        initialStatus: () =>
          process.env.FEATURE_CRM_PUSH === 'true'
            ? NotificationPushStatus.PENDING
            : NotificationPushStatus.SKIPPED,
        send: providerSend,
      })
      .compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    connection = app.get<Connection>(getConnectionToken());
    userModel = app.get(getModelToken(User.name));
    jwt = app.get(JwtService);
    crypto = app.get(PiiCryptoService);
    appWorker = app.get(PushQueueWorker);
    dispatcher = app.get(NotificationDispatcher);
    sweepService = app.get(PushSweepService);
    runtime = app.get(QueueRuntimeService);
    await Promise.all(
      connection.modelNames().map((name) => connection.model(name).init()),
    );
    await app.get(CrmSeedService).seedAll();

    pushQueue = makeQueue(QueueNames.PUSH);
    // Job lặp `push.sweep` thật (60 giây) sẽ làm nhiễu các ca có chủ đích dựng trạng thái cũ: gỡ đi, các ca tự gọi sweep.
    await waitFor('job lặp push-sweep được đăng ký', async () =>
      (await pushQueue.getJobSchedulers()).some((s) => s.key === 'push-sweep')
        ? true
        : false,
    );
    await pushQueue.removeJobScheduler('push-sweep');
    await pushQueue.removeJobScheduler('push-cleanup');

    await createHttpUser('admin', UserRole.ADMIN);
    await createHttpUser('manager1', UserRole.MANAGER);
    await createHttpUser('staffA', UserRole.STAFF);
    await createHttpUser('staffB', UserRole.STAFF);
    ids.teamA = (
      await call('POST', '/teams', 'admin', {
        name: 'Nhóm A',
        code: 'TEAMA',
        managerIds: [ids.manager1],
      })
    ).body.data.id;
    for (const user of ['manager1', 'staffA', 'staffB']) {
      const res = await call('PATCH', `/users/${ids[user]}/team`, 'admin', {
        teamId: ids.teamA,
      });
      expect(res.status).toBe(200);
    }
    staffBDevice = await createSubscription(
      new Types.ObjectId(ids.staffB),
      'staffB',
    );
  });

  afterAll(async () => {
    delete process.env.FEATURE_CRM_ENABLED;
    delete process.env.FEATURE_CRM_PUSH;
    delete process.env.CRM_PII_ENCRYPTION_KEY;
    delete process.env.QUEUE_WORKERS_ENABLED;
    delete process.env.REDIS_KEY_PREFIX;
    await Promise.allSettled(extraWorkers.map((w) => w.close(true)));
    await app?.close();
    // Dọn mọi khóa BullMQ của lần chạy này để không để rác trong Redis tạm.
    await Promise.allSettled(
      extraQueues.map((q) => q.obliterate({ force: true })),
    );
    await Promise.allSettled(extraQueues.map((q) => q.close()));
    await replSet?.stop();
  });

  beforeEach(() => {
    process.env.FEATURE_CRM_PUSH = 'true';
    behavior = defaultBehavior;
    sendLog.length = 0;
  });

  afterEach(async () => {
    await pushQueue.resume();
    // Không để thông báo PENDING của ca này bị sweep/worker của ca sau chạm tới.
    await col('notifications').updateMany(
      { pushStatus: 'PENDING' },
      { $set: { pushStatus: 'SKIPPED' } },
    );
  });

  // =====================================================================================================
  describe('luồng đầu-cuối: phân khách -> PENDING -> job -> SENT', () => {
    it('ASSIGN qua HTTP: thông báo PENDING + job trong Redis thật, worker thật gửi đúng một lần, thông báo SENT', async () => {
      const [customerId] = await createCustomers(1);
      await pushQueue.pause(); // giữ job ở hàng đợi để quan sát trạng thái trung gian
      const res = await bulkAssign([customerId], `req-e2e-${RUN_ID}`);
      expect(res.status).toBe(200);

      const [doc] = await assignedNotificationsOf([customerId]);
      expect(doc.pushStatus).toBe('PENDING');
      expect(await jobStateOf(doc._id)).toBe('waiting');
      expect(sendLog).toHaveLength(0);

      await pushQueue.resume();
      expect(await waitSettled(doc._id)).toBe('SENT');

      expect(sendsFor(staffBDevice.endpoint)).toHaveLength(1);
      expect(sendLog[0].tag).toBe(String(doc._id));
      expect((await notificationOf(doc._id))?.pushSentAt).toBeInstanceOf(Date);
      const rows = await deliveriesOf(doc._id);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        status: 'SENT',
        subscriptionId: staffBDevice._id,
      });
      await waitFor('job completed', async () =>
        (await jobStateOf(doc._id)) === 'completed' ? true : false,
      );
    });

    it('Dispatcher: người có 2 thiết bị thì mỗi thiết bị đúng một lần gửi, mỗi (thông báo, thiết bị) đúng một hàng sổ', async () => {
      const userId = await createRawUser();
      const a = await createSubscription(userId, 'a');
      const b = await createSubscription(userId, 'b');
      await dispatcher.dispatch([careLogRequest([userId])]);
      const [doc] = await notificationsOfUser(userId);

      expect(await waitSettled(doc._id)).toBe('SENT');

      expect(successfulSendsFor(a.endpoint)).toHaveLength(1);
      expect(successfulSendsFor(b.endpoint)).toHaveLength(1);
      expect(await deliveriesOf(doc._id)).toHaveLength(2);
    });
  });

  // =====================================================================================================
  describe('không gửi trùng', () => {
    it('cùng thông báo bị xếp job đồng thời nhiều lần (Dispatcher + sweep + thủ công): đúng một job, đúng một lần gửi', async () => {
      const userId = await createRawUser();
      const device = await createSubscription(userId, 'dup');
      const id = await insertNotification(userId);
      await pushQueue.pause();

      await Promise.all([
        ...Array.from({ length: 8 }, () =>
          runtime.add(
            QueueNames.PUSH,
            'push.send',
            { notificationId: String(id) },
            { jobId: pushSendJobId(String(id)) },
          ),
        ),
        sweepAt(future()),
        sweepAt(future()),
      ]);
      const jobs = await pushQueue.getJobs(
        ['waiting', 'delayed', 'active', 'completed', 'failed'],
        0,
        -1,
      );
      expect(
        jobs.filter((job) => job.id === pushSendJobId(String(id))),
      ).toHaveLength(1);

      await pushQueue.resume();
      expect(await waitSettled(id)).toBe('SENT');
      await sleep(500);
      expect(successfulSendsFor(device.endpoint)).toHaveLength(1);
    });

    it('push.sweep chạy song song với afterCommit của transaction: mỗi thông báo gửi đúng một lần', async () => {
      const users = await Promise.all(
        Array.from({ length: 5 }, () => createRawUser()),
      );
      const devices = await Promise.all(
        users.map((userId, index) =>
          createSubscription(userId, `race${index}`),
        ),
      );
      let isDone = false;
      const sweepLoop = (async () => {
        while (!isDone) {
          await sweepAt(future());
          await sleep(3);
        }
      })();
      await withTransaction(connection, (session) =>
        dispatcher.dispatch([careLogRequest(users)], session),
      );
      isDone = true;
      await sweepLoop;

      const docs = await col('notifications')
        .find({ userId: { $in: users } })
        .toArray();
      expect(docs).toHaveLength(5);
      for (const doc of docs) {
        expect(await waitSettled(doc._id)).toBe('SENT');
      }
      await sleep(800); // chờ mọi job thừa (nếu có) chạy hết trước khi đếm
      for (const device of devices) {
        expect(successfulSendsFor(device.endpoint)).toHaveLength(1);
        expect(sendsFor(device.endpoint)).toHaveLength(1);
      }
    });

    it('transaction rollback: không có thông báo, không có job trong Redis, không push, sweep sau đó cũng không tạo gì', async () => {
      const userId = await createRawUser();
      const device = await createSubscription(userId, 'rb');
      const req = careLogRequest([userId]);
      await pushQueue.pause();

      await expect(
        withTransaction(connection, async (session) => {
          await dispatcher.dispatch([req], session);
          throw new Error('nghiệp vụ lỗi');
        }),
      ).rejects.toThrow('nghiệp vụ lỗi');
      await sweepAt(future());
      await pushQueue.resume();
      await sleep(500);

      expect(await notificationsOfUser(userId)).toHaveLength(0);
      expect(
        await pushQueue.getJobs(['waiting', 'delayed', 'active'], 0, -1),
      ).toHaveLength(0);
      expect(sendsFor(device.endpoint)).toHaveLength(0);
    });

    it('restart giữa chừng (a): worker chết khi đang gửi, job active bị dừng được BullMQ xếp lại, thiết bị nhận đúng một lần gửi thành công', async () => {
      const userId = await createRawUser();
      const device = await createSubscription(userId, 'stallA');
      const id = await insertNotification(userId);
      const name = `push-t37-${RUN_ID}-stall-a`;
      const queue = makeQueue(name);
      // Lần gọi đầu treo vĩnh viễn (mô phỏng process chết khi đang gọi dịch vụ push); lần sau trả SENT.
      behavior = (_subscription, index) =>
        index === 0
          ? new Promise<PushSendResult>(() => undefined)
          : defaultBehavior();
      const victim = makeWorker(name, (job) => appWorker.handle(job));
      await queue.add(
        'push.send',
        { notificationId: String(id) },
        { jobId: pushSendJobId(String(id)), attempts: 5 },
      );
      await waitFor('worker nạn nhân gọi dịch vụ push', () =>
        Promise.resolve(sendLog.length === 1),
      );
      await victim.close(true); // chết thật: không còn gia hạn khóa, job vẫn `active`
      expect(await queue.getJobState(pushSendJobId(String(id)))).toBe('active');

      makeWorker(name, (job) => appWorker.handle(job));
      await waitFor('job được xếp lại và chạy xong', async () =>
        (await queue.getJobState(pushSendJobId(String(id)))) === 'completed'
          ? true
          : false,
      );

      expect(await statusOf(id)).toBe('SENT');
      expect(successfulSendsFor(device.endpoint)).toHaveLength(1);
      expect(await deliveriesOf(id)).toHaveLength(1);
      expect((await deliveriesOf(id))[0].status).toBe('SENT');
    });

    it('restart giữa chừng (b): worker chết SAU khi đã ghi SENT nhưng trước khi báo xong job, lần chạy lại không gửi thêm', async () => {
      const userId = await createRawUser();
      const device = await createSubscription(userId, 'stallB');
      const id = await insertNotification(userId);
      const name = `push-t37-${RUN_ID}-stall-b`;
      const queue = makeQueue(name);
      // Xử lý xong thật (SENT đã ghi) rồi treo trước khi trả về, như process chết ngay trước khi ack job.
      const victim = makeWorker(name, async (job) => {
        await appWorker.handle(job);
        await new Promise<void>(() => undefined);
      });
      await queue.add(
        'push.send',
        { notificationId: String(id) },
        { jobId: pushSendJobId(String(id)), attempts: 5 },
      );
      await waitFor('thông báo SENT', async () =>
        (await statusOf(id)) === 'SENT' ? true : false,
      );
      await victim.close(true);
      expect(await queue.getJobState(pushSendJobId(String(id)))).toBe('active');

      makeWorker(name, (job) => appWorker.handle(job));
      await waitFor('job được xếp lại và chạy xong', async () =>
        (await queue.getJobState(pushSendJobId(String(id)))) === 'completed'
          ? true
          : false,
      );

      expect(sendsFor(device.endpoint)).toHaveLength(1);
      expect(await statusOf(id)).toBe('SENT');
    });

    // Hành vi ĐƯỢC CHẤP NHẬN (Architecture 5.4 ghi chú (c), quyết định của Oniichan, hướng B: không thêm lease):
    // claim không loại trừ hàng `SENDING`, nên hai worker song song cùng thông báo có thể cùng gửi một thiết bị
    // (tối đa 2 lần). Giảm hại: mọi lần gửi đều mang cùng topic/tag = notificationId để thiết bị gộp thành một
    // thông báo hiển thị; kết quả cuối vẫn là thông báo SENT một lần, delivery SENT, không có lỗi.
    it('hai worker xử lý CÙNG thông báo đồng thời (job trùng khác jobId): tối đa 2 lần gửi mỗi thiết bị, cùng topic/tag để gộp, kết quả cuối SENT một lần', async () => {
      const userId = await createRawUser();
      const a = await createSubscription(userId, 'cw-a');
      const b = await createSubscription(userId, 'cw-b');
      const id = await insertNotification(userId);
      const name = `push-t37-${RUN_ID}-dup`;
      const queue = makeQueue(name);
      behavior = async () => {
        await sleep(400); // kéo dài lúc gửi để hai worker thật sự chồng lên nhau
        return { outcome: 'SENT', statusCode: 201 };
      };
      makeWorker(name, (job) => appWorker.handle(job));
      makeWorker(name, (job) => appWorker.handle(job));
      await Promise.all(
        ['x', 'y'].map((suffix) =>
          queue.add(
            'push.send',
            { notificationId: String(id) },
            {
              jobId: `dup-${suffix}-${String(id)}`,
              attempts: 5,
              backoff: { type: 'fixed', delay: 300 },
            },
          ),
        ),
      );
      expect(await waitSettled(id)).toBe('SENT');
      // Cả hai job phải kết thúc "completed" (không job nào lỗi/thử lại) rồi mới đếm số lần gửi.
      for (const suffix of ['x', 'y']) {
        await waitFor(`job dup-${suffix} xong`, async () =>
          (await queue.getJobState(`dup-${suffix}-${String(id)}`)) ===
          'completed'
            ? true
            : false,
        );
      }

      for (const device of [a, b]) {
        const sends = sendsFor(device.endpoint);
        expect(sends.length).toBeGreaterThanOrEqual(1);
        expect(sends.length).toBeLessThanOrEqual(2);
        expect(
          successfulSendsFor(device.endpoint).length,
        ).toBeGreaterThanOrEqual(1);
        // Mọi lần gửi cùng tag/topic = notificationId để thiết bị gộp bản trùng.
        for (const record of sends) {
          expect(record.tag).toBe(String(id));
          expect(record.options.topic).toBe(String(id));
        }
      }
      expect(await statusOf(id)).toBe('SENT');
      expect((await notificationOf(id))?.pushSentAt).toBeInstanceOf(Date);
      const rows = await deliveriesOf(id);
      expect(rows).toHaveLength(2);
      for (const row of rows) {
        expect(row.status).toBe('SENT');
        expect(row.lastErrorCode ?? null).toBeNull();
      }
    });
  });

  // =====================================================================================================
  describe('404/410 từ dịch vụ push', () => {
    it.each([404, 410])(
      'mã %i: thu hồi đúng thiết bị (GONE), thiết bị còn lại vẫn nhận, lần sau không gọi thiết bị đã thu hồi',
      async (statusCode) => {
        const userId = await createRawUser();
        const dead = await createSubscription(userId, 'dead');
        const alive = await createSubscription(userId, 'alive');
        behavior = (subscription) =>
          Promise.resolve(
            subscription.endpoint === dead.endpoint
              ? { outcome: 'GONE', statusCode }
              : { outcome: 'SENT', statusCode: 201 },
          );

        await dispatcher.dispatch([careLogRequest([userId])]);
        const [first] = await notificationsOfUser(userId);
        expect(await waitSettled(first._id)).toBe('SENT');

        expect(
          await col('push_subscriptions').findOne({ _id: dead._id }),
        ).toMatchObject({ revokedReason: 'GONE' });
        expect(
          (await col('push_subscriptions').findOne({ _id: dead._id }))
            ?.revokedAt,
        ).toBeInstanceOf(Date);
        expect(
          (await col('push_subscriptions').findOne({ _id: alive._id }))
            ?.revokedAt,
        ).toBeNull();
        const rows = await deliveriesOf(first._id);
        expect(
          rows.find((row) => String(row.subscriptionId) === String(dead._id)),
        ).toMatchObject({ status: 'GONE', lastErrorCode: String(statusCode) });
        expect(successfulSendsFor(alive.endpoint)).toHaveLength(1);

        await dispatcher.dispatch([careLogRequest([userId])]);
        const second = (await notificationsOfUser(userId)).find(
          (doc) => String(doc._id) !== String(first._id),
        )!;
        expect(await waitSettled(second._id)).toBe('SENT');
        expect(sendsFor(dead.endpoint)).toHaveLength(1);
        expect(sendsFor(alive.endpoint)).toHaveLength(2);
      },
    );

    it('mọi thiết bị đều 410: thông báo SKIPPED (không phải FAILED), mọi thiết bị bị thu hồi', async () => {
      const userId = await createRawUser();
      const a = await createSubscription(userId, 'g1');
      const b = await createSubscription(userId, 'g2');
      behavior = () => Promise.resolve({ outcome: 'GONE', statusCode: 410 });

      await dispatcher.dispatch([careLogRequest([userId])]);
      const [doc] = await notificationsOfUser(userId);

      expect(await waitSettled(doc._id)).toBe('SKIPPED');
      const subs = await col('push_subscriptions')
        .find({ _id: { $in: [a._id, b._id] } })
        .toArray();
      expect(subs.every((s) => s.revokedReason === 'GONE')).toBe(true);
    });
  });

  // =====================================================================================================
  describe('tắt cờ push', () => {
    it('cờ tắt lúc Dispatcher ghi: SKIPPED ngay, không có job, không push', async () => {
      const userId = await createRawUser();
      const device = await createSubscription(userId, 'off1');
      process.env.FEATURE_CRM_PUSH = 'false';

      await dispatcher.dispatch([careLogRequest([userId])]);
      const [doc] = await notificationsOfUser(userId);
      await sleep(300);

      expect(doc.pushStatus).toBe('SKIPPED');
      expect(doc.push).toBeNull();
      expect(await jobStateOf(doc._id)).toBeUndefined();
      expect(sendsFor(device.endpoint)).toHaveLength(0);
    });

    it('cờ tắt SAU khi đã xếp job: worker thật chốt SKIPPED, không gọi dịch vụ push', async () => {
      const userId = await createRawUser();
      const device = await createSubscription(userId, 'off2');
      await pushQueue.pause();
      await dispatcher.dispatch([careLogRequest([userId])]);
      const [doc] = await notificationsOfUser(userId);
      expect(doc.pushStatus).toBe('PENDING');
      expect(await jobStateOf(doc._id)).toBe('waiting');

      process.env.FEATURE_CRM_PUSH = 'false';
      await pushQueue.resume();

      expect(await waitSettled(doc._id)).toBe('SKIPPED');
      expect(sendsFor(device.endpoint)).toHaveLength(0);
    });

    it('cờ tắt khi sweep chạy: mọi PENDING thành SKIPPED, không xếp job, không gọi dịch vụ push', async () => {
      const userId = await createRawUser();
      const device = await createSubscription(userId, 'off3');
      const old = new Date(Date.now() - 5 * MINUTE);
      const a = await insertNotification(userId, { createdAt: old });
      const b = await insertNotification(userId, { createdAt: old });
      process.env.FEATURE_CRM_PUSH = 'false';

      const result = await sweepAt(new Date());
      await sleep(300);

      expect(result.enqueued).toBe(0);
      expect(await statusOf(a)).toBe('SKIPPED');
      expect(await statusOf(b)).toBe('SKIPPED');
      expect(await jobStateOf(a)).toBeUndefined();
      expect(sendsFor(device.endpoint)).toHaveLength(0);
    });
  });

  // =====================================================================================================
  describe('quá hạn (ttlSeconds)', () => {
    it('sweep: quá ttl của loại thì SKIPPED không xếp job; chưa quá thì xếp lại, gửi kèm ttl/urgency của loại', async () => {
      const userId = await createRawUser();
      const device = await createSubscription(userId, 'ttl');
      const expiredCareLog = await insertNotification(userId, {
        createdAt: new Date(Date.now() - 25 * HOUR),
      });
      const expiredAppointment = await insertNotification(userId, {
        type: 'APPOINTMENT_DUE',
        createdAt: new Date(Date.now() - 2 * HOUR),
      });
      const freshAppointment = await insertNotification(userId, {
        type: 'APPOINTMENT_DUE',
        createdAt: new Date(Date.now() - 45 * MINUTE),
      });
      const freshCareLog = await insertNotification(userId, {
        createdAt: new Date(Date.now() - 23 * HOUR),
      });

      const result = await sweepAt(new Date());

      expect(result).toEqual({ enqueued: 2, skipped: 2 });
      expect(await statusOf(expiredCareLog)).toBe('SKIPPED');
      expect(await statusOf(expiredAppointment)).toBe('SKIPPED');
      expect(await jobStateOf(expiredCareLog)).toBeUndefined();
      expect(await jobStateOf(expiredAppointment)).toBeUndefined();
      expect(await waitSettled(freshAppointment)).toBe('SENT');
      expect(await waitSettled(freshCareLog)).toBe('SENT');

      expect(sendsFor(device.endpoint)).toHaveLength(2);
      const byTag = new Map(sendLog.map((record) => [record.tag, record]));
      expect(byTag.get(String(freshAppointment))?.options).toMatchObject({
        ttlSeconds: 3600,
        urgency: 'high',
      });
      expect(byTag.get(String(freshCareLog))?.options).toMatchObject({
        ttlSeconds: 24 * 3600,
        urgency: 'normal',
      });
    });
  });

  // =====================================================================================================
  describe('giới hạn push hàng loạt (3 push/người/đợt) với BullMQ thật', () => {
    it('ASSIGN 5 khách một đợt: đúng 3 push, 2 thông báo SKIPPED nhưng vẫn có trong hộp; đợt khác lại được 3', async () => {
      const first = await createCustomers(5);
      await bulkAssign(first, `req-limit-1-${RUN_ID}`);
      const docs1 = await assignedNotificationsOf(first);
      expect(docs1).toHaveLength(5);
      for (const doc of docs1) await waitSettled(doc._id);

      expect(sendsFor(staffBDevice.endpoint)).toHaveLength(3);
      const after1 = await assignedNotificationsOf(first);
      expect(after1.filter((d) => d.pushStatus === 'SENT')).toHaveLength(3);
      expect(after1.filter((d) => d.pushStatus === 'SKIPPED')).toHaveLength(2);

      const second = await createCustomers(4);
      await bulkAssign(second, `req-limit-2-${RUN_ID}`);
      const docs2 = await assignedNotificationsOf(second);
      for (const doc of docs2) await waitSettled(doc._id);

      expect(sendsFor(staffBDevice.endpoint)).toHaveLength(6);
      expect(
        (await assignedNotificationsOf(second)).filter(
          (d) => d.pushStatus === 'SENT',
        ),
      ).toHaveLength(3);
    });
  });

  // =====================================================================================================
  describe('push.sweep với job cũ THẬT trong Redis (T-32 mục b)', () => {
    /** Tạo một thông báo PENDING đủ tuổi cho sweep, kèm một thiết bị, trả về id và thiết bị. */
    const stalePending = async (tag: string) => {
      const userId = await createRawUser();
      const device = await createSubscription(userId, tag);
      const id = await insertNotification(userId, {
        createdAt: new Date(Date.now() - 5 * MINUTE),
      });
      return { id, device };
    };

    /** Đưa job `push.send` của thông báo về đúng trạng thái `failed` (một lần thử, lỗi tạm) trong Redis thật. */
    const makeFailedJob = async (id: Types.ObjectId) => {
      behavior = () =>
        Promise.resolve({ outcome: 'TRANSIENT', statusCode: 503 });
      await runtime.add(
        QueueNames.PUSH,
        'push.send',
        { notificationId: String(id) },
        { jobId: pushSendJobId(String(id)), attempts: 1 },
      );
      await waitFor('job failed', async () =>
        (await jobStateOf(id)) === 'failed' ? true : false,
      );
    };

    /** Mô phỏng thông báo bị bỏ sót: vẫn PENDING, sổ gửi sạch (job cũ vẫn nằm trong Redis). */
    const resetToPending = async (id: Types.ObjectId) => {
      await col('push_deliveries').deleteMany({ notificationId: id });
      await col('notifications').updateOne(
        { _id: id },
        { $set: { pushStatus: 'PENDING', pushSentAt: null } },
      );
      sendLog.length = 0;
      behavior = defaultBehavior;
    };

    it('tiền đề: BullMQ thật bỏ qua `add` cùng jobId khi job cũ failed (đây là lỗi mà sweep phải vượt qua)', async () => {
      const { id } = await stalePending('pre');
      await makeFailedJob(id);
      await runtime.add(
        QueueNames.PUSH,
        'push.send',
        { notificationId: String(id) },
        { jobId: pushSendJobId(String(id)) },
      );
      expect(await jobStateOf(id)).toBe('failed');
    });

    it('job cũ failed: sweep xóa rồi xếp lại, job chạy lại và thông báo SENT', async () => {
      const { id, device } = await stalePending('failed');
      await makeFailedJob(id);
      await resetToPending(id);

      const result = await sweepAt(new Date());

      expect(result.enqueued).toBeGreaterThanOrEqual(1);
      expect(await waitSettled(id)).toBe('SENT');
      expect(successfulSendsFor(device.endpoint)).toHaveLength(1);
      await waitFor('job mới completed', async () =>
        (await jobStateOf(id)) === 'completed' ? true : false,
      );
    });

    it('job cũ completed: sweep xóa rồi xếp lại, job chạy lại và thông báo SENT', async () => {
      const { id, device } = await stalePending('completed');
      await runtime.add(
        QueueNames.PUSH,
        'push.send',
        { notificationId: String(id) },
        { jobId: pushSendJobId(String(id)), attempts: 1 },
      );
      await waitSettled(id);
      await waitFor('job completed', async () =>
        (await jobStateOf(id)) === 'completed' ? true : false,
      );
      const firstFinishedOn = (
        await runtime.getJob(QueueNames.PUSH, pushSendJobId(String(id)))
      )?.finishedOn;
      await resetToPending(id);

      await sweepAt(new Date());

      expect(await waitSettled(id)).toBe('SENT');
      expect(successfulSendsFor(device.endpoint)).toHaveLength(1);
      await waitFor('job mới completed (khác lần trước)', async () => {
        const job = await runtime.getJob(
          QueueNames.PUSH,
          pushSendJobId(String(id)),
        );
        return job?.finishedOn && job.finishedOn !== firstFinishedOn
          ? true
          : false;
      });
    });

    it('job cũ delayed: giữ nguyên (cùng job, không xóa, không xếp lại), thông báo không bị gửi sớm', async () => {
      const { id, device } = await stalePending('delayed');
      const added = await runtime.add(
        QueueNames.PUSH,
        'push.send',
        { notificationId: String(id) },
        { jobId: pushSendJobId(String(id)), delay: 10 * MINUTE },
      );

      await sweepAt(new Date());
      await sweepAt(new Date());

      const after = await runtime.getJob(
        QueueNames.PUSH,
        pushSendJobId(String(id)),
      );
      expect(await after?.getState()).toBe('delayed');
      expect(after?.timestamp).toBe(added?.timestamp);
      expect(await statusOf(id)).toBe('PENDING');
      expect(sendsFor(device.endpoint)).toHaveLength(0);
      await after?.remove();
    });

    it('job cũ waiting: giữ nguyên, rồi worker xử lý đúng một lần', async () => {
      const { id, device } = await stalePending('waiting');
      await pushQueue.pause();
      const added = await runtime.add(
        QueueNames.PUSH,
        'push.send',
        { notificationId: String(id) },
        { jobId: pushSendJobId(String(id)) },
      );

      await sweepAt(new Date());
      await sweepAt(new Date());

      const after = await runtime.getJob(
        QueueNames.PUSH,
        pushSendJobId(String(id)),
      );
      expect(await after?.getState()).toBe('waiting');
      expect(after?.timestamp).toBe(added?.timestamp);

      await pushQueue.resume();
      expect(await waitSettled(id)).toBe('SENT');
      await sleep(300);
      expect(sendsFor(device.endpoint)).toHaveLength(1);
    });

    it('job cũ active (đang gửi): sweep không động vào, không gửi trùng; thả ra thì SENT đúng một lần', async () => {
      const { id, device } = await stalePending('active');
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      behavior = async () => {
        await gate;
        return { outcome: 'SENT', statusCode: 201 };
      };
      await runtime.add(
        QueueNames.PUSH,
        'push.send',
        { notificationId: String(id) },
        { jobId: pushSendJobId(String(id)) },
      );
      await waitFor('job active và đã gọi dịch vụ push', async () =>
        (await jobStateOf(id)) === 'active' && sendLog.length === 1
          ? true
          : false,
      );

      await sweepAt(new Date());
      await sweepAt(new Date());

      expect(await jobStateOf(id)).toBe('active');
      expect(sendsFor(device.endpoint)).toHaveLength(1);

      release();
      expect(await waitSettled(id)).toBe('SENT');
      await sleep(300);
      expect(sendsFor(device.endpoint)).toHaveLength(1);
    });
  });
});
