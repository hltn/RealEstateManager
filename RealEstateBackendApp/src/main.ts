// Nạp `.env` vào process.env ngay khi module eval — TRƯỚC NestFactory.create.
// CustomLogger lazy-init lần đầu (log nội bộ NestJS trong create()) sẽ thấy
// process.env.LOG_* đã sẵn → cache đúng giá trị env. dotenv mặc định KHÔNG ghi
// đè biến env đã set (Docker env_file đã nằm trong process.env lúc spawn).
import 'dotenv/config';
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
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import fastifyCookie from '@fastify/cookie';
import fastifyHelmet from '@fastify/helmet';
import fastifyMultipart from '@fastify/multipart';
import { buildHelmetOptions } from './common/security/helmet.config';
import { resolveTrustProxy } from './common/security/trust-proxy.config';
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

  // Swagger Documentation Setup
  const config = new DocumentBuilder()
    .setTitle('Real Estate API')
    .setDescription('The Real Estate API description')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/v1/docs', app, document);

  // Graceful Shutdown Hooks
  app.enableShutdownHooks();

  logger.log(
    `Feature flags: ${JSON.stringify(app.get(FeatureFlagService).snapshot())}`,
  );

  const port = configService.get<number>('PORT') || 3000;
  await app.listen(port, '0.0.0.0'); // Listen on all interfaces
  logger.log(`Application is running on: http://localhost:${port}`);
  logger.log(`Swagger docs available at: http://localhost:${port}/api/v1/docs`);
}
bootstrap();
