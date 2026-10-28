/**
 * INTEGRATION (QA) — "Admin sửa thông tin tài khoản": PATCH /users/:id và PATCH /users/:id/password.
 * Dùng AuthModule + UsersModule THẬT (guard toàn cục, ValidationPipe whitelist, GlobalExceptionFilter) trên MongoDB
 * Replica Set thật (in-memory) để kiểm những điều unit test mock không chứng minh được: phân quyền, hash argon2 thật,
 * refresh token bị thu hồi thật, đăng nhập email cũ/mới, transaction rollback, audit không lộ mật khẩu.
 */
import { ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { getConnectionToken, MongooseModule } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import * as argon2 from 'argon2';
import type { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Connection, Types } from 'mongoose';
import { createMemoryReplSet } from '../../shared/database/memory-replset.util';
import { GlobalExceptionFilter } from '../../common/filters/global-exception.filter';
import { FeatureFlagModule } from '../../shared/feature-flags/feature-flag.module';
import { CrmAuditLogService } from '../crm/audit-logs/crm-audit-log.service';
import { AuthModule } from '../auth/auth.module';
import { UsersModule } from './users.module';

jest.setTimeout(240_000);

const PASSWORD = 'Start@123456';
const NEW_PASSWORD = 'Changed@987654';

describe('Admin sửa tài khoản (AuthModule + UsersModule thật)', () => {
  let replSet: MongoMemoryReplSet;
  let app: NestFastifyApplication;
  let connection: Connection;
  /** Refresh token raw mà controller set cookie gần nhất (cookie plugin bị giả lập vì không chạy được dưới Jest CJS). */
  let lastRefreshToken = '';

  const call = async (
    method: 'GET' | 'POST' | 'PATCH',
    url: string,
    token: string | null,
    body?: unknown,
  ) => {
    const res = await app.inject({
      method,
      url: `/api/v1${url}`,
      headers: token ? { authorization: `Bearer ${token}` } : {},
      payload: body as never,
    });
    return {
      status: res.statusCode,
      body: res.body ? JSON.parse(res.body) : undefined,
    };
  };

  const login = async (email: string, password: string) => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email, password },
    });
    return {
      status: res.statusCode,
      accessToken:
        res.statusCode === 201 ? JSON.parse(res.body).accessToken : '',
      refreshToken: lastRefreshToken,
    };
  };

  const refresh = async (refreshToken: string) => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      headers: { 'x-test-refresh': refreshToken },
    });
    return res.statusCode;
  };

  const insertUser = async (
    email: string,
    role: string,
    extra: Record<string, unknown> = {},
  ) => {
    const { insertedId } = await connection.collection('users').insertOne({
      email,
      password: await argon2.hash(PASSWORD),
      displayName: `User ${email}`,
      role,
      status: 'ACTIVE',
      teamId: null,
      deletedAt: null,
      lastLoginAt: null,
      ...extra,
    });
    return insertedId.toHexString();
  };

  const findUser = (id: string) =>
    connection
      .collection('users')
      .findOne({ _id: new Types.ObjectId(id) }) as Promise<any>;

  const auditOf = (id: string) =>
    connection
      .collection('crm_audit_logs')
      .find({ entityId: new Types.ObjectId(id) })
      .toArray() as Promise<any[]>;

  let adminToken: string;
  const ids: Record<string, string> = {};
  const tokens: Record<string, string> = {};

  beforeAll(async () => {
    process.env.AUTH_LOGIN_THROTTLE_LIMIT = '10000';
    replSet = await createMemoryReplSet();
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [() => ({ JWT_SECRET: 'qa-users-edit-secret' })],
        }),
        MongooseModule.forRoot(replSet.getUri()),
        FeatureFlagModule,
        AuthModule,
        UsersModule,
      ],
    }).compile();
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
    fastify.decorateReply(
      'setCookie',
      function (this: unknown, _name: string, value: string) {
        lastRefreshToken = value;
        return this;
      },
    );
    fastify.decorateReply('clearCookie', function (this: unknown) {
      return this;
    });
    fastify.decorateRequest('cookies', null);
    fastify.addHook('onRequest', (req, _reply, done) => {
      const raw = req.headers['x-test-refresh'];
      req.cookies = raw ? { refreshToken: raw } : {};
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

    ids.admin = await insertUser('admin@qa.test', 'ADMIN');
    ids.admin2 = await insertUser('admin2@qa.test', 'ADMIN');
    ids.editor = await insertUser('editor@qa.test', 'EDITOR');
    ids.manager = await insertUser('manager@qa.test', 'MANAGER');
    ids.staff = await insertUser('staff@qa.test', 'STAFF');
    ids.target = await insertUser('target@qa.test', 'EDITOR');
    ids.other = await insertUser('other@qa.test', 'EDITOR');
    ids.blocked = await insertUser('blocked@qa.test', 'EDITOR', {
      status: 'BLOCKED',
    });
    ids.deleted = await insertUser('gone@qa.test', 'EDITOR', {
      deletedAt: new Date(),
    });

    adminToken = (await login('admin@qa.test', PASSWORD)).accessToken;
    for (const key of ['editor', 'manager', 'staff']) {
      tokens[key] = (await login(`${key}@qa.test`, PASSWORD)).accessToken;
    }
  });

  afterAll(async () => {
    delete process.env.AUTH_LOGIN_THROTTLE_LIMIT;
    await app?.close();
    await replSet?.stop();
  });

  describe('phân quyền', () => {
    it('không token → 401; EDITOR/MANAGER/STAFF → 403 trên cả hai route, dữ liệu không đổi', async () => {
      const before = await findUser(ids.target);
      expect(
        (
          await call('PATCH', `/users/${ids.target}`, null, {
            displayName: 'Hack',
          })
        ).status,
      ).toBe(401);
      expect(
        (
          await call('PATCH', `/users/${ids.target}/password`, null, {
            newPassword: NEW_PASSWORD,
          })
        ).status,
      ).toBe(401);
      for (const role of ['editor', 'manager', 'staff']) {
        expect(
          (
            await call('PATCH', `/users/${ids.target}`, tokens[role], {
              displayName: 'Hack',
            })
          ).status,
        ).toBe(403);
        expect(
          (
            await call('PATCH', `/users/${ids.target}/password`, tokens[role], {
              newPassword: NEW_PASSWORD,
            })
          ).status,
        ).toBe(403);
      }
      expect(await findUser(ids.target)).toEqual(before);
    });
  });

  describe('PATCH /users/:id', () => {
    it('mass-assignment: gửi thêm role/status/password/teamId → 400 và DB không đổi', async () => {
      const before = await findUser(ids.target);
      for (const extra of [
        { role: 'ADMIN' },
        { status: 'BLOCKED' },
        { password: 'Hacked@123456' },
        { teamId: new Types.ObjectId().toHexString() },
        { deletedAt: null },
      ]) {
        const res = await call('PATCH', `/users/${ids.target}`, adminToken, {
          displayName: 'Valid Name',
          ...extra,
        });
        expect(res.status).toBe(400);
      }
      expect(await findUser(ids.target)).toEqual(before);
    });

    it('lỗi đầu vào: body rỗng / null / sai định dạng / id sai / không tồn tại / đã soft delete', async () => {
      expect(
        (await call('PATCH', `/users/${ids.target}`, adminToken, {})).status,
      ).toBe(400);
      expect(
        (
          await call('PATCH', `/users/${ids.target}`, adminToken, {
            displayName: null,
            email: null,
          })
        ).status,
      ).toBe(400);
      expect(
        (
          await call('PATCH', `/users/${ids.target}`, adminToken, {
            email: 'not-an-email',
          })
        ).status,
      ).toBe(400);
      expect(
        (
          await call('PATCH', `/users/${ids.target}`, adminToken, {
            displayName: '   ',
          })
        ).status,
      ).toBe(400);
      expect(
        (
          await call('PATCH', `/users/${ids.target}`, adminToken, {
            displayName: { $ne: 1 },
          })
        ).status,
      ).toBe(400);
      expect(
        (
          await call('PATCH', `/users/${ids.target}`, adminToken, {
            email: { $ne: 'x' },
          })
        ).status,
      ).toBe(400);
      expect(
        (
          await call('PATCH', '/users/not-an-objectid', adminToken, {
            displayName: 'Valid Name',
          })
        ).status,
      ).toBe(400);
      expect(
        (
          await call(
            'PATCH',
            `/users/${new Types.ObjectId().toHexString()}`,
            adminToken,
            {
              displayName: 'Valid Name',
            },
          )
        ).status,
      ).toBe(404);
      expect(
        (
          await call('PATCH', `/users/${ids.deleted}`, adminToken, {
            displayName: 'Valid Name',
          })
        ).status,
      ).toBe(404);
    });

    it('email trùng (khác hoa/thường, có khoảng trắng) → 409; trùng email của tài khoản đã soft delete → được phép', async () => {
      for (const email of [
        'other@qa.test',
        'OTHER@QA.TEST',
        '  Other@Qa.Test  ',
      ]) {
        const res = await call('PATCH', `/users/${ids.target}`, adminToken, {
          email,
        });
        expect([email, res.status]).toEqual([email, 409]);
      }
      expect((await findUser(ids.target)).email).toBe('target@qa.test');

      const ok = await call('PATCH', `/users/${ids.target}`, adminToken, {
        email: 'gone@qa.test',
      });
      expect(ok.status).toBe(200);
      expect(ok.body.email).toBe('gone@qa.test');
      // Trả lại để các test sau dùng email ổn định.
      expect(
        (
          await call('PATCH', `/users/${ids.target}`, adminToken, {
            email: 'target@qa.test',
          })
        ).status,
      ).toBe(200);
    });

    it('đổi sang chính email hiện tại (kể cả khác hoa/thường) là no-op: không ghi, không audit, không thu hồi phiên', async () => {
      const session = await login('target@qa.test', PASSWORD);
      const auditBefore = (await auditOf(ids.target)).length;
      const before = await findUser(ids.target);

      const res = await call('PATCH', `/users/${ids.target}`, adminToken, {
        email: 'TARGET@qa.test',
        displayName: before.displayName,
      });

      expect(res.status).toBe(200);
      const after = await findUser(ids.target);
      expect(after.updatedAt).toEqual(before.updatedAt);
      expect((await auditOf(ids.target)).length).toBe(auditBefore);
      expect(await refresh(session.refreshToken)).toBe(201);
    });

    it('sửa tên: chỉ đổi displayName, audit USER_UPDATED, phiên refresh vẫn dùng được; response không có password', async () => {
      const session = await login('target@qa.test', PASSWORD);
      const res = await call('PATCH', `/users/${ids.target}`, adminToken, {
        displayName: '  Tên Mới  ',
      });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        _id: ids.target,
        displayName: 'Tên Mới',
        email: 'target@qa.test',
      });
      expect(JSON.stringify(res.body)).not.toMatch(/password|argon2/i);
      const actions = (await auditOf(ids.target)).map((entry) => entry.action);
      expect(actions).toContain('USER_UPDATED');
      expect(await refresh(session.refreshToken)).toBe(201);
    });

    it('đổi email: đăng nhập email cũ fail, email mới OK, refresh token cũ bị từ chối; audit ghi from/to', async () => {
      const session = await login('target@qa.test', PASSWORD);
      expect(await refresh(session.refreshToken)).toBe(201); // token đã xoay vòng
      const rotated = lastRefreshToken;

      const res = await call('PATCH', `/users/${ids.target}`, adminToken, {
        email: ' New.Target@QA.test ',
      });
      expect(res.status).toBe(200);
      expect(res.body.email).toBe('new.target@qa.test');

      expect((await login('target@qa.test', PASSWORD)).status).toBe(401);
      expect((await login('new.target@qa.test', PASSWORD)).status).toBe(201);
      expect(await refresh(rotated)).toBe(401);
      expect(await refresh(session.refreshToken)).toBe(401);

      const audit = (await auditOf(ids.target)).filter(
        (entry) => entry.action === 'USER_UPDATED',
      );
      const emailChange = audit
        .flatMap((entry) => entry.changes)
        .find(
          (change: any) =>
            change.field === 'email' && change.to === 'new.target@qa.test',
        );
      expect(emailChange).toMatchObject({ from: 'target@qa.test' });
    });

    it('sửa tài khoản BLOCKED được, trạng thái vẫn BLOCKED', async () => {
      const res = await call('PATCH', `/users/${ids.blocked}`, adminToken, {
        displayName: 'Blocked Renamed',
      });
      expect(res.status).toBe(200);
      expect((await findUser(ids.blocked)).status).toBe('BLOCKED');
    });

    it('transaction rollback: audit lỗi thì email KHÔNG đổi và refresh token KHÔNG bị thu hồi', async () => {
      const session = await login('other@qa.test', PASSWORD);
      const audit = app.get(CrmAuditLogService);
      const spy = jest
        .spyOn(audit, 'record')
        .mockRejectedValueOnce(new Error('audit down'));
      const res = await call('PATCH', `/users/${ids.other}`, adminToken, {
        email: 'rolled.back@qa.test',
      });
      spy.mockRestore();

      expect(res.status).toBe(500);
      expect((await findUser(ids.other)).email).toBe('other@qa.test');
      expect(await refresh(session.refreshToken)).toBe(201);
    });
  });

  describe('PATCH /users/:id/password', () => {
    it('validate: thiếu/ngắn/sai kiểu/thừa field → 400; id sai → 400; không tồn tại hoặc đã xóa → 404', async () => {
      const before = await findUser(ids.target);
      for (const body of [
        {},
        { newPassword: '1234567' },
        { newPassword: 12345678 },
        { newPassword: NEW_PASSWORD, role: 'ADMIN' },
      ]) {
        expect([
          body,
          (
            await call(
              'PATCH',
              `/users/${ids.target}/password`,
              adminToken,
              body,
            )
          ).status,
        ]).toEqual([body, 400]);
      }
      expect(
        (
          await call('PATCH', '/users/xyz/password', adminToken, {
            newPassword: NEW_PASSWORD,
          })
        ).status,
      ).toBe(400);
      expect(
        (
          await call(
            'PATCH',
            `/users/${new Types.ObjectId().toHexString()}/password`,
            adminToken,
            { newPassword: NEW_PASSWORD },
          )
        ).status,
      ).toBe(404);
      expect(
        (
          await call('PATCH', `/users/${ids.deleted}/password`, adminToken, {
            newPassword: NEW_PASSWORD,
          })
        ).status,
      ).toBe(404);
      expect((await findUser(ids.target)).password).toBe(before.password);
    });

    it('đặt lại: hash argon2 như lúc tạo, mật khẩu cũ fail/mới OK, mọi refresh token bị thu hồi, audit & response không lộ mật khẩu', async () => {
      const first = await login('new.target@qa.test', PASSWORD);
      const second = await login('new.target@qa.test', PASSWORD);
      expect(await refresh(first.refreshToken)).toBe(201);

      const res = await call(
        'PATCH',
        `/users/${ids.target}/password`,
        adminToken,
        { newPassword: NEW_PASSWORD },
      );
      expect(res.status).toBe(200);
      expect(JSON.stringify(res.body)).not.toMatch(/password|argon2|Changed@/i);

      const stored = await findUser(ids.target);
      expect(stored.password).toMatch(/^\$argon2id\$/);
      expect(await argon2.verify(stored.password, NEW_PASSWORD)).toBe(true);

      expect((await login('new.target@qa.test', PASSWORD)).status).toBe(401);
      expect((await login('new.target@qa.test', NEW_PASSWORD)).status).toBe(
        201,
      );
      expect(await refresh(second.refreshToken)).toBe(401);
      expect(await refresh(first.refreshToken)).toBe(401);

      const entries = (await auditOf(ids.target)).filter(
        (entry) => entry.action === 'USER_PASSWORD_RESET',
      );
      expect(entries).toHaveLength(1);
      expect(JSON.stringify(entries[0])).not.toMatch(/Changed@|argon2/);
      expect(entries[0].actor?.sub ?? entries[0].actorId).toBeDefined();
    });

    it('transaction rollback: audit lỗi thì mật khẩu giữ nguyên và refresh token còn dùng được', async () => {
      const session = await login('new.target@qa.test', NEW_PASSWORD);
      const before = await findUser(ids.target);
      const audit = app.get(CrmAuditLogService);
      const spy = jest
        .spyOn(audit, 'record')
        .mockRejectedValueOnce(new Error('audit down'));
      const res = await call(
        'PATCH',
        `/users/${ids.target}/password`,
        adminToken,
        { newPassword: 'Another@123456' },
      );
      spy.mockRestore();

      expect(res.status).toBe(500);
      expect((await findUser(ids.target)).password).toBe(before.password);
      expect(await refresh(session.refreshToken)).toBe(201);
    });

    it('tài khoản BLOCKED đặt lại được mật khẩu nhưng vẫn không đăng nhập được', async () => {
      expect(
        (
          await call('PATCH', `/users/${ids.blocked}/password`, adminToken, {
            newPassword: NEW_PASSWORD,
          })
        ).status,
      ).toBe(200);
      expect((await login('blocked@qa.test', NEW_PASSWORD)).status).toBe(403);
    });

    it('Admin tự đặt lại mật khẩu mình: 200, access token hiện tại còn dùng được, refresh token bị thu hồi', async () => {
      const own = await login('admin2@qa.test', PASSWORD);
      const res = await call(
        'PATCH',
        `/users/${ids.admin2}/password`,
        own.accessToken,
        { newPassword: NEW_PASSWORD },
      );
      expect(res.status).toBe(200);
      expect((await call('GET', '/users', own.accessToken)).status).toBe(200);
      expect(await refresh(own.refreshToken)).toBe(401);
      expect((await login('admin2@qa.test', NEW_PASSWORD)).status).toBe(201);
    });

    it('Admin đổi email của chính mình: 200, response đúng, refresh token cũ bị thu hồi, đăng nhập email mới OK', async () => {
      const own = await login('admin@qa.test', PASSWORD);
      const res = await call('PATCH', `/users/${ids.admin}`, own.accessToken, {
        email: 'admin.renamed@qa.test',
      });
      expect(res.status).toBe(200);
      expect(await refresh(own.refreshToken)).toBe(401);
      expect((await login('admin.renamed@qa.test', PASSWORD)).status).toBe(201);
    });
  });
});
