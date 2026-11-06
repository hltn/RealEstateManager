/**
 * INTEGRATION — T-26 `POST /push-subscriptions` (FR-01) qua HTTP thật: Fastify + ValidationPipe + GlobalExceptionFilter
 * + ThrottlerGuard/JwtAuthGuard/RolesGuard + CrmFeatureGuard trên MongoDB Replica Set thật (mongodb-memory-server).
 * Không cần Redis (collection `push_subscriptions` và Throttler tự chứa). Các `it` dùng chung app nhưng mỗi `it`
 * tự dựng người dùng/endpoint riêng (bộ đếm 10/phút theo người nên không dùng chung người giữa các test).
 *
 * Chạy: npx jest --testRegex "push-subscriptions.integration.spec" --testPathIgnorePatterns /node_modules/ --runInBand --forceExit
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
import { UserRole } from '../../../common/enums/user-role.enum';
import { GlobalExceptionFilter } from '../../../common/filters/global-exception.filter';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { createMemoryReplSet } from '../../../shared/database/memory-replset.util';
import { FeatureFlagModule } from '../../../shared/feature-flags/feature-flag.module';
import {
  EncryptedPayload,
  PiiCryptoService,
} from '../../crm/common/crypto/pii-crypto.service';
import { NotificationsModule } from '../notifications.module';
import {
  buildPushAuthAad,
  computePushEndpointHash,
} from './push-endpoint.policy';

jest.setTimeout(300_000);

const JWT_SECRET = 'integration-secret';
const DAY_MS = 24 * 60 * 60 * 1000;

const P256DH = Buffer.concat([
  Buffer.from([0x04]),
  Buffer.alloc(64, 7),
]).toString('base64url');
/** 16 byte -> base64url 22 ký tự. */
const AUTH_OF = (seed: string) =>
  Buffer.from(seed.padEnd(16, '_').slice(0, 16)).toString('base64url');

const UA_IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';
const UA_ANDROID =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Mobile Safari/537.36';

interface Res {
  status: number;
  body: any;
}

describe('T-26 POST /push-subscriptions (FR-01)', () => {
  let replSet: MongoMemoryReplSet;
  let app: NestFastifyApplication;
  let connection: Connection;
  let jwt: JwtService;
  let crypto: PiiCryptoService;

  const col = () => connection.collection('push_subscriptions');
  const endpointOf = () =>
    `https://fcm.googleapis.com/fcm/send/${randomUUID()}`;

  /** Tạo người dùng giả (JWT không tra DB) và trả token + id. */
  const newUser = (role: UserRole = UserRole.STAFF) => {
    const id = new Types.ObjectId().toHexString();
    const token = jwt.sign({ sub: id, email: `${id}@test.vn`, role });
    return { id, token };
  };

  const register = async (
    token: string | null,
    body: unknown,
    userAgent = UA_ANDROID,
  ): Promise<Res> => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/push-subscriptions',
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        'user-agent': userAgent,
      },
      payload: body as never,
    });
    let parsed: unknown;
    try {
      parsed = res.body ? JSON.parse(res.body) : undefined;
    } catch {
      parsed = res.body;
    }
    return { status: res.statusCode, body: parsed };
  };

  const validBody = (
    endpoint = endpointOf(),
    auth = AUTH_OF(randomUUID()),
  ) => ({
    endpoint,
    keys: { p256dh: P256DH, auth },
  });

  const activeCount = (userId: string) =>
    col().countDocuments({
      userId: new Types.ObjectId(userId),
      revokedAt: null,
    });

  beforeAll(async () => {
    process.env.FEATURE_CRM_ENABLED = 'true';
    // Cờ push cố ý TẮT: API đăng ký vẫn phải hoạt động (Architecture 4.1, Plan mục 3 quy tắc 12).
    process.env.FEATURE_CRM_PUSH = 'false';
    process.env.CRM_PII_ENCRYPTION_KEY = 'ab'.repeat(32);
    replSet = await createMemoryReplSet();

    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        MongooseModule.forRoot(replSet.getUri()),
        JwtModule.register({ secret: JWT_SECRET }),
        ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]),
        FeatureFlagModule,
        NotificationsModule,
      ],
      providers: [
        { provide: APP_GUARD, useClass: ThrottlerGuard },
        { provide: APP_GUARD, useClass: JwtAuthGuard },
        { provide: APP_GUARD, useClass: RolesGuard },
      ],
    }).compile();

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
    jwt = app.get(JwtService);
    crypto = app.get(PiiCryptoService);
    await Promise.all(
      connection.modelNames().map((name) => connection.model(name).init()),
    );
  });

  afterAll(async () => {
    await app?.close();
    await replSet?.stop();
  });

  describe('quyền truy cập', () => {
    it('FR-01: không token thì 401', async () => {
      const res = await register(null, validBody());
      expect(res.status).toBe(401);
    });

    it('FR-01: EDITOR (ngoài CRM_ROLES) thì 403, không ghi DB', async () => {
      const editor = newUser(UserRole.EDITOR);
      const body = validBody();
      const res = await register(editor.token, body);
      expect(res.status).toBe(403);
      expect(await col().countDocuments({ endpoint: body.endpoint })).toBe(0);
    });

    it.each([UserRole.ADMIN, UserRole.MANAGER, UserRole.STAFF])(
      'FR-01: %s đăng ký được (201)',
      async (role) => {
        const user = newUser(role);
        const res = await register(user.token, validBody());
        expect(res.status).toBe(201);
      },
    );
  });

  describe('đăng ký mới', () => {
    it('FR-01: 201, trả đúng dữ liệu, không lộ endpoint/khóa; DB lưu auth đã mã hóa, không lưu UA thô', async () => {
      const user = newUser();
      const auth = AUTH_OF('auth-secret-one');
      const body = validBody(endpointOf(), auth);

      const res = await register(user.token, body, UA_IPHONE);

      expect(res.status).toBe(201);
      expect(res.body.data).toEqual({
        id: expect.any(String),
        deviceLabel: 'iPhone · Safari',
        platform: 'IOS',
        createdAt: expect.any(String),
        lastSeenAt: expect.any(String),
        displaced: null,
      });
      const wire = JSON.stringify(res.body);
      expect(wire).not.toContain(body.endpoint);
      expect(wire).not.toContain(auth);
      expect(wire).not.toContain(P256DH);

      const doc = await col().findOne({ endpoint: body.endpoint });
      expect(String(doc?._id)).toBe(res.body.data.id);
      expect(String(doc?.userId)).toBe(user.id);
      expect(doc?.revokedAt).toBeNull();
      expect(doc?.revokedReason).toBeNull();
      expect(doc?.purgeAt).toBeNull();
      expect(doc?.expirationTime).toBeNull();
      const hash = computePushEndpointHash(body.endpoint);
      expect(doc?.endpointHash).toBe(hash);
      expect(doc?.keys.p256dh).toBe(P256DH);
      expect(
        JSON.stringify((doc?.keys as { authEnc: EncryptedPayload }).authEnc),
      ).not.toContain(auth);
      expect(
        crypto.decrypt(
          (doc?.keys as { authEnc: EncryptedPayload }).authEnc,
          buildPushAuthAad(user.id, hash),
        ),
      ).toBe(auth);
      expect(JSON.stringify(doc)).not.toContain('Mozilla');
    });

    it('FR-01: lưu expirationTime thành Date khi trình duyệt gửi', async () => {
      const user = newUser();
      const expiresAt = Date.now() + 30 * DAY_MS;
      const body = { ...validBody(), expirationTime: expiresAt };
      const res = await register(user.token, body);
      expect(res.status).toBe(201);
      const doc = await col().findOne({ endpoint: body.endpoint });
      expect(doc?.expirationTime).toEqual(new Date(expiresAt));
    });

    it('FR-01: expirationTime null được chấp nhận', async () => {
      const user = newUser();
      const res = await register(user.token, {
        ...validBody(),
        expirationTime: null,
      });
      expect(res.status).toBe(201);
    });
  });

  describe('upsert theo endpoint', () => {
    it('FR-01: đăng ký lại cùng endpoint cùng người thì 200, cùng id, không thành thiết bị mới, lastSeenAt mới hơn', async () => {
      const user = newUser();
      const body = validBody();
      const first = await register(user.token, body);
      await new Promise((resolve) => setTimeout(resolve, 20));

      const second = await register(user.token, body);

      expect(first.status).toBe(201);
      expect(second.status).toBe(200);
      expect(second.body.data.id).toBe(first.body.data.id);
      expect(
        new Date(second.body.data.lastSeenAt as string).getTime(),
      ).toBeGreaterThan(
        new Date(first.body.data.lastSeenAt as string).getTime(),
      );
      expect(second.body.data.createdAt).toBe(first.body.data.createdAt);
      expect(await col().countDocuments({ endpoint: body.endpoint })).toBe(1);
      expect(await activeCount(user.id)).toBe(1);
    });

    it('FR-01: làm mới cập nhật cả khóa mới (auth đổi thì giải mã ra auth mới)', async () => {
      const user = newUser();
      const endpoint = endpointOf();
      await register(user.token, validBody(endpoint, AUTH_OF('auth-old')));

      await register(user.token, validBody(endpoint, AUTH_OF('auth-new')));

      const doc = await col().findOne({ endpoint });
      const hash = computePushEndpointHash(endpoint);
      expect(
        crypto.decrypt(
          (doc?.keys as { authEnc: EncryptedPayload }).authEnc,
          buildPushAuthAad(user.id, hash),
        ),
      ).toBe(AUTH_OF('auth-new'));
    });

    it('FR-01: endpoint của người khác thì gán lại cho người gọi, mã hóa lại auth theo AAD người mới, người cũ mất thiết bị', async () => {
      const owner = newUser();
      const taker = newUser();
      const endpoint = endpointOf();
      await register(owner.token, validBody(endpoint, AUTH_OF('owner-auth')));
      expect(await activeCount(owner.id)).toBe(1);

      const res = await register(
        taker.token,
        validBody(endpoint, AUTH_OF('taker-auth')),
      );

      expect(res.status).toBe(200);
      const doc = await col().findOne({ endpoint });
      expect(String(doc?.userId)).toBe(taker.id);
      const hash = computePushEndpointHash(endpoint);
      expect(
        crypto.decrypt(
          (doc?.keys as { authEnc: EncryptedPayload }).authEnc,
          buildPushAuthAad(taker.id, hash),
        ),
      ).toBe(AUTH_OF('taker-auth'));
      expect(() =>
        crypto.decrypt(
          (doc?.keys as { authEnc: EncryptedPayload }).authEnc,
          buildPushAuthAad(owner.id, hash),
        ),
      ).toThrow();
      expect(await activeCount(owner.id)).toBe(0);
      expect(await activeCount(taker.id)).toBe(1);
      expect(await col().countDocuments({ endpoint })).toBe(1);
    });

    it('FR-01: endpoint đã thu hồi thì đăng ký lại là upsert gán lại, xóa dấu thu hồi và purgeAt', async () => {
      const user = newUser();
      const endpoint = endpointOf();
      const first = await register(user.token, validBody(endpoint));
      await col().updateOne(
        { endpoint },
        {
          $set: {
            revokedAt: new Date(),
            revokedReason: 'USER',
            purgeAt: new Date(Date.now() + 7 * DAY_MS),
          },
        },
      );
      expect(await activeCount(user.id)).toBe(0);

      const res = await register(user.token, validBody(endpoint));

      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe(first.body.data.id);
      const doc = await col().findOne({ endpoint });
      expect(doc?.revokedAt).toBeNull();
      expect(doc?.revokedReason).toBeNull();
      expect(doc?.purgeAt).toBeNull();
      expect(await activeCount(user.id)).toBe(1);
    });

    it('FR-01: đua nhiều yêu cầu cùng endpoint (E11000 thử lại) vẫn chỉ có đúng một bản ghi và mọi yêu cầu thành công', async () => {
      const user = newUser();
      const endpoint = endpointOf();

      const results = await Promise.all(
        Array.from({ length: 6 }, () =>
          register(user.token, validBody(endpoint)),
        ),
      );

      expect(
        results.map((r) => r.status).every((s) => s === 200 || s === 201),
      ).toBe(true);
      expect(results.filter((r) => r.status === 201)).toHaveLength(1);
      expect(new Set(results.map((r) => r.body.data.id)).size).toBe(1);
      expect(await col().countDocuments({ endpoint })).toBe(1);
    });
  });

  describe('giới hạn 3 thiết bị', () => {
    /** Đặt `lastSeenAt` xác định để thứ tự "ít hoạt động nhất" không phụ thuộc đồng hồ. */
    const setLastSeen = (endpoint: string, ageDays: number) =>
      col().updateOne(
        { endpoint },
        { $set: { lastSeenAt: new Date(Date.now() - ageDays * DAY_MS) } },
      );

    it('FR-01: thiết bị thứ 4 gỡ thiết bị ít hoạt động nhất (LIMIT_EXCEEDED, purgeAt +7 ngày) và trả displaced', async () => {
      const user = newUser();
      const bystander = newUser();
      const [e1, e2, e3, e4] = [
        endpointOf(),
        endpointOf(),
        endpointOf(),
        endpointOf(),
      ];
      const ids: string[] = [];
      for (const endpoint of [e1, e2, e3]) {
        const res = await register(user.token, validBody(endpoint));
        ids.push(res.body.data.id as string);
      }
      await setLastSeen(e1, 10); // cũ nhất
      await setLastSeen(e2, 5);
      await setLastSeen(e3, 1);
      await register(bystander.token, validBody());

      const res = await register(user.token, validBody(e4), UA_IPHONE);

      expect(res.status).toBe(201);
      expect(res.body.data.displaced).toEqual({
        id: ids[0],
        deviceLabel: 'Android · Chrome',
      });
      const revoked = await col().findOne({ endpoint: e1 });
      expect(revoked?.revokedReason).toBe('LIMIT_EXCEEDED');
      expect(revoked?.revokedAt).toBeInstanceOf(Date);
      const retention =
        (revoked?.purgeAt as Date).getTime() -
        (revoked?.revokedAt as Date).getTime();
      expect(retention).toBe(7 * DAY_MS);
      for (const endpoint of [e2, e3, e4]) {
        expect((await col().findOne({ endpoint }))?.revokedAt).toBeNull();
      }
      expect(await activeCount(user.id)).toBe(3);
      expect(await activeCount(bystander.id)).toBe(1);
    });

    it('FR-01: đăng ký lại một thiết bị đang có khi đã đủ 3 thì không tính thiết bị mới, không gỡ ai', async () => {
      const user = newUser();
      const endpoints = [endpointOf(), endpointOf(), endpointOf()];
      for (const endpoint of endpoints) {
        await register(user.token, validBody(endpoint));
      }

      const res = await register(user.token, validBody(endpoints[0]));

      expect(res.status).toBe(200);
      expect(res.body.data.displaced).toBeNull();
      expect(await activeCount(user.id)).toBe(3);
    });

    it('FR-01: thiết bị vừa đăng ký không bao giờ bị gỡ dù lastSeenAt của thiết bị cũ mới hơn đồng hồ', async () => {
      const user = newUser();
      const endpoints = [endpointOf(), endpointOf(), endpointOf()];
      for (const endpoint of endpoints) {
        await register(user.token, validBody(endpoint));
        // lastSeenAt trong tương lai: nếu logic chỉ dựa vào thứ tự thời gian thì thiết bị mới sẽ bị gỡ nhầm.
        await col().updateOne(
          { endpoint },
          { $set: { lastSeenAt: new Date(Date.now() + DAY_MS) } },
        );
      }
      const fresh = endpointOf();

      const res = await register(user.token, validBody(fresh));

      expect(res.body.data.displaced).not.toBeNull();
      expect((await col().findOne({ endpoint: fresh }))?.revokedAt).toBeNull();
      expect(await activeCount(user.id)).toBe(3);
    });

    it('FR-01: thiết bị đã thu hồi không tính vào giới hạn 3', async () => {
      const user = newUser();
      const endpoints = [endpointOf(), endpointOf(), endpointOf()];
      for (const endpoint of endpoints) {
        await register(user.token, validBody(endpoint));
      }
      await col().updateOne(
        { endpoint: endpoints[0] },
        { $set: { revokedAt: new Date(), revokedReason: 'USER' } },
      );

      const res = await register(user.token, validBody());

      expect(res.body.data.displaced).toBeNull();
      expect(await activeCount(user.id)).toBe(3);
    });

    it('FR-01: bốn thiết bị đăng ký đồng thời thì sau cùng đúng 3 thiết bị hiệu lực, 1 cái LIMIT_EXCEEDED', async () => {
      // Trước đây mỗi yêu cầu ép giữ cái của mình nên kết quả là 0 hoặc 2 chứ không bao giờ 3 (lỗi đua `enforceLimit`).
      const user = newUser();

      const results = await Promise.all(
        Array.from({ length: 4 }, () => register(user.token, validBody())),
      );

      expect(results.every((r) => r.status === 201)).toBe(true);
      expect(await activeCount(user.id)).toBe(3);
      expect(
        await col().countDocuments({
          userId: new Types.ObjectId(user.id),
          revokedReason: 'LIMIT_EXCEEDED',
        }),
      ).toBe(1);
    });
  });

  describe('kiểm đầu vào', () => {
    it.each([
      ['http không phải https', 'http://fcm.googleapis.com/fcm/send/x'],
      ['host lạ', 'https://evil.example.com/x'],
      ['IP metadata (SSRF)', 'https://169.254.169.254/latest/meta-data'],
      ['localhost', 'https://localhost/x'],
      ['lách bằng @', 'https://fcm.googleapis.com@evil.com/x'],
      ['dài quá 1024', `https://fcm.googleapis.com/${'a'.repeat(1100)}`],
    ])(
      'FR-01: endpoint %s thì 400 PUSH_SUBSCRIPTION_INVALID, không ghi DB',
      async (_name, endpoint) => {
        const user = newUser();
        const res = await register(user.token, validBody(endpoint));
        expect(res.status).toBe(400);
        expect(res.body.errorCode).toBe('PUSH_SUBSCRIPTION_INVALID');
        expect(JSON.stringify(res.body)).not.toContain('evil.example.com');
        expect(await col().countDocuments({ endpoint })).toBe(0);
      },
    );

    it('FR-01: khóa sai độ dài thì 400 PUSH_SUBSCRIPTION_INVALID', async () => {
      const user = newUser();
      const shortKey = await register(user.token, {
        endpoint: endpointOf(),
        keys: { p256dh: P256DH.slice(0, 80), auth: AUTH_OF('a') },
      });
      const badAuth = await register(user.token, {
        endpoint: endpointOf(),
        keys: { p256dh: P256DH, auth: 'short' },
      });
      expect(shortKey.status).toBe(400);
      expect(shortKey.body.errorCode).toBe('PUSH_SUBSCRIPTION_INVALID');
      expect(badAuth.status).toBe(400);
      expect(badAuth.body.errorCode).toBe('PUSH_SUBSCRIPTION_INVALID');
    });

    it('FR-01: thiếu trường, sai kiểu hoặc trường thừa thì 400 VALIDATION_FAILED', async () => {
      const user = newUser();
      const cases: unknown[] = [
        {},
        { endpoint: endpointOf() },
        { endpoint: 123, keys: { p256dh: P256DH, auth: AUTH_OF('a') } },
        { ...validBody(), expirationTime: 'mai' },
        { ...validBody(), expirationTime: -5 },
        { ...validBody(), userId: new Types.ObjectId().toHexString() },
      ];
      for (const body of cases) {
        const res = await register(user.token, body);
        expect([res.status, res.body.errorCode]).toEqual([
          400,
          'VALIDATION_FAILED',
        ]);
      }
    });

    it('FR-01: userId luôn lấy từ JWT, không đăng ký hộ người khác được', async () => {
      const user = newUser();
      const other = newUser();
      const body = { ...validBody(), userId: other.id };
      const res = await register(user.token, body);
      expect(res.status).toBe(400);
      expect(await activeCount(other.id)).toBe(0);
    });
  });

  describe('giới hạn tần suất 10/phút theo userId', () => {
    it('FR-01: yêu cầu thứ 11 trong một phút bị 429, người khác cùng IP không bị ảnh hưởng', async () => {
      const heavy = newUser();
      const light = newUser();
      const endpoint = endpointOf();

      const statuses: number[] = [];
      for (let i = 0; i < 10; i++) {
        statuses.push(
          (await register(heavy.token, validBody(endpoint))).status,
        );
      }
      const eleventh = await register(heavy.token, validBody(endpoint));
      const otherUser = await register(light.token, validBody());

      expect(statuses.every((s) => s === 200 || s === 201)).toBe(true);
      expect(eleventh.status).toBe(429);
      expect(eleventh.body.errorCode).toBe('RATE_LIMITED');
      expect(otherUser.status).toBe(201);
    });

    it('FR-01: yêu cầu bị từ chối vì sai dữ liệu vẫn tính vào hạn mức (chặn dò endpoint)', async () => {
      const user = newUser();
      for (let i = 0; i < 10; i++) {
        const res = await register(
          user.token,
          validBody('https://evil.example.com/x'),
        );
        expect(res.status).toBe(400);
      }
      const res = await register(user.token, validBody());
      expect(res.status).toBe(429);
    });
  });

  describe('cờ FEATURE_CRM_PUSH tắt', () => {
    it('FR-01: API vẫn hoạt động khi cờ push tắt (lưu để không mất khi bật cờ sau)', async () => {
      expect(process.env.FEATURE_CRM_PUSH).toBe('false');
      const user = newUser();
      const res = await register(user.token, validBody());
      expect(res.status).toBe(201);
    });
  });

  describe('index của collection mới (tạo bằng schema, không qua migration)', () => {
    it('FR-01: có unique endpoint, index {userId,revokedAt,lastSeenAt}, endpointHash và TTL purgeAt', async () => {
      const indexes = await col().indexes();
      const byKey = (key: Record<string, number>) =>
        indexes.find((i) => JSON.stringify(i.key) === JSON.stringify(key));

      expect(byKey({ endpoint: 1 })?.unique).toBe(true);
      expect(byKey({ userId: 1, revokedAt: 1, lastSeenAt: -1 })).toBeDefined();
      expect(byKey({ endpointHash: 1 })).toBeDefined();
      expect(byKey({ purgeAt: 1 })?.expireAfterSeconds).toBe(0);
    });

    it('FR-01: endpoint trùng bị chặn bởi unique index ở tầng DB', async () => {
      const user = newUser();
      const body = validBody();
      await register(user.token, body);
      const doc = await col().findOne({ endpoint: body.endpoint });
      const { _id, ...rest } = doc as Record<string, unknown>;
      void _id;
      await expect(col().insertOne({ ...rest })).rejects.toMatchObject({
        code: 11000,
      });
    });
  });
});
