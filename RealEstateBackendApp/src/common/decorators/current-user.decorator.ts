import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/**
 * @CurrentUser() — inject JWT payload (gắn bởi JwtAuthGuard) vào param handler.
 * Trả nguyên payload `{ sub, email, role, roles, iat, exp }` — KHÔNG query DB.
 * Controller dùng `sub` (ObjectId string) để định danh user.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    return request.user;
  },
);

/** Kiểu JWT payload gắn vào request.user bởi JwtAuthGuard. */
export interface JwtPayload {
  sub: string;
  email: string;
  /** Role cao nhất của tài khoản (ADMIN > MANAGER > STAFF > EDITOR) — giữ cho client/token cũ. */
  role: string;
  /** Mọi role của tài khoản. Token cấp trước khi có nhiều role chỉ có `role`: dùng `rolesOf(payload)`. */
  roles?: string[];
  iat?: number;
  exp?: number;
}
