import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';
import type { JwtPayload } from '../decorators/current-user.decorator';

/**
 * RolesGuard (global APP_GUARD) — chạy sau JwtAuthGuard.
 * - Không có @Roles() metadata → pass (chỉ cần authenticated).
 * - Có @Roles(...) → `request.user.role` phải nằm trong allowedRoles,
 *   nếu không → 403 'Insufficient role'.
 *
 * Đọc role trực tiếp từ JWT payload (gắn bởi JwtAuthGuard), KHÔNG query DB.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user as JwtPayload | undefined;
    const userRole = user?.role;

    if (!userRole || !requiredRoles.includes(userRole)) {
      throw new ForbiddenException('Insufficient role');
    }

    return true;
  }
}
