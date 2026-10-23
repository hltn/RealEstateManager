/**
 * INTEGRATION (qa-agent, review M0) — lớp HTTP thật của nền tảng: Fastify + Helmet +
 * GlobalExceptionFilter + health probe qua Terminus, và hành vi khi Redis chết.
 *
 * Không cần Mongo/MinIO; chỉ Redis giả lập "chết" (cổng đóng). Chạy bằng `npm run test:integration`.
 *
 * Các case về 5xx bị che, query string và Redis fail-nhanh là hồi quy của lỗi đã biết ở review M0 (đã sửa).
 */
import {
  BadGatewayException,
  Controller,
  Get,
  HttpStatus,
  InternalServerErrorException,
  Logger,
  Module,
} from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { MongooseHealthIndicator, TerminusModule } from '@nestjs/terminus';
import fastifyHelmet from '@fastify/helmet';
import type Redis from 'ioredis';
import { HealthController } from '../health.controller';
import { RedisHealthIndicator } from '../health-indicators/redis.health-indicator';
import { StorageHealthIndicator } from '../health-indicators/storage.health-indicator';
import { RedisModule } from '../shared/redis/redis.module';
import { REDIS_CLIENT } from '../shared/redis/redis.constants';
import { FILE_STORAGE } from '../shared/storage/file-storage.interface';
import { BusinessException } from './exceptions/business.exception';
import { ErrorCode } from './exceptions/error-codes';
import { GlobalExceptionFilter } from './filters/global-exception.filter';
import { buildHelmetOptions } from './security/helmet.config';
import { IdempotencyService } from './services/idempotency.service';

jest.setTimeout(60_000);

const UPSTREAM_SECRET = 'upstream-key=sk-live-123456';

@Controller('probe')
class ProbeController {
  @Get('business')
  business() {
    throw new BusinessException(
      ErrorCode.CUSTOMER_PHONE_DUPLICATED,
      'Số điện thoại đã tồn tại',
      HttpStatus.CONFLICT,
      { existingCustomerId: 'c1' },
    );
  }

  @Get('boom')
  boom() {
    throw new Error(`mongo://admin:${UPSTREAM_SECRET}@10.0.0.5 failed`);
  }

  @Get('http-500')
  http500() {
    throw new InternalServerErrorException(
      `AI API failed after 3 retries: ${UPSTREAM_SECRET}`,
    );
  }

  @Get('http-502')
  http502() {
    throw new BadGatewayException(`upstream said ${UPSTREAM_SECRET}`);
  }
}

@Module({ controllers: [ProbeController] })
class ProbeModule {}

async function createApp(
  imports: unknown[],
  controllers: unknown[] = [],
  providers: unknown[] = [],
): Promise<NestFastifyApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: imports as never[],
    controllers: controllers as never[],
    providers: providers as never[],
  }).compile();
  const app = moduleRef.createNestApplication<NestFastifyApplication>(
    new FastifyAdapter(),
  );
  app.setGlobalPrefix('api/v1');
  await app.register(fastifyHelmet, buildHelmetOptions(app.get(ConfigService)));
  app.useGlobalFilters(new GlobalExceptionFilter());
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
}

describe('HTTP nền tảng: Helmet + GlobalExceptionFilter (Fastify thật)', () => {
  let app: NestFastifyApplication;
  let errorLog: jest.SpyInstance;

  beforeAll(async () => {
    app = await createApp([
      ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
      ProbeModule,
    ]);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    errorLog = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
  });

  afterEach(() => errorLog.mockRestore());

  const get = (url: string) => app.inject({ method: 'GET', url });

  it('Helmet: có header bảo mật cơ bản, không lộ x-powered-by, CSP mặc định tắt', async () => {
    const res = await get('/api/v1/probe/business');

    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBeDefined();
    expect(res.headers['strict-transport-security']).toContain('max-age=');
    expect(res.headers['referrer-policy']).toBeDefined();
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['content-security-policy']).toBeUndefined();
  });

  it('Helmet cũng áp dụng cho response LỖI (filter gửi bằng reply của Fastify)', async () => {
    const res = await get('/api/v1/probe/boom');

    expect(res.statusCode).toBe(500);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('BusinessException: 409 + errorCode + details + message tiếng Việt + timestamp/path', async () => {
    const res = await get('/api/v1/probe/business');

    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({
      statusCode: 409,
      message: 'Số điện thoại đã tồn tại',
      errorCode: 'CUSTOMER_PHONE_DUPLICATED',
      details: { existingCustomerId: 'c1' },
      timestamp: expect.any(String),
      path: '/api/v1/probe/business',
    });
  });

  it('route không tồn tại: 404 đúng khuôn lỗi chuẩn, không phải body mặc định của Fastify', async () => {
    const res = await get('/api/v1/khong-co');

    expect(res.statusCode).toBe(404);
    expect(Object.keys(res.json()).sort()).toEqual(
      ['errorCode', 'message', 'path', 'statusCode', 'timestamp'].sort(),
    );
  });

  it('lỗi không lường trước: 500 chung, KHÔNG lộ message gốc/stack/connection string trong response', async () => {
    const res = await get('/api/v1/probe/boom');
    const raw = res.body;

    expect(res.statusCode).toBe(500);
    expect(res.json().errorCode).toBe('INTERNAL_ERROR');
    expect(raw).not.toContain('mongo://');
    expect(raw).not.toContain(UPSTREAM_SECRET);
    expect(raw).not.toMatch(/\bat .*\.ts:\d+/);
    expect(raw).not.toContain('stack');
  });

  it('body JSON hỏng: 400 (không bị nuốt thành 500)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/probe/business',
      headers: { 'content-type': 'application/json' },
      payload: '{"a":',
    });

    expect(res.statusCode).toBe(400);
  });

  // HttpException 5xx do code nghiệp vụ ném không được đẩy message nguyên văn ra client.
  it('HttpException 500/502 mang message nội bộ/upstream: response phải được che thành thông báo chung', async () => {
    for (const url of ['/api/v1/probe/http-500', '/api/v1/probe/http-502']) {
      const res = await get(url);
      expect(res.body).not.toContain(UPSTREAM_SECRET);
    }
  });

  // Log lỗi 5xx không ghi query string (có thể chứa SĐT/email khách).
  it('log lỗi 5xx không được chứa query string (PII như ?phone=...)', async () => {
    await get('/api/v1/probe/boom?phone=0912345678&email=a@b.vn');

    const logged = errorLog.mock.calls
      .map((call) => String(call[0]))
      .join('\n');
    expect(logged).toContain('/api/v1/probe/boom');
    expect(logged).not.toContain('0912345678');
    expect(logged).not.toContain('a@b.vn');
  });

  // `path` trong body lỗi không lặp lại query string do client gửi.
  it('field path của body lỗi không chứa query string (tránh phản chiếu/ghi log PII ở proxy, FE)', async () => {
    const res = await get('/api/v1/probe/business?phone=0912345678');
    expect(res.json().path).not.toContain('0912345678');
  });
});

describe('Redis chết: hành vi của IdempotencyService và readiness (HTTP thật)', () => {
  let app: NestFastifyApplication;
  let idempotency: IdempotencyService;

  const storageStub = {
    isConfigured: () => false,
    checkHealth: () => Promise.resolve(),
  };

  beforeAll(async () => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    app = await createApp(
      [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          // Cổng 1 không có ai nghe → Redis "chết" ngay từ đầu.
          load: [() => ({ REDIS_URL: 'redis://127.0.0.1:1' })],
        }),
        RedisModule,
        TerminusModule,
      ],
      [HealthController],
      [
        IdempotencyService,
        RedisHealthIndicator,
        StorageHealthIndicator,
        { provide: FILE_STORAGE, useValue: storageStub },
        {
          provide: MongooseHealthIndicator,
          useValue: {
            pingCheck: (key: string) =>
              Promise.resolve({ [key]: { status: 'up' } }),
          },
        },
      ],
    );
    idempotency = app.get(IdempotencyService);
  });

  let isAppClosed = false;

  afterAll(async () => {
    jest.restoreAllMocks();
    if (!isAppClosed) await app.close();
  });

  it('liveness vẫn 200 khi Redis chết (không restart pod oan)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/health/liveness',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('ok');
  });

  it('readiness 503, chỉ rõ redis down bằng thông báo chung, không lộ địa chỉ/cổng/lỗi gốc', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/health/readiness',
    });

    expect(res.statusCode).toBe(503);
    const body = res.json();
    expect(body.errorCode).toBe('SERVICE_UNAVAILABLE');
    expect(body.details.redis).toEqual({
      status: 'down',
      message: 'Không kết nối được Redis',
    });
    expect(res.body).not.toContain('127.0.0.1');
    expect(res.body).not.toContain('ECONNREFUSED');
  });

  it('mỗi lệnh idempotency reject NHANH (enableOfflineQueue=false: không xếp hàng chờ kết nối), không treo, không âm thầm cho qua', async () => {
    const calls: Array<() => Promise<unknown>> = [
      () => idempotency.get('k'),
      () => idempotency.isInFlight('k'),
      () => idempotency.tryMarkInFlight('k'),
      () => idempotency.set('k', { ok: 1 }),
      () => idempotency.clearInFlight('k'),
    ];

    for (const call of calls) {
      const started = Date.now();
      await expect(call()).rejects.toBeDefined();
      expect(Date.now() - started).toBeLessThan(1_000);
    }
  });

  it('REDIS_CLIENT dùng chung vẫn là ioredis và không làm sập process khi lỗi kết nối (đã có listener error)', () => {
    const redis = app.get<Redis>(REDIS_CLIENT);
    expect(redis.listenerCount('error')).toBeGreaterThan(0);
  });

  it('tắt app khi Redis đã chết không bị treo chờ quit() (graceful shutdown nhanh)', async () => {
    const started = Date.now();

    await app.close();
    isAppClosed = true;

    expect(Date.now() - started).toBeLessThan(2_000);
  });
});
