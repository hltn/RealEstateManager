/**
 * INTEGRATION — T-33/T-34: thao tác hàng loạt ASSIGN thật (`POST /crm/customer-bulk-operations`) đặt
 * `origin = BULK_ADD` nên mỗi thông báo của người được thêm mang `pushGroupKey = BULK:{X-Request-ID}`, và worker
 * `push.send` giới hạn tối đa 3 push cho mỗi (người, đợt). Chạy qua HTTP thật trên MongoDB Replica Set
 * (mongodb-memory-server) + Redis THẬT (rate limit, bộ đếm đợt; đặt `REDIS_URL`, khóa có tiền tố riêng mỗi lần chạy).
 * Nhà cung cấp push và hàng đợi BullMQ là bản giả: job được bắt lại rồi gọi worker trực tiếp.
 *
 * Chạy: REDIS_URL=redis://127.0.0.1:16399 npx jest --testRegex ".*\.integration\.spec\.ts$" --testPathIgnorePatterns "/node_modules/" --runInBand crm-bulk-assign-push --forceExit
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
import type { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Connection, Model, Types } from 'mongoose';
import { UserRole } from '../../common/enums/user-role.enum';
import { UserStatus } from '../../common/enums/user-status.enum';
import { GlobalExceptionFilter } from '../../common/filters/global-exception.filter';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RequestContextMiddleware } from '../../common/middleware/request-context.middleware';
import { RolesGuard } from '../../common/guards/roles.guard';
import { createMemoryReplSet } from '../../shared/database/memory-replset.util';
import { FeatureFlagModule } from '../../shared/feature-flags/feature-flag.module';
import { QueueRuntimeService } from '../../shared/queue/queue-runtime.service';
import { NotificationPushStatus } from '../notifications/notification.constants';
import { buildPushAuthAad } from '../notifications/push/push-endpoint.policy';
import { PUSH_PROVIDER } from '../notifications/push/push-provider.interface';
import { PushQueueWorker } from '../notifications/push/push-queue-worker.service';
import { TeamsModule } from '../teams/teams.module';
import { User, UserDocument } from '../users/schemas/user.schema';
import { UsersModule } from '../users/users.module';
import { PiiCryptoService } from './common/crypto/pii-crypto.service';
import { CrmModule } from './crm.module';
import { CrmSeedService } from './seed/crm-seed.service';

jest.setTimeout(300_000);

const JWT_SECRET = 'integration-secret';
const RUN_ID = randomUUID().slice(0, 8);
/** Độ dài tối đa của phần `requestId` trong `pushGroupKey` (T-33, L1). */
const MAX_REQUEST_ID_LENGTH = 128;

/** Đăng ký middleware X-Request-ID như `AppModule` (module test không import AppModule). */
@Module({})
class RequestContextTestModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestContextMiddleware).forRoutes('*');
  }
}

describe('CRM bulk ASSIGN -> pushGroupKey BULK:{requestId} và giới hạn 3 push/người/đợt (T-33)', () => {
  let replSet: MongoMemoryReplSet;
  let app: NestFastifyApplication;
  let connection: Connection;
  let userModel: Model<UserDocument>;
  let jwt: JwtService;
  let crypto: PiiCryptoService;
  let worker: PushQueueWorker;
  const queueAdd = jest.fn();
  const send = jest.fn();

  const ids: Record<string, string> = {};
  const tokens: Record<string, string> = {};
  let phoneSeq = 0;

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

  const createUser = async (key: string, role: UserRole) => {
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

  const createCustomer = async (): Promise<string> => {
    const phone = `093${String(1_000_000 + ++phoneSeq)}`;
    const res = await call('POST', '/crm/customers', 'admin', {
      fullName: 'Khách hàng thử',
      phone,
      careTeam: { memberIds: [], primaryUserId: ids.staffA },
    });
    expect(res.status).toBe(201);
    return res.body.data.id;
  };

  const createCustomers = async (count: number): Promise<string[]> => {
    const created: string[] = [];
    for (let index = 0; index < count; index += 1) {
      created.push(await createCustomer());
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

  const notificationsOfTarget = (customerIds: string[]) =>
    connection
      .collection('notifications')
      .find({
        userId: new Types.ObjectId(ids.staffB),
        type: 'CUSTOMER_ASSIGNED',
        'data.customerId': {
          $in: customerIds.map((id) => new Types.ObjectId(id)),
        },
      })
      .toArray();

  /** Chạy worker cho mọi job đã xếp hàng kể từ lần `queueAdd.mockClear()` gần nhất. */
  const runQueuedJobs = async () => {
    for (const call of queueAdd.mock.calls) {
      await worker.handle({
        name: 'push.send',
        data: call[2] as { notificationId: string },
        attemptsMade: 0,
        opts: { attempts: 5 },
      });
    }
  };

  beforeAll(async () => {
    process.env.FEATURE_CRM_ENABLED = 'true';
    process.env.FEATURE_CRM_PUSH = 'true';
    process.env.CRM_PII_ENCRYPTION_KEY = 'ab'.repeat(32);
    process.env.REDIS_KEY_PREFIX = `it-bulk-push-${RUN_ID}:`;
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
        isEnabled: () => true,
        initialStatus: () => NotificationPushStatus.PENDING,
        send: send.mockResolvedValue({ outcome: 'SENT', statusCode: 201 }),
      })
      .overrideProvider(QueueRuntimeService)
      .useValue({
        isEnabled: () => false,
        add: queueAdd,
        registerWorker: jest.fn(),
        upsertSchedulers: jest.fn().mockResolvedValue(undefined),
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
    worker = app.get(PushQueueWorker);
    await Promise.all(
      connection.modelNames().map((name) => connection.model(name).init()),
    );
    await app.get(CrmSeedService).seedAll();

    await createUser('admin', UserRole.ADMIN);
    await createUser('manager1', UserRole.MANAGER);
    await createUser('staffA', UserRole.STAFF);
    await createUser('staffB', UserRole.STAFF);
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

    // Người được thêm có một thiết bị push hợp lệ (auth mã hóa đúng như đăng ký thật).
    const endpointHash = 'e'.repeat(64);
    await connection.collection('push_subscriptions').insertOne({
      userId: new Types.ObjectId(ids.staffB),
      endpoint: 'https://fcm.googleapis.com/fcm/send/SECRET-bulk',
      endpointHash,
      keys: {
        p256dh: 'p256dh-public',
        authEnc: crypto.encrypt(
          'auth-bulk',
          buildPushAuthAad(ids.staffB, endpointHash),
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
  });

  afterAll(async () => {
    delete process.env.FEATURE_CRM_ENABLED;
    delete process.env.FEATURE_CRM_PUSH;
    delete process.env.CRM_PII_ENCRYPTION_KEY;
    delete process.env.REDIS_KEY_PREFIX;
    await app?.close();
    await replSet?.stop();
  });

  beforeEach(() => {
    queueAdd.mockClear();
    send.mockClear();
  });

  it('ASSIGN hàng loạt nhiều khách cho cùng một người: mọi thông báo mang pushGroupKey = BULK:{X-Request-ID}, PENDING', async () => {
    const customerIds = await createCustomers(5);
    queueAdd.mockClear();

    const res = await bulkAssign(customerIds, 'req-bulk-1');

    expect(res.status).toBe(200);
    expect(res.body.data.succeeded).toEqual(customerIds);
    const docs = await notificationsOfTarget(customerIds);
    expect(docs).toHaveLength(5);
    for (const doc of docs) {
      expect(doc.pushGroupKey).toBe('BULK:req-bulk-1');
      expect(doc.pushStatus).toBe('PENDING');
    }
    expect(queueAdd).toHaveBeenCalledTimes(5);
  });

  it('worker: đúng 3 push cho 5 khách trong cùng đợt, 2 thông báo còn lại SKIPPED nhưng vẫn có trong hộp', async () => {
    const customerIds = await createCustomers(5);
    queueAdd.mockClear();
    await bulkAssign(customerIds, 'req-bulk-2');

    await runQueuedJobs();

    expect(send).toHaveBeenCalledTimes(3);
    const docs = await notificationsOfTarget(customerIds);
    expect(docs.filter((d) => d.pushStatus === 'SENT')).toHaveLength(3);
    expect(docs.filter((d) => d.pushStatus === 'SKIPPED')).toHaveLength(2);
    expect(docs).toHaveLength(5);
  });

  it('đợt khác (X-Request-ID khác) dùng bộ đếm khác: lại được 3 push', async () => {
    const customerIds = await createCustomers(4);
    queueAdd.mockClear();
    await bulkAssign(customerIds, 'req-bulk-3');

    await runQueuedJobs();

    expect(send).toHaveBeenCalledTimes(3);
    const docs = await notificationsOfTarget(customerIds);
    expect(new Set(docs.map((d) => d.pushGroupKey))).toEqual(
      new Set(['BULK:req-bulk-3']),
    );
  });

  it('X-Request-ID quá dài bị cắt còn 128 ký tự trong pushGroupKey', async () => {
    const customerIds = await createCustomers(1);
    queueAdd.mockClear();
    const longId = 'x'.repeat(300);

    await bulkAssign(customerIds, longId);

    const [doc] = await notificationsOfTarget(customerIds);
    expect(doc.pushGroupKey).toBe(`BULK:${'x'.repeat(MAX_REQUEST_ID_LENGTH)}`);
  });
});
