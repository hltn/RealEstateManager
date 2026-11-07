/**
 * INTEGRATION FR-21 (T-50, Q8) — 7 GET danh mục CRM (tình trạng, nguồn, kết quả liên hệ, khu vực, dự án, thẻ, trường
 * chân dung) đọc status/role từ DB qua HTTP thật (Fastify + guard toàn cục + MongoDB Replica Set in-memory, module CRM thật):
 * - STAFF/MANAGER/ADMIN đang hoạt động: 200;
 * - token còn hạn nhưng tài khoản bị khóa hoặc xóa mềm: 401 (không đợi JWT hết hạn);
 * - token còn ghi STAFF nhưng DB đã hạ xuống EDITOR (mất vai trò CRM): 403;
 * - EDITOR thật: 403 (chặn từ lớp @Roles theo JWT); không token: 401;
 * - token cũ ghi EDITOR nhưng DB đã nâng lên STAFF: vẫn 403 (lớp @Roles theo JWT chặn trước, hành vi cũ giữ nguyên).
 * Chỉ gọi route đọc. Chạy bằng `npm run test:integration`.
 */
import { randomUUID } from 'crypto';
import { ValidationPipe } from '@nestjs/common';
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
import { RolesGuard } from '../../common/guards/roles.guard';
import { createMemoryReplSet } from '../../shared/database/memory-replset.util';
import { FeatureFlagModule } from '../../shared/feature-flags/feature-flag.module';
import { TeamsModule } from '../teams/teams.module';
import { User, UserDocument } from '../users/schemas/user.schema';
import { UsersModule } from '../users/users.module';
import { CrmModule } from './crm.module';
import { CrmSeedService } from './seed/crm-seed.service';

jest.setTimeout(240_000);

const JWT_SECRET = 'integration-secret';
const RUN_ID = randomUUID().slice(0, 8);

/** 7 GET danh mục CRM (đều là route đọc, không tác dụng phụ). */
const CATALOG_ROUTES = [
  '/crm/customer-statuses',
  '/crm/lead-sources',
  '/crm/contact-results',
  '/crm/areas',
  '/crm/projects',
  '/crm/tags',
  '/crm/persona-fields',
];

describe('FR-21 (Q8) — GET danh mục CRM theo DB (HTTP + MongoDB Replica Set)', () => {
  let replSet: MongoMemoryReplSet;
  let app: NestFastifyApplication;
  let connection: Connection;
  let userModel: Model<UserDocument>;
  let jwt: JwtService;
  let seq = 0;

  /** Tạo user trong DB và trả token ghi `tokenRole` (mô phỏng JWT cấp trước khi DB đổi). */
  const createUser = async (dbRoles: UserRole[], tokenRole: UserRole) => {
    seq += 1;
    const user = await userModel.create({
      email: `fr21q8-${RUN_ID}-${seq}@test.vn`,
      password: 'hash',
      displayName: `fr21q8-${seq}`,
      roles: dbRoles,
      status: UserStatus.ACTIVE,
    });
    const token = jwt.sign({
      sub: String(user._id),
      email: user.email,
      role: tokenRole,
      roles: [tokenRole],
    });
    return { id: String(user._id), token };
  };

  const request = (url: string, token?: string) =>
    app.inject({
      method: 'GET',
      url: `/api/v1${url}`,
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });

  const get = async (url: string, token?: string) =>
    (await request(url, token)).statusCode;

  /** Body lỗi chuẩn của `GlobalExceptionFilter`: `{ statusCode, message, timestamp, path }` (không lộ query/stack). */
  const expectStandardErrorBody = (
    res: { statusCode: number; body: string },
    statusCode: number,
    path: string,
  ) => {
    expect(res.statusCode).toBe(statusCode);
    const body = JSON.parse(res.body) as Record<string, unknown>;
    expect(body).toEqual({
      statusCode,
      message: expect.any(String) as unknown,
      timestamp: expect.any(String) as unknown,
      path: `/api/v1${path}`,
      errorCode: expect.any(String) as unknown,
    });
    expect((body.message as string).length).toBeGreaterThan(0);
    expect(Number.isNaN(Date.parse(body.timestamp as string))).toBe(false);
    expect(JSON.stringify(body)).not.toMatch(/stack|at .*\(/);
  };

  beforeAll(async () => {
    process.env.FEATURE_CRM_ENABLED = 'true';
    process.env.CRM_PII_ENCRYPTION_KEY = 'ab'.repeat(32);
    process.env.REDIS_KEY_PREFIX = `it-fr21q8-${RUN_ID}:`;
    replSet = await createMemoryReplSet();

    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        MongooseModule.forRoot(replSet.getUri()),
        JwtModule.register({ secret: JWT_SECRET }),
        FeatureFlagModule,
        UsersModule,
        TeamsModule,
        CrmModule,
      ],
      providers: [
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
    userModel = app.get(getModelToken(User.name));
    jwt = app.get(JwtService);
    await Promise.all(
      connection.modelNames().map((name) => connection.model(name).init()),
    );
    await app.get(CrmSeedService).seedAll();
  });

  afterAll(async () => {
    await app?.close();
    await replSet?.stop();
  });

  describe.each(CATALOG_ROUTES)('%s', (route) => {
    it.each([UserRole.ADMIN, UserRole.MANAGER, UserRole.STAFF])(
      'FR-21: %s đang hoạt động: 200',
      async (role) => {
        const user = await createUser([role], role);
        expect(await get(route, user.token)).toBe(200);
      },
    );

    it('FR-21: tài khoản nhiều vai trò EDITOR + STAFF (token ghi STAFF): 200', async () => {
      const user = await createUser(
        [UserRole.EDITOR, UserRole.STAFF],
        UserRole.STAFF,
      );
      expect(await get(route, user.token)).toBe(200);
    });

    it('FR-21: STAFF bị khóa khi JWT còn hạn: 401', async () => {
      const user = await createUser([UserRole.STAFF], UserRole.STAFF);
      await userModel.updateOne(
        { _id: new Types.ObjectId(user.id) },
        { $set: { status: UserStatus.BLOCKED } },
      );
      expect(await get(route, user.token)).toBe(401);
    });

    it('FR-21: STAFF bị xóa mềm khi JWT còn hạn: 401', async () => {
      const user = await createUser([UserRole.STAFF], UserRole.STAFF);
      await userModel.updateOne(
        { _id: new Types.ObjectId(user.id) },
        { $set: { deletedAt: new Date() } },
      );
      expect(await get(route, user.token)).toBe(401);
    });

    it('FR-21: token ghi STAFF nhưng DB đã hạ xuống EDITOR (mất vai trò CRM): 403', async () => {
      const user = await createUser([UserRole.EDITOR], UserRole.STAFF);
      expect(await get(route, user.token)).toBe(403);
    });

    it('FR-21: EDITOR thật bị chặn (403, lớp @Roles theo JWT)', async () => {
      const user = await createUser([UserRole.EDITOR], UserRole.EDITOR);
      expect(await get(route, user.token)).toBe(403);
    });

    it('FR-21: không có token: 401', async () => {
      expect(await get(route)).toBe(401);
    });

    it('FR-21: body lỗi 403 (DB đã hạ xuống EDITOR) đúng chuẩn { statusCode, message, timestamp, path }', async () => {
      const user = await createUser([UserRole.EDITOR], UserRole.STAFF);
      // Kèm query string để chứng minh `path` không trả query (có thể chứa PII).
      const res = await request(`${route}?phone=0901234567`, user.token);
      expect(res.statusCode).toBe(403);
      const body = JSON.parse(res.body) as Record<string, unknown>;
      expect(body).toMatchObject({
        statusCode: 403,
        message: expect.any(String) as unknown,
        timestamp: expect.any(String) as unknown,
        path: `/api/v1${route}`,
      });
      expect(JSON.stringify(body)).not.toContain('0901234567');
      expectStandardErrorBody(await request(route, user.token), 403, route);
    });

    it('FR-21: body lỗi 403 của EDITOR thật (lớp @Roles) và 401 của tài khoản bị khóa cùng đúng chuẩn', async () => {
      const editor = await createUser([UserRole.EDITOR], UserRole.EDITOR);
      expectStandardErrorBody(await request(route, editor.token), 403, route);

      const blocked = await createUser([UserRole.STAFF], UserRole.STAFF);
      await userModel.updateOne(
        { _id: new Types.ObjectId(blocked.id) },
        { $set: { status: UserStatus.BLOCKED } },
      );
      expectStandardErrorBody(await request(route, blocked.token), 401, route);
    });
  });
});
