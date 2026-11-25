import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { parseBooleanFlag } from '../utils/env-flag.util';

/** Đường dẫn Swagger UI (đã gồm tiền tố version `api/v1`). */
export const SWAGGER_PATH = 'api/v1/docs';

/** Tên biến môi trường bật/tắt Swagger (FR-18). `NODE_ENV` không còn quyết định việc này. */
export const SWAGGER_ENABLED_ENV = 'CRM_SWAGGER_ENABLED';

/**
 * Hàm thuần: giá trị cấu hình `CRM_SWAGGER_ENABLED` có bật Swagger không.
 * Chỉ `1|true|yes|on` (không phân biệt hoa thường, bỏ khoảng trắng/CR của file `.env` CRLF) mới bật. Thiếu, rỗng hoặc
 * giá trị lạ/gõ nhầm => TẮT (fail-safe, không lộ tài liệu API ra ngoài). Nơi gọi (`main.ts`) tự đọc cấu hình và truyền vào.
 */
export const isSwaggerEnabled = (rawValue: unknown): boolean =>
  parseBooleanFlag(rawValue);

/**
 * Đăng ký Swagger UI tại `SWAGGER_PATH` khi `isSwaggerEnabled(rawValue)`.
 * Trả `true` nếu đã đăng ký, `false` nếu bị bỏ qua (tắt => `docs`, `docs-json`, `docs-yaml` đều không tồn tại, trả 404).
 */
export const setupSwagger = (
  app: INestApplication,
  rawValue: unknown,
): boolean => {
  if (!isSwaggerEnabled(rawValue)) return false;
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

/** Nguồn cấu hình tối thiểu `setupSwaggerFromConfig` cần (khớp `ConfigService.get`). */
export interface SwaggerFlagSource {
  get<T = string>(key: string): T | undefined;
}

/**
 * Dây nối cấu hình -> Swagger cho `main.ts`: đọc `CRM_SWAGGER_ENABLED` từ `config` rồi gọi `setupSwagger`.
 * Trả cờ thô (để log) và kết quả đăng ký.
 */
export const setupSwaggerFromConfig = (
  app: INestApplication,
  config: SwaggerFlagSource,
): { flag: string | undefined; isOn: boolean } => {
  const flag = config.get<string>(SWAGGER_ENABLED_ENV);
  return { flag, isOn: setupSwagger(app, flag) };
};
