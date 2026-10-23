import type { FastifyHelmetOptions } from '@fastify/helmet';
import { ConfigService } from '@nestjs/config';

/**
 * Cấu hình Helmet (security headers: HSTS, nosniff, frameguard, referrer-policy...).
 *
 * CSP mặc định TẮT vì backend chủ yếu trả JSON và còn phục vụ file tĩnh của Admin SPA
 * (CSP chặt dễ làm vỡ font/script của SPA). Bật bằng `HELMET_CSP_ENABLED=true` khi
 * SPA được phục vụ riêng (nginx) — bộ chỉ thị đã nới tối thiểu để Swagger UI vẫn chạy.
 */
export function buildHelmetOptions(
  config: ConfigService,
): FastifyHelmetOptions {
  const isCspEnabled =
    String(config.get('HELMET_CSP_ENABLED') ?? 'false').toLowerCase() ===
    'true';

  return {
    contentSecurityPolicy: isCspEnabled
      ? {
          directives: {
            defaultSrc: ["'self'"],
            // Swagger UI dùng style/script inline và ảnh data: URI.
            styleSrc: ["'self'", "'unsafe-inline'"],
            scriptSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", 'data:', 'validator.swagger.io'],
          },
        }
      : false,
  };
}
