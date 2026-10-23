import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ANY_ROLE_KEY } from '../decorators/any-role.decorator';
import type { JwtPayload } from '../decorators/current-user.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { UserRole } from '../enums/user-role.enum';

/**
 * Vai trò được vào route KHÔNG khai báo quyền: chỉ nhân sự nội bộ có từ trước CRM.
 * MANAGER/STAFF (CRM) phải được cho phép tường minh bằng `@Roles(...)` hoặc `@AnyRole()`.
 */
const DEFAULT_ALLOWED_ROLES: readonly string[] = [
  UserRole.ADMIN,
  UserRole.EDITOR,
];

/**
 * RolesGuard (global APP_GUARD) — chạy sau JwtAuthGuard, DEFAULT-DENY cho vai trò CRM.
 * - `@Public()` → pass (JwtAuthGuard cũng bỏ qua, không có `request.user`).
 * - Có `@Roles(...)` → `request.user.role` phải nằm trong danh sách, nếu không → 403 'Insufficient role'.
 * - Có `@AnyRole()` → mọi người dùng đã đăng nhập.
 * - Không có gì → CHỈ ADMIN/EDITOR (route cũ như tin tức, nguồn tin, Google Drive không lộ cho MANAGER/STAFF).
 *
 * Đọc role trực tiếp từ JWT payload (gắn bởi JwtAuthGuard), KHÔNG query DB. Với thao tác ghi cần quyền ADMIN
 * thật sự (không dựa vào bản chụp role trong token) dùng thêm `ActiveAdminGuard`.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()];

    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user as JwtPayload | undefined;
    const userRole = user?.role;

    const requiredRoles = this.reflector.getAllAndOverride<string[]>(
      ROLES_KEY,
      targets,
    );
    if (requiredRoles && requiredRoles.length > 0) {
      if (!userRole || !requiredRoles.includes(userRole)) {
        throw new ForbiddenException('Insufficient role');
      }
      return true;
    }

    if (this.reflector.getAllAndOverride<boolean>(ANY_ROLE_KEY, targets)) {
      return true;
    }

    if (!userRole || !DEFAULT_ALLOWED_ROLES.includes(userRole)) {
      throw new ForbiddenException('Insufficient role');
    }
    return true;
  }
}
