/**
 * INTEGRATION — thu hồi thiết bị push qua AuthModule + UsersModule THẬT (guard toàn cục, ValidationPipe
 * whitelist + forbidNonWhitelisted, GlobalExceptionFilter) trên MongoDB Replica Set thật (in-memory):
 * - T-28 `POST /auth/logout` (body tùy chọn `pushSubscriptionId`).
 * - T-30 `PATCH /users/:id/status` khóa tài khoản thu hồi `ACCOUNT_DISABLED` cùng transaction với audit.
 * Cookie plugin bị giả lập (không chạy được dưới Jest CJS), giống users-account-edit.integration.spec.
 */
import { ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { getConnectionToken, MongooseModule } from '@nestjs/mongoose';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import * as argon2 from 'argon2';
import type { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Connection, Types } from 'mongoose';
import { GlobalExceptionFilter } from '../../common/filters/global-exception.filter';
import { createMemoryReplSet } from '../../shared/database/memory-replset.util';
import { FeatureFlagModule } from '../../shared/feature-flags/feature-flag.module';
import { createRedisClientStub } from '../../shared/redis/redis-client.fixture';
import { REDIS_CLIENT } from '../../shared/redis/redis.constants';
import { CrmAuditLogService } from '../crm/audit-logs/crm-audit-log.service';
import { UsersModule } from '../users/users.module';
import { AuthModule } from './auth.module';

jest.setTimeout(240_000);

const PASSWORD = 'Start@123456';

describe('Thu hồi thiết bị push (AuthModule + UsersModule thật)', () => {
  let replSet: MongoMemoryReplSet;
  let app: NestFastifyApplication;
  let connection: Connection;
  const ids: Record<string, string> = {};
  const tokens: Record<string, string> = {};

  const send = async (
    method: 'POST' | 'PATCH',
    url: string,
    token: string | null,
    payload?: unknown,
  ) => {
    const res = await app.inject({
      method,
      url: `/api/v1${url}`,
      headers: token ? { authorization: `Bearer ${token}` } : {},
      payload: payload as never,
    });
    return {
      status: res.statusCode,
      body: res.body ? JSON.parse(res.body) : undefined,
    };
  };

  const insertUser = async (email: string, role: string) => {
    const { insertedId } = await connection.collection('users').insertOne({
      email,
      password: await argon2.hash(PASSWORD),
      displayName: `User ${email}`,
      role,
      roles: [role],
      status: 'ACTIVE',
      teamId: null,
      teamIds: [],
      deletedAt: null,
      lastLoginAt: null,
    });
    return insertedId.toHexString();
  };

  const login = async (email: string): Promise<string> => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email, password: PASSWORD },
    });
    return JSON.parse(res.body).accessToken as string;
  };

  /** Chèn thẳng một thiết bị push còn hiệu lực của `userId`, trả id. */
  const seedDevice = async (userId: string): Promise<string> => {
    const _id = new Types.ObjectId();
    await connection.collection('push_subscriptions').insertOne({
      _id,
      userId: new Types.ObjectId(userId),
      endpoint: `https://fcm.googleapis.com/fcm/send/${_id.toHexString()}`,
      endpointHash: _id.toHexString(),
      keys: { p256dh: 'x', authEnc: {} },
      expirationTime: null,
      platform: 'ANDROID',
      deviceLabel: 'Android · Chrome',
      lastSeenAt: new Date(),
      revokedAt: null,
      revokedReason: null,
      purgeAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    return _id.toHexString();
  };

  const deviceOf = (id: string) =>
    connection
      .collection('push_subscriptions')
      .findOne({ _id: new Types.ObjectId(id) }) as Promise<any>;

  beforeAll(async () => {
    process.env.AUTH_LOGIN_THROTTLE_LIMIT = '10000';
    replSet = await createMemoryReplSet();
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [() => ({ JWT_SECRET: 'qa-push-revoke-secret' })],
        }),
        MongooseModule.forRoot(replSet.getUri()),
        FeatureFlagModule,
        AuthModule,
        UsersModule,
      ],
    })
      // Không cần Redis thật: NotificationsModule kéo theo RedisModule, tránh tự kết nối Redis của máy.
      .overrideProvider(REDIS_CLIENT)
      .useValue(createRedisClientStub())
      .compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    const fastify = app.getHttpAdapter().getInstance() as unknown as {
      decorateReply: (name: string, value: unknown) => void;
      decorateRequest: (name: string, value: unknown) => void;
      addHook: (
        name: 'onRequest',
        fn: (req: any, reply: unknown, done: () => void) => void,
      ) => void;
    };
    fastify.decorateReply('setCookie', function (this: unknown) {
      return this;
    });
    fastify.decorateReply('clearCookie', function (this: unknown) {
      return this;
    });
    fastify.decorateRequest('cookies', null);
    fastify.addHook('onRequest', (req, _reply, done) => {
      req.cookies = {};
      done();
    });
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
    await Promise.all(
      connection.modelNames().map((name) => connection.model(name).init()),
    );

    ids.admin = await insertUser('admin@push.test', 'ADMIN');
    ids.staff = await insertUser('staff@push.test', 'STAFF');
    ids.other = await insertUser('other@push.test', 'STAFF');
    ids.target = await insertUser('target@push.test', 'EDITOR');
    tokens.admin = await login('admin@push.test');
    tokens.staff = await login('staff@push.test');
  });

  afterAll(async () => {
    delete process.env.AUTH_LOGIN_THROTTLE_LIMIT;
    await app?.close();
    await replSet?.stop();
  });

  describe('T-28 POST /auth/logout', () => {
    it('không body: đăng xuất thành công, thiết bị giữ nguyên', async () => {
      const device = await seedDevice(ids.staff);
      const res = await send('POST', '/auth/logout', tokens.staff);
      expect(res.status).toBe(201);
      expect(res.body.message).toBe('Logged out successfully');
      expect((await deviceOf(device)).revokedAt).toBeNull();
    });

    it('id thiết bị của mình: thu hồi với lý do LOGOUT', async () => {
      const device = await seedDevice(ids.staff);
      const res = await send('POST', '/auth/logout', tokens.staff, {
        pushSubscriptionId: device,
      });
      expect(res.status).toBe(201);
      const doc = await deviceOf(device);
      expect(doc.revokedAt).toBeInstanceOf(Date);
      expect(doc.revokedReason).toBe('LOGOUT');
    });

    it('id của người khác hoặc id lạ/sai định dạng: bỏ qua im lặng, phản hồi y hệt', async () => {
      const baseline = await send('POST', '/auth/logout', tokens.staff);
      const theirs = await seedDevice(ids.other);
      const cases = [
        theirs,
        new Types.ObjectId().toHexString(),
        'khong-phai-objectid',
      ];
      for (const pushSubscriptionId of cases) {
        const res = await send('POST', '/auth/logout', tokens.staff, {
          pushSubscriptionId,
        });
        expect(res.status).toBe(baseline.status);
        expect(res.body).toEqual(baseline.body);
      }
      expect((await deviceOf(theirs)).revokedAt).toBeNull();
    });

    it('thiếu JWT thì 401, thiết bị không bị thu hồi', async () => {
      const device = await seedDevice(ids.staff);
      const res = await send('POST', '/auth/logout', null, {
        pushSubscriptionId: device,
      });
      expect(res.status).toBe(401);
      expect((await deviceOf(device)).revokedAt).toBeNull();
    });

    it('field lạ hoặc sai kiểu thì 400', async () => {
      const device = await seedDevice(ids.staff);
      const unknown = await send('POST', '/auth/logout', tokens.staff, {
        pushSubscriptionId: device,
        userId: ids.other,
      });
      const wrongType = await send('POST', '/auth/logout', tokens.staff, {
        pushSubscriptionId: 123,
      });
      expect(unknown.status).toBe(400);
      expect(wrongType.status).toBe(400);
      expect((await deviceOf(device)).revokedAt).toBeNull();
    });
  });

  describe('T-30 UsersService.updateStatus', () => {
    it('BLOCKED: thiết bị ACCOUNT_DISABLED cùng transaction; ACTIVE lại không khôi phục thiết bị', async () => {
      const device = await seedDevice(ids.target);
      const bystander = await seedDevice(ids.other);

      const res = await send(
        'PATCH',
        `/users/${ids.target}/status`,
        tokens.admin,
        { status: 'BLOCKED' },
      );
      expect(res.status).toBe(200);
      const doc = await deviceOf(device);
      expect(doc.revokedReason).toBe('ACCOUNT_DISABLED');
      expect(doc.revokedAt).toBeInstanceOf(Date);
      expect((await deviceOf(bystander)).revokedAt).toBeNull();

      await send('PATCH', `/users/${ids.target}/status`, tokens.admin, {
        status: 'ACTIVE',
      });
      expect((await deviceOf(device)).revokedAt).toBeInstanceOf(Date);
    });

    it('audit ném lỗi: rollback cả đổi trạng thái lẫn thu hồi (thiết bị vẫn ACTIVE)', async () => {
      const device = await seedDevice(ids.target);
      const spy = jest
        .spyOn(app.get(CrmAuditLogService), 'record')
        .mockRejectedValue(new Error('audit down'));
      try {
        const res = await send(
          'PATCH',
          `/users/${ids.target}/status`,
          tokens.admin,
          { status: 'BLOCKED' },
        );
        expect(res.status).toBe(500);
      } finally {
        spy.mockRestore();
      }
      const doc = await deviceOf(device);
      expect(doc.revokedAt).toBeNull();
      expect(doc.revokedReason).toBeNull();
      const user = (await connection
        .collection('users')
        .findOne({ _id: new Types.ObjectId(ids.target) })) as any;
      expect(user.status).toBe('ACTIVE');
    });
  });
});
