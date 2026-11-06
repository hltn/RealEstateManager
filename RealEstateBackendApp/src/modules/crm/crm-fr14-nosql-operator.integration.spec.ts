/**
 * INTEGRATION — FR-14 (T-04). Gồm 3 phần:
 * (1) Hồi quy hộp đen cho route CRM chính (GET/POST/PATCH có `$`) qua module có APP_INTERCEPTOR
 *     + ValidationPipe thật; LƯU Ý nhiều ca ở đây đã bị ValidationPipe/parser chặn sẵn nên KHÔNG
 *     chứng minh riêng interceptor.
 * (2) Ca KHÓA interceptor: probe nhỏ có route nhận body/query tự do (ValidationPipe bỏ qua),
 *     chỉ interceptor mới trả 400; bỏ interceptor khỏi probe thì các ca này đỏ.
 * (3) AppModule thật sự đăng ký provider APP_INTERCEPTOR cho interceptor.
 */
import {
  Body,
  Controller,
  Get,
  Module,
  Post,
  Query,
  ValidationPipe,
} from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { getModelToken, MongooseModule } from '@nestjs/mongoose';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import type { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Model } from 'mongoose';
import { AppModule } from '../../app.module';
import { UserRole } from '../../common/enums/user-role.enum';
import { UserStatus } from '../../common/enums/user-status.enum';
import { GlobalExceptionFilter } from '../../common/filters/global-exception.filter';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { NoSqlOperatorInterceptor } from '../../common/security/nosql-operator.interceptor';
import { createMemoryReplSet } from '../../shared/database/memory-replset.util';
import { FeatureFlagModule } from '../../shared/feature-flags/feature-flag.module';
import { TeamsModule } from '../teams/teams.module';
import { User, UserDocument } from '../users/schemas/user.schema';
import { UsersModule } from '../users/users.module';
import { CrmModule } from './crm.module';
import { CrmSeedService } from './seed/crm-seed.service';

jest.setTimeout(240_000);

// AppModule kéo theo jsdom (ESM) mà Jest không parse được; chỉ cần đọc metadata nên giả lập.
jest.mock('jsdom', () => ({ JSDOM: class {} }));

const FLAG = 'FEATURE_CRM_ENABLED';
const JWT_SECRET = 'integration-secret';
const FAKE_ID = '507f1f77bcf86cd799439011';

@Controller('fr14-free')
class FreeFormProbeController {
  @Post('config')
  config(@Body() body: Record<string, unknown>) {
    return { keys: Object.keys(body) };
  }

  @Get('search')
  search(@Query() query: Record<string, unknown>) {
    return { keys: Object.keys(query) };
  }
}

@Module({
  controllers: [FreeFormProbeController],
  providers: [{ provide: APP_INTERCEPTOR, useClass: NoSqlOperatorInterceptor }],
})
class FreeFormProbeModule {}

describe('FR-14: ca khóa riêng interceptor (route body/query tự do, không DTO)', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [FreeFormProbeModule],
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
  });

  afterAll(async () => {
    await app?.close();
  });

  it.each([
    ['body crawlConfig.$where', { crawlConfig: { $where: 'x' } }],
    ['body lồng trong mảng', { articles: [{ urlHash: { $ne: null } }] }],
  ])('FR-14: POST tự do %s trả 400 VALIDATION_FAILED', async (_n, payload) => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/fr14-free/config',
      payload,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ errorCode: string }>().errorCode).toBe(
      'VALIDATION_FAILED',
    );
  });

  it('FR-14: GET tự do `?a[$ne]=1` trả 400 VALIDATION_FAILED', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/fr14-free/search?a[$ne]=1',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ errorCode: string }>().errorCode).toBe(
      'VALIDATION_FAILED',
    );
  });

  it('FR-14: đối chứng, khóa `a.b` ở body không bị chặn như `$`', async () => {
    const ok = await app.inject({
      method: 'POST',
      url: '/api/v1/fr14-free/config',
      payload: { crawlConfig: { 'a.b': 1 } },
    });
    expect(ok.statusCode).toBe(201);
  });
});

describe('FR-14: AppModule đăng ký NoSqlOperatorInterceptor', () => {
  it('FR-14: providers của AppModule có APP_INTERCEPTOR dùng NoSqlOperatorInterceptor', () => {
    const providers: unknown[] =
      Reflect.getMetadata('providers', AppModule) ?? [];
    const found = providers.some(
      (p) =>
        typeof p === 'object' &&
        p !== null &&
        (p as { provide?: unknown }).provide === APP_INTERCEPTOR &&
        (p as { useClass?: unknown }).useClass === NoSqlOperatorInterceptor,
    );
    expect(found).toBe(true);
  });
});

describe('FR-14: CRM chặn toán tử `$` qua đường có interceptor (HTTP + Replica Set)', () => {
  let replSet: MongoMemoryReplSet;
  let app: NestFastifyApplication;
  let adminToken: string;

  const call = async (
    method: 'GET' | 'POST' | 'PATCH',
    url: string,
    payload?: unknown,
  ) => {
    const res = await app.inject({
      method,
      url: `/api/v1${url}`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: payload as never,
    });
    return {
      status: res.statusCode,
      body: res.body ? (JSON.parse(res.body) as Record<string, unknown>) : {},
    };
  };

  beforeAll(async () => {
    process.env[FLAG] = 'true';
    process.env.CRM_PII_ENCRYPTION_KEY = 'ab'.repeat(32);
    process.env.REDIS_KEY_PREFIX = 'it-fr14-' + Date.now() + ':';
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
        { provide: APP_INTERCEPTOR, useClass: NoSqlOperatorInterceptor },
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

    await app.get(CrmSeedService).seedAll();
    const userModel = app.get<Model<UserDocument>>(getModelToken(User.name));
    const admin = await userModel.create({
      email: 'admin@fr14.vn',
      password: 'hash',
      displayName: 'admin',
      role: UserRole.ADMIN,
      status: UserStatus.ACTIVE,
    });
    adminToken = app.get(JwtService).sign({
      sub: String(admin._id),
      email: admin.email,
      role: UserRole.ADMIN,
    });
  });

  afterAll(async () => {
    delete process.env[FLAG];
    delete process.env.CRM_PII_ENCRYPTION_KEY;
    delete process.env.REDIS_KEY_PREFIX;
    await app?.close();
    await replSet?.stop();
  });

  it('FR-14: đối chứng, GET /crm/customers hợp lệ vẫn 200', async () => {
    const res = await call('GET', '/crm/customers');
    expect(res.status).toBe(200);
  });

  it.each([
    ['q[$ne]', '/crm/customers?q[$ne]=x'],
    ['q[$regex]', '/crm/customers?q[$regex]=.*'],
    ['statusIds[$ne]', '/crm/customers?statusIds[$ne]=x'],
    ['statusIds[$in]', '/crm/customers?statusIds[$in]=x'],
    ['tagIds[$gt]', '/crm/customers?tagIds[$gt]=x'],
    ['sourceIds[$ne]', '/crm/customers?sourceIds[$ne]=x'],
    ['occupation[$ne]', '/crm/customers?occupation[$ne]=x'],
    ['list-counts q[$ne]', '/crm/customers/list-counts?q[$ne]=x'],
    ['tags q[$ne]', '/crm/tags?q[$ne]=x'],
    ['lead-sources q[$ne]', '/crm/lead-sources?q[$ne]=x'],
    ['care-logs query', `/crm/customers/${FAKE_ID}/care-logs?type[$ne]=x`],
    ['appointments query', '/crm/appointments?status[$ne]=x'],
  ])('FR-14: GET %s trả 400 VALIDATION_FAILED', async (_name, url) => {
    const res = await call('GET', url);
    expect(res.status).toBe(400);
    expect(res.body.errorCode).toBe('VALIDATION_FAILED');
  });

  const bad = { $ne: null };
  it.each([
    ['POST khách', 'POST', '/crm/customers', { fullName: bad, phone: bad }],
    ['PATCH khách', 'PATCH', `/crm/customers/${FAKE_ID}`, { fullName: bad }],
    [
      'PATCH đổi tình trạng',
      'PATCH',
      `/crm/customers/${FAKE_ID}/status`,
      { statusId: bad },
    ],
    [
      'POST nhật ký',
      'POST',
      `/crm/customers/${FAKE_ID}/care-logs`,
      { content: bad },
    ],
    [
      'PATCH nhật ký',
      'PATCH',
      `/crm/customers/${FAKE_ID}/care-logs/${FAKE_ID}`,
      { content: bad },
    ],
    ['POST lịch hẹn', 'POST', '/crm/appointments', { customerId: bad }],
    ['PATCH lịch hẹn', 'PATCH', `/crm/appointments/${FAKE_ID}`, { title: bad }],
    ['POST thẻ', 'POST', '/crm/tags', { name: bad }],
    ['PATCH thẻ', 'PATCH', `/crm/tags/${FAKE_ID}`, { name: bad }],
    [
      'POST tình trạng',
      'POST',
      '/crm/customer-statuses',
      { code: bad, label: 'x' },
    ],
    [
      'PATCH tình trạng',
      'PATCH',
      `/crm/customer-statuses/${FAKE_ID}`,
      { label: bad },
    ],
    ['POST nguồn khách', 'POST', '/crm/lead-sources', { code: bad }],
    [
      'PATCH nguồn khách',
      'PATCH',
      `/crm/lead-sources/${FAKE_ID}`,
      { label: bad },
    ],
    ['POST kết quả liên hệ', 'POST', '/crm/contact-results', { code: bad }],
    [
      'PATCH kết quả liên hệ',
      'PATCH',
      `/crm/contact-results/${FAKE_ID}`,
      { label: bad },
    ],
    [
      'body lồng sâu trong mảng',
      'POST',
      '/crm/customers',
      { tagIds: [{ x: { $gt: 1 } }] },
    ],
  ] as const)(
    'FR-14: %s chứa `$ne` trả 400 VALIDATION_FAILED',
    async (_name, method, url, payload) => {
      const res = await call(method, url, payload);
      expect(res.status).toBe(400);
      expect(res.body.errorCode).toBe('VALIDATION_FAILED');
    },
  );
});
