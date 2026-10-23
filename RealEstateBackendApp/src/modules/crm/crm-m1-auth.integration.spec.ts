/**
 * INTEGRATION (QA bổ sung) — tương thích ngược của đăng nhập khi thêm vai trò/field CRM (M1).
 * Dùng `AuthModule` THẬT (kèm bộ guard toàn cục ThrottlerGuard -> JwtAuthGuard -> RolesGuard do chính module đăng ký)
 * + cookie plugin của Fastify, trên MongoDB Replica Set thật. Không cần Redis/MinIO.
 *
 * Kịch bản: tài khoản ADMIN/EDITOR "cũ" (chèn thẳng collection, KHÔNG có field `teamId`) vẫn đăng nhập được,
 * `/auth/me` trả contract cũ + `teamId=null`/`managedTeamIds=[]`, `/users` liệt kê được, token cũ dùng được trên route CRM.
 */
import { ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { getConnectionToken } from '@nestjs/mongoose';
import { MongooseModule } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import * as argon2 from 'argon2';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Connection, Types } from 'mongoose';
import { GlobalExceptionFilter } from '../../common/filters/global-exception.filter';
import { FeatureFlagModule } from '../../shared/feature-flags/feature-flag.module';
import { AuthModule } from '../auth/auth.module';
import { TeamsModule } from '../teams/teams.module';
import { UsersModule } from '../users/users.module';
import { CrmModule } from './crm.module';

jest.setTimeout(240_000);

const PASSWORD = 'Legacy@123456';

describe('CRM M1 — tương thích ngược đăng nhập (AuthModule thật)', () => {
  let replSet: MongoMemoryReplSet;
  let app: NestFastifyApplication;
  let connection: Connection;
  const tokens: Record<string, string> = {};
  let cookies: string[] = [];

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

  beforeAll(async () => {
    process.env.FEATURE_CRM_ENABLED = 'true';
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [() => ({ JWT_SECRET: 'qa-auth-secret' })],
        }),
        MongooseModule.forRoot(replSet.getUri()),
        FeatureFlagModule,
        AuthModule,
        UsersModule,
        TeamsModule,
        CrmModule,
      ],
    }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    // @fastify/cookie dùng dynamic import (không chạy được dưới Jest CJS) => giả lập đúng API controller cần.
    const fastify = app.getHttpAdapter().getInstance() as unknown as {
      decorateReply: (name: string, value: unknown) => void;
      decorateRequest: (name: string, value: unknown) => void;
    };
    const cookieJar: string[] = [];
    fastify.decorateReply('setCookie', function (this: unknown, name: string) {
      cookieJar.push(name);
      return this;
    });
    fastify.decorateReply('clearCookie', function (this: unknown) {
      return this;
    });
    fastify.decorateRequest('cookies', null);
    cookies = cookieJar;
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

    // Tài khoản "cũ": không có field teamId (chèn thẳng collection, bỏ qua default của Mongoose).
    const hash = await argon2.hash(PASSWORD);
    await connection.collection('users').insertMany([
      {
        email: 'admin@realestate.com',
        password: hash,
        displayName: 'Admin cũ',
        role: 'ADMIN',
        status: 'ACTIVE',
        deletedAt: null,
        lastLoginAt: null,
      },
      {
        email: 'editor@realestate.com',
        password: hash,
        displayName: 'Editor cũ',
        role: 'EDITOR',
        status: 'ACTIVE',
        deletedAt: null,
        lastLoginAt: null,
      },
    ]);
  });

  afterAll(async () => {
    delete process.env.FEATURE_CRM_ENABLED;
    await app?.close();
    await replSet?.stop();
  });

  it('admin cũ đăng nhập được; contract login không đổi (accessToken + user, không password), cookie refresh được set', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'admin@realestate.com', password: PASSWORD },
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(Object.keys(body).sort()).toEqual(['accessToken', 'user']);
    expect(body.user).toMatchObject({
      email: 'admin@realestate.com',
      role: 'ADMIN',
    });
    expect(JSON.stringify(body)).not.toContain('password');
    expect(cookies).toContain('refreshToken');
    tokens.admin = body.accessToken;
  });

  it('/auth/me: giữ field cũ, thêm teamId=null và managedTeamIds=[] cho tài khoản chưa có field teamId', async () => {
    const res = await call('GET', '/auth/me', tokens.admin);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      email: 'admin@realestate.com',
      role: 'ADMIN',
      status: 'ACTIVE',
      teamId: null,
      managedTeamIds: [],
    });
    expect(res.body.password).toBeUndefined();
  });

  it('token admin cũ gọi được /users (liệt kê cả tài khoản cũ, teamId=null) và route CRM', async () => {
    const users = await call('GET', '/users', tokens.admin);
    expect(users.status).toBe(200);
    expect(users.body.meta.total).toBe(2);
    expect(users.body.data.every((user: any) => user.teamId === null)).toBe(
      true,
    );
    expect((await call('GET', '/crm/areas', tokens.admin)).status).toBe(200);
  });

  it('editor cũ đăng nhập được, dùng /auth/me, nhưng bị chặn khỏi /users và mọi route CRM (403)', async () => {
    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'editor@realestate.com', password: PASSWORD },
    });
    expect(login.statusCode).toBe(201);
    tokens.editor = JSON.parse(login.body).accessToken;
    expect((await call('GET', '/auth/me', tokens.editor)).status).toBe(200);
    for (const url of ['/users', '/crm/projects', '/teams', '/crm/settings']) {
      expect([url, (await call('GET', url, tokens.editor)).status]).toEqual([
        url,
        403,
      ]);
    }
  });

  it('MANAGER mới: tạo qua POST /users, đăng nhập, /auth/me trả managedTeamIds đúng; STAFF thì managedTeamIds rỗng', async () => {
    const team = await call('POST', '/teams', tokens.admin, {
      name: 'Nhóm auth',
      code: 'AUTH1',
    });
    expect(team.status).toBe(201);
    const manager = await call('POST', '/users', tokens.admin, {
      email: 'mgr@realestate.com',
      password: PASSWORD,
      displayName: 'Quản lý',
      role: 'MANAGER',
      teamId: team.body.data.id,
    });
    expect(manager.status).toBe(201);
    const patch = await call(
      'PATCH',
      `/teams/${team.body.data.id}`,
      tokens.admin,
      {
        managerIds: [manager.body._id],
      },
    );
    expect(patch.status).toBe(200);

    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'mgr@realestate.com', password: PASSWORD },
    });
    const mgrToken = JSON.parse(login.body).accessToken;
    const me = await call('GET', '/auth/me', mgrToken);
    expect(me.body).toMatchObject({
      role: 'MANAGER',
      teamId: team.body.data.id,
      managedTeamIds: [team.body.data.id],
    });
    // Quản lý đọc được nhóm mình nhưng không được ghi (403).
    expect((await call('GET', '/teams', mgrToken)).body.data).toHaveLength(1);
    expect(
      (await call('PATCH', `/teams/${team.body.data.id}`, mgrToken, {})).status,
    ).toBe(403);
    expect(new Types.ObjectId(me.body._id)).toBeDefined();
  });

  it('throttle đăng nhập vẫn hoạt động: lần thứ 6 trong 1 phút bị 429', async () => {
    let last = 0;
    for (let attempt = 0; attempt < 7; attempt += 1) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { email: 'admin@realestate.com', password: 'sai-mat-khau' },
      });
      last = res.statusCode;
    }
    expect(last).toBe(429);
  });
});
