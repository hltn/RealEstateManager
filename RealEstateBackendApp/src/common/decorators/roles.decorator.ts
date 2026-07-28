import { SetMetadata } from '@nestjs/common';
import { UserRole } from '../enums/user-role.enum';

export const ROLES_KEY = 'roles';
/**
 * @Roles(...roles) — chỉ cho phép các role cụ thể truy cập route.
 * RolesGuard đọc metadata này và so khớp với `request.user.role`.
 */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
