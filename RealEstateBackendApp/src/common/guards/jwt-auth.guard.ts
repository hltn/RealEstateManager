import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { FastifyRequest } from 'fastify';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

/**
 * FastifyRequest không có sẵn field `user` — mở rộng bằng type riêng để gắn
 * JWT payload (guard KHÔNG query DB).
 */
type FastifyRequestWithUser = FastifyRequest & { user?: unknown };

/**
 * JwtAuthGuard (global APP_GUARD) — secure-by-default: mọi route đều cần
 * access token hợp lệ trừ khi đánh dấu @Public().
 *
 * Fastify (KHÔNG dùng Express):
 * - Đọc `request.headers.authorization` (string `'Bearer <token>'`).
 * - KHÔNG có `req.get('authorization')` như Express.
 * - Cookie không parse ở đây (do @fastify/cookie ở cấp plugin).
 *
 * Dùng `JwtService.verify()` (sync) theo mục 8. Payload gắn vào
 * `request.user` = `{ sub, email, role, iat, exp }`. RolesGuard + @CurrentUser()
 * đọc từ đây.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwtService: JwtService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<FastifyRequestWithUser>();
    const authorization = request.headers.authorization;

    if (!authorization || !authorization.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing or invalid access token');
    }

    const token = authorization.slice('Bearer '.length).trim();
    if (!token) {
      throw new UnauthorizedException('Missing or invalid access token');
    }

    let payload: Record<string, unknown>;
    try {
      payload = this.jwtService.verify(token) as Record<string, unknown>;
    } catch {
      // Token sai chữ ký / hết hạn / malformed → cùng message để không rò rỉ thông tin.
      throw new UnauthorizedException('Missing or invalid access token');
    }

    request.user = payload;
    return true;
  }
}
