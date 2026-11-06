/**
 * INTEGRATION — T-27 (`GET/DELETE /push-subscriptions`, `GET /push-subscriptions/config`), T-28 (thu hồi lúc đăng xuất)
 * và T-29 (`push.cleanup`, khóa tài khoản) qua HTTP thật: Fastify + ValidationPipe + GlobalExceptionFilter +
 * JwtAuthGuard/RolesGuard + CrmFeatureGuard trên MongoDB Replica Set thật (mongodb-memory-server). Không cần Redis.
 * Nhà cung cấp push được chọn lúc khởi động theo cờ + `VAPID_*` nên mỗi tổ hợp cấu hình dựng một app riêng.
 *
 * Chạy: npx jest --testRegex "push-subscriptions-management.integration.spec" --testPathIgnorePatterns /node_modules/ --runInBand --forceExit
 */
import { randomUUID } from 'crypto';
import { ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { getConnectionToken, MongooseModule } from '@nestjs/mongoose';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import type { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Connection, Types } from 'mongoose';
import * as webpush from 'web-push';
import { UserRole } from '../../../common/enums/user-role.enum';
import { GlobalExceptionFilter } from '../../../common/filters/global-exception.filter';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { createMemoryReplSet } from '../../../shared/database/memory-replset.util';
import { FeatureFlagModule } from '../../../shared/feature-flags/feature-flag.module';
import { NotificationsModule } from '../notifications.module';
import { PushCleanupService } from './push-cleanup.service';
import { PushSubscriptionManagementService } from './push-subscription-management.service';

jest.setTimeout(300_000);

const JWT_SECRET = 'integration-secret';
const DAY_MS = 24 * 60 * 60 * 1000;
const P256DH = Buffer.concat([
  Buffer.from([0x04]),
  Buffer.alloc(64, 7),
]).toString('base64url');
const AUTH = Buffer.alloc(16, 9).toString('base64url');
const UA_ANDROID =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Mobile Safari/537.36';
const VAPID = webpush.generateVAPIDKeys();

interface Res {
  status: number;
  body: any;
}

const ENV_KEYS = [
  'FEATURE_CRM_ENABLED',
  'FEATURE_CRM_PUSH',
  'CRM_PII_ENCRYPTION_KEY',
  'VAPID_SUBJECT',
  'VAPID_PUBLIC_KEY',
  'VAPID_PRIVATE_KEY',
] as const;

describe('T-27/T-28/T-29 quản lý thiết bị push', () => {
  let replSet: MongoMemoryReplSet;
  const apps: NestFastifyApplication[] = [];
  let app: NestFastifyApplication;
  let connection: Connection;
  let jwt: JwtService;
  const savedEnv: Record<string, string | undefined> = {};

  const col = () => connection.collection('push_subscriptions');

  const buildApp = async (
    env: Partial<Record<(typeof ENV_KEYS)[number], string>>,
  ): Promise<NestFastifyApplication> => {
    for (const key of ENV_KEYS) delete process.env[key];
    Object.assign(process.env, {
      FEATURE_CRM_ENABLED: 'true',
      CRM_PII_ENCRYPTION_KEY: 'ab'.repeat(32),
      ...env,
    });
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        MongooseModule.forRoot(replSet.getUri()),
        JwtModule.register({ secret: JWT_SECRET }),
        ThrottlerModule.forRoot([{ ttl: 60_000, limit: 1000 }]),
        FeatureFlagModule,
        NotificationsModule,
      ],
      providers: [
        { provide: APP_GUARD, useClass: ThrottlerGuard },
        { provide: APP_GUARD, useClass: JwtAuthGuard },
        { provide: APP_GUARD, useClass: RolesGuard },
      ],
    }).compile();
    const instance = moduleRef.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    instance.setGlobalPrefix('api/v1');
    instance.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    instance.useGlobalFilters(new GlobalExceptionFilter());
    await instance.init();
    await instance.getHttpAdapter().getInstance().ready();
    apps.push(instance);
    return instance;
  };

  const newUser = (role: UserRole = UserRole.STAFF) => {
    const id = new Types.ObjectId().toHexString();
    const token = jwt.sign({ sub: id, email: `${id}@test.vn`, role });
    return { id, token };
  };

  const call = async (
    target: NestFastifyApplication,
    method: 'GET' | 'POST' | 'DELETE',
    url: string,
    token: string | null,
    payload?: unknown,
  ): Promise<Res> => {
    const res = await target.inject({
      method,
      url: `/api/v1/push-subscriptions${url}`,
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        'user-agent': UA_ANDROID,
      },
      payload: payload as never,
    });
    let parsed: unknown;
    try {
      parsed = res.body ? JSON.parse(res.body) : undefined;
    } catch {
      parsed = res.body;
    }
    return { status: res.statusCode, body: parsed };
  };

  const register = (token: string) =>
    call(app, 'POST', '', token, {
      endpoint: `https://fcm.googleapis.com/fcm/send/${randomUUID()}`,
      keys: { p256dh: P256DH, auth: AUTH },
    });

  beforeAll(async () => {
    for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
    replSet = await createMemoryReplSet();
    // App chính: cờ push TẮT, API quản lý vẫn phải hoạt động.
    app = await buildApp({ FEATURE_CRM_PUSH: 'false' });
    connection = app.get<Connection>(getConnectionToken());
    jwt = app.get(JwtService);
    await Promise.all(
      connection.modelNames().map((name) => connection.model(name).init()),
    );
  });

  afterAll(async () => {
    for (const instance of apps) await instance.close();
    await replSet?.stop();
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
  });

  describe('quyền truy cập (CRM_ROLES)', () => {
    it.each([
      ['GET', ''],
      ['GET', '/config'],
      ['DELETE', `/${new Types.ObjectId().toHexString()}`],
    ] as const)('không token: %s %s thì 401', async (method, url) => {
      expect((await call(app, method, url, null)).status).toBe(401);
    });

    it.each([
      ['GET', ''],
      ['GET', '/config'],
      ['DELETE', `/${new Types.ObjectId().toHexString()}`],
    ] as const)('EDITOR (ngoài CRM_ROLES): %s %s thì 403', async (m, url) => {
      const editor = newUser(UserRole.EDITOR);
      expect((await call(app, m, url, editor.token)).status).toBe(403);
    });

    it.each([UserRole.ADMIN, UserRole.MANAGER, UserRole.STAFF])(
      '%s xem được danh sách và cấu hình',
      async (role) => {
        const user = newUser(role);
        expect((await call(app, 'GET', '', user.token)).status).toBe(200);
        expect((await call(app, 'GET', '/config', user.token)).status).toBe(
          200,
        );
      },
    );
  });

  describe('GET /push-subscriptions/config (FR-07)', () => {
    it('cờ tắt: enabled=false, publicKey=null (API vẫn chạy)', async () => {
      const user = newUser();
      const res = await call(app, 'GET', '/config', user.token);
      expect(res.body).toEqual({ data: { enabled: false, publicKey: null } });
    });

    it('cờ bật và đủ VAPID hợp lệ: enabled=true kèm publicKey, không lộ khóa riêng', async () => {
      const on = await buildApp({
        FEATURE_CRM_PUSH: 'true',
        VAPID_SUBJECT: 'mailto:admin@example.com',
        VAPID_PUBLIC_KEY: VAPID.publicKey,
        VAPID_PRIVATE_KEY: VAPID.privateKey,
      });
      const user = newUser();
      const res = await call(on, 'GET', '/config', user.token);
      expect(res.body).toEqual({
        data: { enabled: true, publicKey: VAPID.publicKey },
      });
      expect(JSON.stringify(res.body)).not.toContain(VAPID.privateKey);
    });

    it('cờ bật nhưng thiếu VAPID: enabled=false, publicKey=null', async () => {
      const missing = await buildApp({ FEATURE_CRM_PUSH: 'true' });
      const user = newUser();
      const res = await call(missing, 'GET', '/config', user.token);
      expect(res.body).toEqual({ data: { enabled: false, publicKey: null } });
    });
  });

  describe('GET /push-subscriptions (FR-05)', () => {
    it('chỉ thấy thiết bị của mình; không lộ endpoint/khóa; trống thì hai mảng rỗng', async () => {
      const mine = newUser();
      const other = newUser();
      expect((await call(app, 'GET', '', mine.token)).body).toEqual({
        data: { active: [], recentlyRevoked: [] },
      });
      const reg = await register(mine.token);
      await register(other.token);

      const res = await call(app, 'GET', '', mine.token);

      expect(res.status).toBe(200);
      expect(res.body.data.active).toEqual([
        {
          id: reg.body.data.id,
          deviceLabel: 'Android · Chrome',
          platform: 'ANDROID',
          lastSeenAt: expect.any(String),
          createdAt: expect.any(String),
        },
      ]);
      const wire = JSON.stringify(res.body);
      expect(wire).not.toContain('fcm.googleapis.com');
      expect(wire).not.toContain(P256DH);
    });

    it('recentlyRevoked chứa thiết bị bị nhường chỗ (LIMIT_EXCEEDED) và chỉ trong 7 ngày', async () => {
      const user = newUser();
      const first = await register(user.token);
      await register(user.token);
      await register(user.token);
      await col().updateOne(
        { _id: new Types.ObjectId(first.body.data.id as string) },
        { $set: { lastSeenAt: new Date(Date.now() - 5 * DAY_MS) } },
      );
      const fourth = await register(user.token);
      expect(fourth.body.data.displaced.id).toBe(first.body.data.id);
      // Một bản thu hồi quá 7 ngày (TTL chưa dọn kịp) không được hiện.
      await col().insertOne({
        userId: new Types.ObjectId(user.id),
        endpoint: `https://fcm.googleapis.com/fcm/send/${randomUUID()}`,
        endpointHash: randomUUID(),
        keys: { p256dh: P256DH, authEnc: {} },
        platform: 'ANDROID',
        deviceLabel: 'Cũ quá 7 ngày',
        lastSeenAt: new Date(Date.now() - 20 * DAY_MS),
        revokedAt: new Date(Date.now() - 8 * DAY_MS),
        revokedReason: 'USER',
        purgeAt: new Date(Date.now() - DAY_MS),
      });

      const res = await call(app, 'GET', '', user.token);

      expect(res.body.data.active).toHaveLength(3);
      expect(res.body.data.recentlyRevoked).toEqual([
        {
          deviceLabel: 'Android · Chrome',
          reason: 'LIMIT_EXCEEDED',
          revokedAt: expect.any(String),
        },
      ]);
      expect(JSON.stringify(res.body.data.recentlyRevoked)).not.toContain(
        first.body.data.id as string,
      );
    });
  });

  describe('DELETE /push-subscriptions/:id (FR-05)', () => {
    it('gỡ thiết bị của mình: 204, lý do USER, purgeAt +7 ngày; gỡ lại vẫn 204 và không đổi dấu thu hồi', async () => {
      const user = newUser();
      const reg = await register(user.token);
      const id = reg.body.data.id as string;

      const first = await call(app, 'DELETE', `/${id}`, user.token);
      const doc1 = await col().findOne({ _id: new Types.ObjectId(id) });
      const second = await call(app, 'DELETE', `/${id}`, user.token);
      const doc2 = await col().findOne({ _id: new Types.ObjectId(id) });

      expect(first.status).toBe(204);
      expect(second.status).toBe(204);
      expect(doc1?.revokedReason).toBe('USER');
      expect(
        (doc1?.purgeAt as Date).getTime() - (doc1?.revokedAt as Date).getTime(),
      ).toBe(7 * DAY_MS);
      expect(doc2?.revokedAt).toEqual(doc1?.revokedAt);
      const list = await call(app, 'GET', '', user.token);
      expect(list.body.data.active).toEqual([]);
      expect(list.body.data.recentlyRevoked).toHaveLength(1);
    });

    it('id của người khác thì 404 và thiết bị đó KHÔNG bị thu hồi', async () => {
      const owner = newUser();
      const attacker = newUser();
      const reg = await register(owner.token);
      const id = reg.body.data.id as string;

      const res = await call(app, 'DELETE', `/${id}`, attacker.token);

      expect(res.status).toBe(404);
      expect(res.body.errorCode).toBe('RESOURCE_NOT_FOUND');
      expect(
        (await col().findOne({ _id: new Types.ObjectId(id) }))?.revokedAt,
      ).toBeNull();
    });

    it('id không tồn tại thì 404, id sai định dạng thì 400', async () => {
      const user = newUser();
      const missing = await call(
        app,
        'DELETE',
        `/${new Types.ObjectId().toHexString()}`,
        user.token,
      );
      const bad = await call(app, 'DELETE', '/khong-hop-le', user.token);
      expect(missing.status).toBe(404);
      expect(bad.status).toBe(400);
    });
  });

  describe('T-28 thu hồi lúc đăng xuất', () => {
    it('id của chính mình: LOGOUT; id của người khác hoặc lạ: bỏ qua im lặng, không lộ', async () => {
      const management = app.get(PushSubscriptionManagementService);
      const user = newUser();
      const other = newUser();
      const mine = await register(user.token);
      const theirs = await register(other.token);

      await expect(
        management.revokeForLogout(user.id, theirs.body.data.id as string),
      ).resolves.toBe(false);
      await expect(
        management.revokeForLogout(user.id, new Types.ObjectId().toHexString()),
      ).resolves.toBe(false);
      await expect(
        management.revokeForLogout(user.id, mine.body.data.id as string),
      ).resolves.toBe(true);

      const mineDoc = await col().findOne({
        _id: new Types.ObjectId(mine.body.data.id as string),
      });
      const theirDoc = await col().findOne({
        _id: new Types.ObjectId(theirs.body.data.id as string),
      });
      expect(mineDoc?.revokedReason).toBe('LOGOUT');
      expect(theirDoc?.revokedAt).toBeNull();
    });
  });

  describe('T-29 push.cleanup (FR-05)', () => {
    const cleanup = () => app.get(PushCleanupService);

    /** Chèn thẳng một subscription với `lastSeenAt`/`expirationTime` xác định. */
    const seed = async (
      userId: string,
      fields: Record<string, unknown> = {},
    ): Promise<Types.ObjectId> => {
      const _id = new Types.ObjectId();
      await col().insertOne({
        _id,
        userId: new Types.ObjectId(userId),
        endpoint: `https://fcm.googleapis.com/fcm/send/${randomUUID()}`,
        endpointHash: randomUUID(),
        keys: { p256dh: P256DH, authEnc: {} },
        expirationTime: null,
        platform: 'ANDROID',
        deviceLabel: 'Android · Chrome',
        lastSeenAt: new Date(),
        revokedAt: null,
        revokedReason: null,
        purgeAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...fields,
      });
      return _id;
    };

    /** Người dùng ACTIVE thật để bước (c) không thu hồi nhầm. */
    const activeUser = async (): Promise<string> => {
      const _id = new Types.ObjectId();
      await connection.collection('users').insertOne({
        _id,
        email: `${_id.toHexString()}@test.vn`,
        status: 'ACTIVE',
        deletedAt: null,
      });
      return _id.toHexString();
    };

    it('ca biên 90 ngày: 89 và đúng 90 còn, 91 bị xóa cứng', async () => {
      const userId = await activeUser();
      const now = new Date('2026-06-01T00:00:00.000Z');
      const at = (days: number) => new Date(now.getTime() - days * DAY_MS);
      const d89 = await seed(userId, { lastSeenAt: at(89) });
      const d90 = await seed(userId, { lastSeenAt: at(90) });
      const d91 = await seed(userId, { lastSeenAt: at(91) });

      const result = await cleanup().run(now);

      expect(result.deleted).toBeGreaterThanOrEqual(1);
      expect(await col().findOne({ _id: d89 })).not.toBeNull();
      expect(await col().findOne({ _id: d90 })).not.toBeNull();
      expect(await col().findOne({ _id: d91 })).toBeNull();
    });

    it('chạy hai lần liên tiếp cho cùng kết quả (idempotent), hoạt động gần đây không bị xóa', async () => {
      const userId = await activeUser();
      const now = new Date();
      const recent = await seed(userId, { lastSeenAt: now });
      const stale = await seed(userId, {
        lastSeenAt: new Date(now.getTime() - 100 * DAY_MS),
      });

      await cleanup().run(now);
      const after1 = await col().countDocuments({
        userId: new Types.ObjectId(userId),
      });
      const second = await cleanup().run(now);
      const after2 = await col().countDocuments({
        userId: new Types.ObjectId(userId),
      });

      expect(after1).toBe(1);
      expect(after2).toBe(1);
      expect(second).toEqual({ deleted: 0, expired: 0, accountDisabled: 0 });
      expect(await col().findOne({ _id: recent })).not.toBeNull();
      expect(await col().findOne({ _id: stale })).toBeNull();
    });

    it('expirationTime đã qua thì thu hồi GONE (purgeAt +7 ngày); chưa tới hạn thì giữ', async () => {
      const userId = await activeUser();
      const now = new Date();
      const expired = await seed(userId, {
        expirationTime: new Date(now.getTime() - 1000),
      });
      const future = await seed(userId, {
        expirationTime: new Date(now.getTime() + DAY_MS),
      });

      await cleanup().run(now);

      const expiredDoc = await col().findOne({ _id: expired });
      expect(expiredDoc?.revokedReason).toBe('GONE');
      expect((expiredDoc?.purgeAt as Date).getTime()).toBe(
        now.getTime() + 7 * DAY_MS,
      );
      expect((await col().findOne({ _id: future }))?.revokedAt).toBeNull();
    });

    it('chủ bị khóa, đã xóa mềm hoặc không còn tồn tại thì thu hồi ACCOUNT_DISABLED; chủ ACTIVE giữ nguyên', async () => {
      const healthy = await activeUser();
      const blocked = new Types.ObjectId();
      const deleted = new Types.ObjectId();
      const ghost = new Types.ObjectId();
      await connection.collection('users').insertMany([
        {
          _id: blocked,
          email: `${blocked.toHexString()}@test.vn`,
          status: 'BLOCKED',
          deletedAt: null,
        },
        {
          _id: deleted,
          email: `${deleted.toHexString()}@test.vn`,
          status: 'ACTIVE',
          deletedAt: new Date(),
        },
      ]);
      const keep = await seed(healthy);
      const ids = [
        await seed(blocked.toHexString()),
        await seed(deleted.toHexString()),
        await seed(ghost.toHexString()),
      ];

      await cleanup().run(new Date());

      for (const id of ids) {
        expect((await col().findOne({ _id: id }))?.revokedReason).toBe(
          'ACCOUNT_DISABLED',
        );
      }
      expect((await col().findOne({ _id: keep }))?.revokedAt).toBeNull();
    });

    it('đăng ký lại sau khi bị dọn vẫn hoạt động bình thường', async () => {
      const user = newUser();
      const endpoint = `https://fcm.googleapis.com/fcm/send/${randomUUID()}`;
      const body = { endpoint, keys: { p256dh: P256DH, auth: AUTH } };
      await call(app, 'POST', '', user.token, body);
      await col().updateOne(
        { endpoint },
        { $set: { lastSeenAt: new Date(Date.now() - 100 * DAY_MS) } },
      );
      await cleanup().run(new Date());
      expect(await col().findOne({ endpoint })).toBeNull();

      const again = await call(app, 'POST', '', user.token, body);

      expect(again.status).toBe(201);
      expect((await col().findOne({ endpoint }))?.revokedAt).toBeNull();
    });

    it('khóa tài khoản thu hồi mọi thiết bị còn hiệu lực của người đó, không đụng người khác', async () => {
      const management = app.get(PushSubscriptionManagementService);
      const target = newUser();
      const bystander = newUser();
      await register(target.token);
      await register(target.token);
      await register(bystander.token);

      const revoked = await management.revokeAllForUser(target.id);

      expect(revoked).toBe(2);
      const list = await call(app, 'GET', '', target.token);
      expect(list.body.data.active).toEqual([]);
      expect(
        list.body.data.recentlyRevoked.map((r: { reason: string }) => r.reason),
      ).toEqual(['ACCOUNT_DISABLED', 'ACCOUNT_DISABLED']);
      expect(
        (await call(app, 'GET', '', bystander.token)).body.data.active,
      ).toHaveLength(1);
    });
  });

  describe('collection push_deliveries (schema)', () => {
    it('có unique {notificationId, subscriptionId} và TTL 30 ngày trên createdAt', async () => {
      const indexes = await connection.collection('push_deliveries').indexes();
      const byKey = (key: Record<string, number>) =>
        indexes.find((i) => JSON.stringify(i.key) === JSON.stringify(key));
      expect(byKey({ notificationId: 1, subscriptionId: 1 })?.unique).toBe(
        true,
      );
      expect(byKey({ createdAt: 1 })?.expireAfterSeconds).toBe(
        (30 * DAY_MS) / 1000,
      );
    });
  });
});
