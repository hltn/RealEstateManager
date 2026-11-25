import { Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ThrottlerGuard } from '@nestjs/throttler';
import type {
  ThrottlerModuleOptions,
  ThrottlerStorage,
} from '@nestjs/throttler';
import {
  PUSH_REGISTER_THROTTLE_LIMIT,
  PUSH_REGISTER_THROTTLE_TTL_MS,
} from './push-subscription.constants';

/** Token cấu hình riêng của throttler đăng ký push (không dùng `THROTTLER:MODULE_OPTIONS` toàn cục). */
export const PUSH_THROTTLER_OPTIONS = Symbol('PUSH_THROTTLER_OPTIONS');
/** Token kho đếm riêng của throttler đăng ký push (tách bộ đếm `default` toàn cục). */
export const PUSH_THROTTLER_STORAGE = Symbol('PUSH_THROTTLER_STORAGE');

/** Tracker theo `userId` (JWT `sub`), dự phòng IP; không phải IP để nhiều người chung mạng văn phòng không chặn nhau. */
const trackByUser = (req: Record<string, unknown>): string =>
  String((req.user as { sub?: string } | undefined)?.sub ?? req.ip);

/** Cấu hình throttler `pushRegister`: 10 yêu cầu/phút/người. */
export const PUSH_THROTTLER_MODULE_OPTIONS: ThrottlerModuleOptions = [
  {
    name: 'pushRegister',
    limit: PUSH_REGISTER_THROTTLE_LIMIT,
    ttl: PUSH_REGISTER_THROTTLE_TTL_MS,
    getTracker: trackByUser,
  },
];

/**
 * Giới hạn đăng ký Web Push: 10 yêu cầu/phút MỖI NGƯỜI.
 *
 * `ThrottlerGuard` toàn cục chạy TRƯỚC `JwtAuthGuard` nên chưa có `req.user`; guard này gắn ở method nên chạy SAU
 * guard toàn cục, lúc đó `req.user.sub` đã có.
 *
 * Tự chứa cấu hình + kho đếm (token riêng `PUSH_THROTTLER_*`) thay vì inject `THROTTLER:MODULE_OPTIONS`: không phụ
 * thuộc `ThrottlerModule.forRoot` của AuthModule (nên module/test nào import `NotificationsModule` cũng chạy được) và
 * không ghi đè cấu hình `default` 100/phút/IP của app thật.
 */
@Injectable()
export class PushRegistrationThrottlerGuard extends ThrottlerGuard {
  constructor(
    @Inject(PUSH_THROTTLER_OPTIONS) options: ThrottlerModuleOptions,
    @Inject(PUSH_THROTTLER_STORAGE) storageService: ThrottlerStorage,
    reflector: Reflector,
  ) {
    super(options, storageService, reflector);
  }
}
