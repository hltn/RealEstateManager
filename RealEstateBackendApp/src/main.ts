// Nạp `.env` (['.env', '../.env'], file gần thắng) vào process.env ngay khi module eval — TRƯỚC NestFactory.create.
// CustomLogger lazy-init lần đầu (log nội bộ NestJS trong create()) sẽ thấy
// process.env.LOG_* đã sẵn → cache đúng giá trị env. dotenv KHÔNG ghi
// đè biến env đã set (Docker compose `environment:` đã nằm trong process.env lúc spawn).
import './common/config/load-env';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { CustomLogger } from './common/logger/custom-logger.service';
import { ConfigService } from '@nestjs/config';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyHelmet from '@fastify/helmet';
import fastifyMultipart from '@fastify/multipart';
import { buildHelmetOptions } from './common/security/helmet.config';
import { resolveTrustProxy } from './common/security/trust-proxy.config';
import {
  setupSwaggerFromConfig,
  SWAGGER_ENABLED_ENV,
  SWAGGER_PATH,
} from './common/swagger/swagger.config';
import { FeatureFlagService } from './shared/feature-flags/feature-flag.service';

async function bootstrap() {
  // TRUST_PROXY (số hop, vd 1 sau nginx) quyết định req.ip cho ThrottlerGuard/audit log;
  // giá trị sai ném lỗi ngay → app không khởi động (fail-fast), không bao giờ nhận `true`.
  const trustProxy = resolveTrustProxy();
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ trustProxy }),
    { logger: new CustomLogger() },
  );
  const logger = new CustomLogger('Bootstrap');
  const configService = app.get(ConfigService);
  logger.log(
    trustProxy
      ? `trustProxy bật: tin ${trustProxy} proxy (req.ip lấy từ X-Forwarded-For)`
      : 'trustProxy tắt: req.ip là IP kết nối trực tiếp',
  );

  // Set global prefix
  app.setGlobalPrefix('api/v1');

  // Helmet: security headers (HSTS, nosniff, frameguard...). Đăng ký trước mọi route.
  await app.register(fastifyHelmet, buildHelmetOptions(configService));

  // Đăng ký @fastify/cookie để parse httpOnly refresh cookie.
  await app.register(fastifyCookie, {
    secret: configService.get<string>('COOKIE_SECRET'),
  });

  // multipart/form-data cho upload ảnh đính kèm CRM (file ≤ 5 MB, mỗi request 1 file; kiểm loại ở nghiệp vụ).
  await app.register(fastifyMultipart, {
    limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 5 },
  });

  // CORS: credentials=true cho httpOnly cookie cross-origin (dev).
  app.enableCors({
    origin:
      configService.get<string>('FRONTEND_URL') || 'http://localhost:5173',
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    credentials: true,
  });

  // Setup Global Validation Pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // Setup Global Exception Filter
  app.useGlobalFilters(new GlobalExceptionFilter());

  // Swagger chỉ bật khi CRM_SWAGGER_ENABLED truthy (1/true/yes/on); thiếu/rỗng/lạ => tắt (fail-safe, FR-18).
  // NODE_ENV không còn quyết định việc này (luôn production ở mọi môi trường).
  const { flag: swaggerFlag, isOn: isSwaggerOn } = setupSwaggerFromConfig(
    app,
    configService,
  );

  // Graceful Shutdown Hooks
  app.enableShutdownHooks();

  logger.log(
    `Feature flags: ${JSON.stringify(app.get(FeatureFlagService).snapshot())}`,
  );

  const port = configService.get<number>('PORT') || 3000;
  await app.listen(port, '0.0.0.0'); // Listen on all interfaces
  logger.log(`Application is running on: http://localhost:${port}`);
  logger.log(
    isSwaggerOn
      ? `Swagger docs available at: http://localhost:${port}/${SWAGGER_PATH}`
      : `Swagger docs đã tắt (${SWAGGER_ENABLED_ENV}=${swaggerFlag ?? '(chưa đặt)'})`,
  );
}
bootstrap();
