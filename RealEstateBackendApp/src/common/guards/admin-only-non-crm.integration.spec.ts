/**
 * INTEGRATION FR-21 (T-49) — route ADMIN-only NGOÀI CRM đọc role/status từ DB qua HTTP thật (Fastify + guard toàn cục +
 * MongoDB Replica Set in-memory), dùng MODULE THẬT (Settings, ExternalLog, NewsFireCrawlManager, KnowledgeArticles) để
 * chứng minh `ActiveAdminGuard` dựng được (module đã import `CrmCommonModule`) và hành vi theo DB, không theo JWT:
 * - ADMIN đang hoạt động: vào được cả 5 route ADMIN-only;
 * - token còn hạn nhưng tài khoản đã bị khóa hoặc đã xóa mềm: 401;
 * - token còn ghi ADMIN nhưng DB đã hạ xuống EDITOR: 403 ở route ADMIN-only;
 * - EDITOR vẫn vào route `@Roles(ADMIN, EDITOR)` (`GET /news-manager/prompts`), kể cả khi token cũ còn ghi ADMIN.
 * Chỉ gọi route đọc (không ghi file/prompt/cron). Chạy bằng `npm run test:integration`.
 */
import { randomUUID } from 'crypto';
import { Global, Module, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { getModelToken, MongooseModule } from '@nestjs/mongoose';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { ScheduleModule } from '@nestjs/schedule';
import { Test } from '@nestjs/testing';
import type { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Model, Types } from 'mongoose';
import { UserRole } from '../enums/user-role.enum';
import { UserStatus } from '../enums/user-status.enum';
import { GlobalExceptionFilter } from '../filters/global-exception.filter';
import { ExternalLogModule } from '../../modules/external-log/external-log.module';
import { KnowledgeArticlesModule } from '../../modules/knowledge-articles/knowledge-articles.module';
import { NewsFireCrawlManagerModule } from '../../modules/news-fire-crawl-manager/news-fire-crawl-manager.module';
import { SettingsModule } from '../../modules/settings/settings.module';
import { User, UserDocument } from '../../modules/users/schemas/user.schema';
import { createMemoryReplSet } from '../../shared/database/memory-replset.util';
import { createRedisClientStub } from '../../shared/redis/redis-client.fixture';
import { REDIS_CLIENT } from '../../shared/redis/redis.constants';
import { JwtAuthGuard } from './jwt-auth.guard';
import { RolesGuard } from './roles.guard';

// jsdom là ESM, Jest không parse được; route được gọi ở đây không dùng tới.
jest.mock('jsdom', () => ({}));

jest.setTimeout(240_000);

const JWT_SECRET = 'integration-secret';
const RUN_ID = randomUUID().slice(0, 8);

/** `RedisModule` thật sẽ kết nối Redis của máy; test này không cần Redis nên thay bằng stub toàn cục. */
@Global()
@Module({
  providers: [{ provide: REDIS_CLIENT, useValue: createRedisClientStub() }],
  exports: [REDIS_CLIENT],
})
class RedisStubModule {}

/** Các route ADMIN-only ngoài CRM (đều là route đọc, không tác dụng phụ). */
const ADMIN_ONLY_ROUTES = [
  '/settings/ai-config',
  '/external-logs',
  '/news-manager/cron',
  '/knowledge-articles/config/cron',
  '/knowledge-articles/config/wp',
];
/** Route `@Roles(ADMIN, EDITOR)` — phải giữ nguyên cho EDITOR. */
const EDITOR_ROUTE = '/news-manager/prompts';

describe('FR-21 — route ADMIN-only ngoài CRM theo DB (HTTP + MongoDB Replica Set)', () => {
  let replSet: MongoMemoryReplSet;
  let app: NestFastifyApplication;
  let userModel: Model<UserDocument>;
  let jwt: JwtService;
  let seq = 0;

  /** Tạo user trong DB và trả token ghi `tokenRole` (mô phỏng JWT cấp trước khi DB đổi). */
  const createUser = async (
    dbRole: UserRole,
    tokenRole: UserRole,
    extra: Record<string, unknown> = {},
  ) => {
    seq += 1;
    const user = await userModel.create({
      email: `fr21-${RUN_ID}-${seq}@test.vn`,
      password: 'hash',
      displayName: `fr21-${seq}`,
      role: dbRole,
      roles: [dbRole],
      status: UserStatus.ACTIVE,
      ...extra,
    });
    const token = jwt.sign({
      sub: String(user._id),
      email: user.email,
      role: tokenRole,
      roles: [tokenRole],
    });
    return { id: String(user._id), token };
  };

  const get = async (url: string, token: string) => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1${url}`,
      headers: { authorization: `Bearer ${token}` },
    });
    return res.statusCode;
  };

  beforeAll(async () => {
    replSet = await createMemoryReplSet();
    process.env.REDIS_KEY_PREFIX = `it-fr21-${RUN_ID}:`;

    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        MongooseModule.forRoot(replSet.getUri()),
        JwtModule.register({ secret: JWT_SECRET }),
        ScheduleModule.forRoot(),
        RedisStubModule,
        SettingsModule,
        ExternalLogModule,
        NewsFireCrawlManagerModule,
        KnowledgeArticlesModule,
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

    userModel = app.get(getModelToken(User.name), { strict: false });
    jwt = app.get(JwtService);
  });

  afterAll(async () => {
    await app?.close();
    await replSet?.stop();
  });

  it.each(ADMIN_ONLY_ROUTES)(
    'FR-21: ADMIN đang hoạt động vào được %s (200)',
    async (route) => {
      const admin = await createUser(UserRole.ADMIN, UserRole.ADMIN);
      expect(await get(route, admin.token)).toBe(200);
    },
  );

  it.each(ADMIN_ONLY_ROUTES)(
    'FR-21: ADMIN bị khóa khi JWT còn hạn: %s trả 401',
    async (route) => {
      const admin = await createUser(UserRole.ADMIN, UserRole.ADMIN);
      await userModel.updateOne(
        { _id: new Types.ObjectId(admin.id) },
        { $set: { status: UserStatus.BLOCKED } },
      );
      expect(await get(route, admin.token)).toBe(401);
    },
  );

  it.each(ADMIN_ONLY_ROUTES)(
    'FR-21: ADMIN bị xóa mềm khi JWT còn hạn: %s trả 401',
    async (route) => {
      const admin = await createUser(UserRole.ADMIN, UserRole.ADMIN);
      await userModel.updateOne(
        { _id: new Types.ObjectId(admin.id) },
        { $set: { deletedAt: new Date() } },
      );
      expect(await get(route, admin.token)).toBe(401);
    },
  );

  it.each(ADMIN_ONLY_ROUTES)(
    'FR-21: ADMIN bị hạ xuống EDITOR trong DB (token còn ghi ADMIN): %s trả 403',
    async (route) => {
      const demoted = await createUser(UserRole.EDITOR, UserRole.ADMIN);
      expect(await get(route, demoted.token)).toBe(403);
    },
  );

  it.each(ADMIN_ONLY_ROUTES)(
    'FR-21: EDITOR thật bị chặn ở %s (403, chặn từ lớp @Roles theo JWT)',
    async (route) => {
      const editor = await createUser(UserRole.EDITOR, UserRole.EDITOR);
      expect(await get(route, editor.token)).toBe(403);
    },
  );

  it('FR-21: EDITOR vẫn vào route @Roles(ADMIN, EDITOR) (200)', async () => {
    const editor = await createUser(UserRole.EDITOR, UserRole.EDITOR);
    expect(await get(EDITOR_ROUTE, editor.token)).toBe(200);
  });

  it('FR-21: route @Roles(ADMIN, EDITOR) không đổi hành vi: ADMIN vào được; token ghi ADMIN nhưng DB là EDITOR vẫn 200 (không thêm kiểm DB)', async () => {
    const admin = await createUser(UserRole.ADMIN, UserRole.ADMIN);
    const demoted = await createUser(UserRole.EDITOR, UserRole.ADMIN);
    expect(await get(EDITOR_ROUTE, admin.token)).toBe(200);
    expect(await get(EDITOR_ROUTE, demoted.token)).toBe(200);
  });

  it('FR-21: không có token: 401 ở route ADMIN-only', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/news-manager/cron',
    });
    expect(res.statusCode).toBe(401);
  });
});
