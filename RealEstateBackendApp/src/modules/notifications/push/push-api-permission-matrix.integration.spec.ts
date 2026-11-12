/**
 * INTEGRATION — T-38 (3/3 phần quyền): MA TRẬN QUYỀN API push qua HTTP thật (FR-01, FR-05, FR-10, FR-12).
 *
 * Phủ cả 7 route của luồng push trong MỘT app (AuthModule + NotificationsModule thật: guard toàn cục
 * Throttler → JwtAuthGuard → RolesGuard, CrmFeatureGuard, ValidationPipe whitelist + forbidNonWhitelisted,
 * GlobalExceptionFilter) trên MongoDB Replica Set thật (mongodb-memory-server). Không cần Redis (Redis giả).
 *
 *   GET    /push-subscriptions/config          CRM_ROLES
 *   GET    /push-subscriptions                 CRM_ROLES, chỉ của mình
 *   POST   /push-subscriptions                 CRM_ROLES, userId lấy từ JWT
 *   DELETE /push-subscriptions/:id             CRM_ROLES, của người khác = 404
 *   GET    /notification-preferences/me        CRM_ROLES, Self
 *   PUT    /notification-preferences/me        CRM_ROLES, Self
 *   POST   /auth/logout {pushSubscriptionId}   mọi người đã đăng nhập, chỉ thu hồi thiết bị CỦA MÌNH
 *
 * Các spec T-26/T-27/T-28 đã phủ chi tiết từng route; spec này là bảng đối chiếu vai trò × route × "người khác"
 * để một route mới/đổi decorator không thể lọt mà không đỏ, và kiểm hai bất biến chéo route: (1) quản trị viên
 * KHÔNG có ngoại lệ "xem/xóa thiết bị người khác", (2) không phản hồi nào lộ `endpoint`/khóa/`userId`.
 *
 * Chạy: npx jest --testRegex "push-api-permission-matrix.integration.spec" --testPathIgnorePatterns /node_modules/ --runInBand --forceExit
 */
import { randomUUID } from 'crypto';
import { ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { getConnectionToken, MongooseModule } from '@nestjs/mongoose';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import type { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Connection, Types } from 'mongoose';
import { UserRole } from '../../../common/enums/user-role.enum';
import { GlobalExceptionFilter } from '../../../common/filters/global-exception.filter';
import { createMemoryReplSet } from '../../../shared/database/memory-replset.util';
import { FeatureFlagModule } from '../../../shared/feature-flags/feature-flag.module';
import { REDIS_CLIENT } from '../../../shared/redis/redis.constants';
import { createRedisClientStub } from '../../../shared/redis/redis-client.fixture';
import { AuthModule } from '../../auth/auth.module';
import { NotificationsModule } from '../notifications.module';

jest.setTimeout(300_000);

const JWT_SECRET = 'qa-t38-matrix-secret';
const P256DH = Buffer.concat([
  Buffer.from([0x04]),
  Buffer.alloc(64, 7),
]).toString('base64url');
const AUTH_KEY = Buffer.alloc(16, 9).toString('base64url');
const UA =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Mobile Safari/537.36';

type Method = 'GET' | 'POST' | 'PUT' | 'DELETE';
interface Res {
  status: number;
  body: any;
  raw: string;
}

describe('T-38 ma trận quyền API push (CRM_ROLES, Self, 404 người khác)', () => {
  let replSet: MongoMemoryReplSet;
  let app: NestFastifyApplication;
  let connection: Connection;
  let jwt: JwtService;
  const saved: Record<string, string | undefined> = {};

  const newUser = (role: string = UserRole.STAFF) => {
    const id = new Types.ObjectId().toHexString();
    return {
      id,
      token: jwt.sign({ sub: id, email: `${id}@test.vn`, role, roles: [role] }),
    };
  };

  const call = async (
    method: Method,
    url: string,
    token: string | null,
    payload?: unknown,
  ): Promise<Res> => {
    const res = await app.inject({
      method,
      url: `/api/v1${url}`,
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        'user-agent': UA,
      },
      payload: payload as never,
    });
    let body: unknown;
    try {
      body = res.body ? JSON.parse(res.body) : undefined;
    } catch {
      body = res.body;
    }
    return { status: res.statusCode, body, raw: res.body };
  };

  const subscription = () => ({
    endpoint: `https://fcm.googleapis.com/fcm/send/${randomUUID()}`,
    keys: { p256dh: P256DH, auth: AUTH_KEY },
  });

  /** Đăng ký một thiết bị cho `token`, trả id và endpoint thô. */
  const register = async (token: string) => {
    const dto = subscription();
    const res = await call('POST', '/push-subscriptions', token, dto);
    expect(res.status).toBe(201);
    return { id: res.body.data.id as string, endpoint: dto.endpoint };
  };

  const deviceDoc = (id: string) =>
    connection
      .collection('push_subscriptions')
      .findOne({ _id: new Types.ObjectId(id) }) as Promise<any>;

  /** Mô tả từng route để dựng ma trận: mỗi lần gọi tạo dữ liệu riêng nên không phụ thuộc thứ tự. */
  interface RouteSpec {
    name: string;
    expectOk: number;
    run: (token: string | null) => Promise<Res>;
  }
  const missingId = () => new Types.ObjectId().toHexString();
  const ROUTES: RouteSpec[] = [
    {
      name: 'GET /push-subscriptions/config',
      expectOk: 200,
      run: (t) => call('GET', '/push-subscriptions/config', t),
    },
    {
      name: 'GET /push-subscriptions',
      expectOk: 200,
      run: (t) => call('GET', '/push-subscriptions', t),
    },
    {
      name: 'POST /push-subscriptions',
      expectOk: 201,
      run: (t) => call('POST', '/push-subscriptions', t, subscription()),
    },
    {
      // Id không tồn tại: người được phép thì 404 (không có thiết bị), nên dùng thiết bị thật của chính họ ở ca "OK".
      name: 'DELETE /push-subscriptions/:id',
      expectOk: 204,
      run: async (t) => {
        if (!t) return call('DELETE', `/push-subscriptions/${missingId()}`, t);
        const own = await call(
          'POST',
          '/push-subscriptions',
          t,
          subscription(),
        );
        const id = own.body?.data?.id ?? missingId();
        return call('DELETE', `/push-subscriptions/${id}`, t);
      },
    },
    {
      name: 'GET /notification-preferences/me',
      expectOk: 200,
      run: (t) => call('GET', '/notification-preferences/me', t),
    },
    {
      name: 'PUT /notification-preferences/me',
      expectOk: 200,
      run: (t) =>
        call('PUT', '/notification-preferences/me', t, {
          types: { CARE_LOG_ADDED: { push: false, inApp: true } },
        }),
    },
  ];

  beforeAll(async () => {
    for (const key of [
      'FEATURE_CRM_ENABLED',
      'FEATURE_CRM_PUSH',
      'CRM_PII_ENCRYPTION_KEY',
      'AUTH_LOGIN_THROTTLE_LIMIT',
    ]) {
      saved[key] = process.env[key];
    }
    process.env.FEATURE_CRM_ENABLED = 'true';
    process.env.FEATURE_CRM_PUSH = 'false';
    process.env.CRM_PII_ENCRYPTION_KEY = 'ab'.repeat(32);
    replSet = await createMemoryReplSet();
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [() => ({ JWT_SECRET })],
        }),
        MongooseModule.forRoot(replSet.getUri()),
        FeatureFlagModule,
        AuthModule,
        NotificationsModule,
      ],
    })
      .overrideProvider(REDIS_CLIENT)
      .useValue(createRedisClientStub())
      .compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    // Plugin cookie không chạy dưới Jest CJS: giả lập đủ cho `POST /auth/logout`.
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
    jwt = app.get(JwtService);
    await Promise.all(
      connection.modelNames().map((name) => connection.model(name).init()),
    );
  });

  afterAll(async () => {
    await app?.close();
    await replSet?.stop();
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  beforeEach(() => {
    process.env.FEATURE_CRM_ENABLED = 'true';
  });

  describe('xác thực: không/sai token thì 401 ở MỌI route (kể cả logout)', () => {
    const everyRoute = [
      ...ROUTES.map((r) => [r.name, r.run] as const),
      [
        'POST /auth/logout',
        (t: string | null) => call('POST', '/auth/logout', t, {}),
      ] as const,
    ];

    it.each(everyRoute)('%s không token: 401', async (_name, run) => {
      expect((await run(null)).status).toBe(401);
    });

    it.each(everyRoute)(
      '%s token sai chữ ký/hỏng/hết hạn: 401',
      async (_name, run) => {
        const forged = new JwtService({ secret: 'khong-phai-secret' }).sign({
          sub: new Types.ObjectId().toHexString(),
          role: UserRole.ADMIN,
          roles: [UserRole.ADMIN],
        });
        const expired = jwt.sign(
          {
            sub: new Types.ObjectId().toHexString(),
            role: UserRole.ADMIN,
            roles: [UserRole.ADMIN],
          },
          { expiresIn: -10 },
        );
        for (const token of [forged, expired, 'khong.phai.jwt', 'x']) {
          expect((await run(token)).status).toBe(401);
        }
      },
    );
  });

  describe('vai trò: CRM_ROLES được vào, EDITOR và vai trò lạ thì 403', () => {
    const grid = ROUTES.flatMap((route) =>
      [UserRole.ADMIN, UserRole.MANAGER, UserRole.STAFF].map(
        (role) => [route.name, role, route] as const,
      ),
    );

    it.each(grid)('%s với %s: thành công', async (_name, role, route) => {
      const user = newUser(role);
      expect((await route.run(user.token)).status).toBe(route.expectOk);
    });

    it.each(ROUTES.map((r) => [r.name, r] as const))(
      '%s với EDITOR: 403 và không ghi DB',
      async (_name, route) => {
        const before = await connection
          .collection('push_subscriptions')
          .countDocuments();
        const prefBefore = await connection
          .collection('notification_preferences')
          .countDocuments();
        const editor = newUser(UserRole.EDITOR);
        expect((await route.run(editor.token)).status).toBe(403);
        expect(
          await connection.collection('push_subscriptions').countDocuments(),
        ).toBe(before);
        expect(
          await connection
            .collection('notification_preferences')
            .countDocuments(),
        ).toBe(prefBefore);
      },
    );

    it.each(ROUTES.map((r) => [r.name, r] as const))(
      '%s với vai trò lạ hoặc token không có vai trò: 403',
      async (_name, route) => {
        const stranger = newUser('GUEST');
        expect((await route.run(stranger.token)).status).toBe(403);
        const id = new Types.ObjectId().toHexString();
        const noRole = jwt.sign({ sub: id, email: 'x@test.vn' });
        expect((await route.run(noRole)).status).toBe(403);
      },
    );

    it('người nhiều vai trò (EDITOR + STAFF) vẫn vào được route CRM (hợp quyền)', async () => {
      const id = new Types.ObjectId().toHexString();
      const token = jwt.sign({
        sub: id,
        email: 'm@test.vn',
        role: UserRole.EDITOR,
        roles: [UserRole.EDITOR, UserRole.STAFF],
      });
      expect((await call('GET', '/push-subscriptions', token)).status).toBe(
        200,
      );
    });

    it('logout cho MỌI vai trò đã đăng nhập (kể cả EDITOR), thu hồi thiết bị của chính mình', async () => {
      for (const role of Object.values(UserRole)) {
        const user = newUser(role);
        // EDITOR không có quyền CRM nên chèn thiết bị trực tiếp vào DB.
        const _id = new Types.ObjectId();
        await connection.collection('push_subscriptions').insertOne({
          _id,
          userId: new Types.ObjectId(user.id),
          endpoint: `https://fcm.googleapis.com/fcm/send/${_id.toHexString()}`,
          endpointHash: _id.toHexString(),
          keys: { p256dh: 'x', authEnc: {} },
          expirationTime: null,
          platform: 'ANDROID',
          lastSeenAt: new Date(),
          revokedAt: null,
          revokedReason: null,
          purgeAt: null,
        });
        const res = await call('POST', '/auth/logout', user.token, {
          pushSubscriptionId: _id.toHexString(),
        });
        expect(res.status).toBe(201);
        const doc = await deviceDoc(_id.toHexString());
        expect(doc.revokedReason).toBe('LOGOUT');
      }
    });
  });

  describe('Self: người khác (kể cả Quản trị) không thấy, không xóa, không đổi được', () => {
    it.each([UserRole.ADMIN, UserRole.MANAGER, UserRole.STAFF])(
      'DELETE thiết bị của người khác bằng %s: 404 giống hệt id không tồn tại, thiết bị nạn nhân còn nguyên',
      async (role) => {
        const victim = newUser(UserRole.STAFF);
        const device = await register(victim.token);
        const attacker = newUser(role);

        const other = await call(
          'DELETE',
          `/push-subscriptions/${device.id}`,
          attacker.token,
        );
        const missing = await call(
          'DELETE',
          `/push-subscriptions/${missingId()}`,
          attacker.token,
        );
        expect(other.status).toBe(404);
        // Không phân biệt "của người khác" với "không tồn tại" (không lộ sự tồn tại).
        expect(missing.status).toBe(404);
        expect(other.body.message).toBe(missing.body.message);
        expect(other.body.statusCode).toBe(missing.body.statusCode);
        expect(other.body.errorCode).toBe(missing.body.errorCode);
        // Body chỉ lặp lại path người gọi tự gửi; không lộ userId chủ thiết bị.
        expect(other.raw).not.toContain(victim.id);

        const doc = await deviceDoc(device.id);
        expect(doc.revokedAt).toBeNull();
        expect(String(doc.userId)).toBe(victim.id);
      },
    );

    it('GET /push-subscriptions chỉ trả thiết bị của chính mình (Quản trị cũng vậy), không lộ endpoint/khóa/userId', async () => {
      const a = newUser(UserRole.STAFF);
      const b = newUser(UserRole.STAFF);
      const admin = newUser(UserRole.ADMIN);
      const deviceA = await register(a.token);
      const deviceB = await register(b.token);

      for (const viewer of [a, b, admin]) {
        const res = await call('GET', '/push-subscriptions', viewer.token);
        expect(res.status).toBe(200);
        const ids = res.body.data.active.map((d: { id: string }) => d.id);
        if (viewer === a) expect(ids).toEqual([deviceA.id]);
        else if (viewer === b) expect(ids).toEqual([deviceB.id]);
        else expect(ids).toEqual([]);
        for (const secret of [
          deviceA.endpoint,
          deviceB.endpoint,
          'authEnc',
          'p256dh',
          'endpointHash',
          a.id,
          b.id,
        ]) {
          expect(res.raw).not.toContain(secret);
        }
      }
    });

    it('POST /push-subscriptions: userId trong body bị từ chối (400), không đăng ký hộ người khác', async () => {
      const attacker = newUser(UserRole.STAFF);
      const victim = newUser(UserRole.STAFF);
      const dto = { ...subscription(), userId: victim.id };
      const res = await call(
        'POST',
        '/push-subscriptions',
        attacker.token,
        dto,
      );
      expect(res.status).toBe(400);
      expect(
        await connection
          .collection('push_subscriptions')
          .countDocuments({ endpoint: dto.endpoint }),
      ).toBe(0);
    });

    it('POST /push-subscriptions: phản hồi không lộ endpoint/khóa/userId', async () => {
      const user = newUser(UserRole.STAFF);
      const dto = subscription();
      const res = await call('POST', '/push-subscriptions', user.token, dto);
      expect(res.status).toBe(201);
      for (const secret of [
        dto.endpoint,
        dto.keys.auth,
        dto.keys.p256dh,
        user.id,
      ]) {
        expect(res.raw).not.toContain(secret);
      }
    });

    it('cài đặt thông báo là của riêng từng người: A đổi không ảnh hưởng B; Quản trị không đọc/ghi được của A', async () => {
      const a = newUser(UserRole.STAFF);
      const b = newUser(UserRole.STAFF);
      const admin = newUser(UserRole.ADMIN);

      const put = await call('PUT', '/notification-preferences/me', a.token, {
        types: { CARE_LOG_ADDED: { push: false, inApp: false } },
        quietHours: { start: '22:00', end: '06:00' },
      });
      expect(put.status).toBe(200);
      expect(put.body.data.types.CARE_LOG_ADDED).toEqual({
        push: false,
        inApp: false,
      });

      for (const other of [b, admin]) {
        const res = await call(
          'GET',
          '/notification-preferences/me',
          other.token,
        );
        expect(res.body.data.types.CARE_LOG_ADDED).toEqual({
          push: true,
          inApp: true,
        });
        expect(res.body.data.quietHours).toBeNull();
      }
      // Không có route theo id: không đọc/ghi hộ người khác được.
      for (const method of ['GET', 'PUT'] as const) {
        const res = await call(
          method,
          `/notification-preferences/${a.id}`,
          admin.token,
          method === 'PUT' ? { types: {} } : undefined,
        );
        expect(res.status).toBe(404);
      }
      // Bản ghi của A không bị chạm bởi các lời gọi trên.
      const stored = await connection
        .collection('notification_preferences')
        .find({ userId: new Types.ObjectId(a.id) })
        .toArray();
      expect(stored).toHaveLength(1);
      expect(
        await connection
          .collection('notification_preferences')
          .countDocuments({ userId: new Types.ObjectId(admin.id) }),
      ).toBe(0);
    });

    it('PUT cài đặt: userId/trường lạ trong body bị từ chối (400), không ghi hộ người khác', async () => {
      const attacker = newUser(UserRole.STAFF);
      const victim = newUser(UserRole.STAFF);
      const res = await call(
        'PUT',
        '/notification-preferences/me',
        attacker.token,
        {
          userId: victim.id,
          types: { CARE_LOG_ADDED: { push: false, inApp: true } },
        },
      );
      expect(res.status).toBe(400);
      expect(
        await connection
          .collection('notification_preferences')
          .countDocuments({ userId: new Types.ObjectId(victim.id) }),
      ).toBe(0);
    });

    it.each([UserRole.ADMIN, UserRole.MANAGER, UserRole.STAFF])(
      'logout bằng %s kèm id thiết bị của người khác: phản hồi y hệt id lạ, thiết bị nạn nhân KHÔNG bị thu hồi',
      async (role) => {
        const victim = newUser(UserRole.STAFF);
        const device = await register(victim.token);
        const attacker = newUser(role);

        const foreign = await call('POST', '/auth/logout', attacker.token, {
          pushSubscriptionId: device.id,
        });
        const unknown = await call('POST', '/auth/logout', attacker.token, {
          pushSubscriptionId: missingId(),
        });
        expect(foreign.status).toBe(201);
        expect(foreign.status).toBe(unknown.status);
        expect(foreign.body).toEqual(unknown.body);
        expect((await deviceDoc(device.id)).revokedAt).toBeNull();
      },
    );

    it('logout kèm id của chính mình thu hồi đúng thiết bị đó, thiết bị khác của mình giữ nguyên', async () => {
      const user = newUser(UserRole.STAFF);
      const first = await register(user.token);
      const second = await register(user.token);
      const res = await call('POST', '/auth/logout', user.token, {
        pushSubscriptionId: first.id,
      });
      expect(res.status).toBe(201);
      expect((await deviceDoc(first.id)).revokedReason).toBe('LOGOUT');
      expect((await deviceDoc(second.id)).revokedAt).toBeNull();
    });

    it('thiết bị đã thu hồi lúc logout không còn gỡ lại được bởi người khác (vẫn 404) và gỡ lại bởi chủ vẫn 204', async () => {
      const owner = newUser(UserRole.STAFF);
      const stranger = newUser(UserRole.ADMIN);
      const device = await register(owner.token);
      await call('POST', '/auth/logout', owner.token, {
        pushSubscriptionId: device.id,
      });
      expect(
        (
          await call(
            'DELETE',
            `/push-subscriptions/${device.id}`,
            stranger.token,
          )
        ).status,
      ).toBe(404);
      expect(
        (await call('DELETE', `/push-subscriptions/${device.id}`, owner.token))
          .status,
      ).toBe(204);
    });
  });

  describe('cổng tính năng CRM tắt: route push/cài đặt thành 404 (sau xác thực), logout không bị ảnh hưởng', () => {
    it.each(ROUTES.map((r) => [r.name, r] as const))(
      '%s: STAFF nhận 404, không token vẫn 401, EDITOR vẫn 403',
      async (_name, route) => {
        process.env.FEATURE_CRM_ENABLED = 'false';
        expect((await route.run(newUser(UserRole.STAFF).token)).status).toBe(
          404,
        );
        expect((await route.run(null)).status).toBe(401);
        expect((await route.run(newUser(UserRole.EDITOR).token)).status).toBe(
          403,
        );
      },
    );

    it('logout vẫn hoạt động khi cờ CRM tắt (endpoint cũ, không gắn cổng)', async () => {
      process.env.FEATURE_CRM_ENABLED = 'false';
      const user = newUser(UserRole.STAFF);
      expect((await call('POST', '/auth/logout', user.token, {})).status).toBe(
        201,
      );
    });
  });
});
