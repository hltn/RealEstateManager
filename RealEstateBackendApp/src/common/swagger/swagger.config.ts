import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

/** Đường dẫn Swagger UI (đã gồm tiền tố version `api/v1`). */
export const SWAGGER_PATH = 'api/v1/docs';

/** Các giá trị `NODE_ENV` (sau khi trim + hạ chữ thường) được phép bật Swagger. */
export const SWAGGER_ALLOWED_ENVS: readonly string[] = [
  'development',
  'test',
  'staging',
  'local',
];

/**
 * Swagger chỉ bật khi `NODE_ENV` là một môi trường phi-production ĐƯỢC LIỆT KÊ (PT-008, fail-safe).
 * Chuẩn hóa trước khi so (trim + hạ chữ thường) để `Production`, ` production `, hoặc `production` kèm ký tự CR
 * (file `.env.docker` lưu CRLF) vẫn tắt. Giá trị lạ/gõ nhầm (`prod`, `prodution`) hoặc chưa đặt => TẮT,
 * không lộ tài liệu API ra ngoài.
 */
export const isSwaggerEnabled = (
  nodeEnv: string | undefined = process.env.NODE_ENV,
): boolean =>
  SWAGGER_ALLOWED_ENVS.includes((nodeEnv ?? '').trim().toLowerCase());

/**
 * Đăng ký Swagger UI tại `SWAGGER_PATH` khi `isSwaggerEnabled(nodeEnv)`.
 * Trả `true` nếu đã đăng ký, `false` nếu bị bỏ qua (production/giá trị lạ => `docs`, `docs-json`, `docs-yaml`
 * đều không tồn tại, trả 404).
 */
export const setupSwagger = (
  app: INestApplication,
  nodeEnv: string | undefined = process.env.NODE_ENV,
): boolean => {
  if (!isSwaggerEnabled(nodeEnv)) return false;
  const config = new DocumentBuilder()
    .setTitle('Real Estate API')
    .setDescription('The Real Estate API description')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup(SWAGGER_PATH, app, document);
  return true;
};
