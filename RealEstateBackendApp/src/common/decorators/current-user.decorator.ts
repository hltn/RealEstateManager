import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/**
 * @CurrentUser() — inject JWT payload (gắn bởi JwtAuthGuard) vào param handler.
 * Trả nguyên payload `{ sub, email, role, iat, exp }` — KHÔNG query DB.
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
  role: string;
  iat?: number;
  exp?: number;
}
