import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { JwtPayload } from '../../../../common/decorators/current-user.decorator';
import { CRM_ROLES } from '../../../../common/enums/user-role.enum';
import { hasAnyRole } from '../../../../common/utils/user-roles.util';
import { CrmActorService } from './crm-actor.service';

/**
 * Xác nhận người gọi LÀ NGƯỜI DÙNG CRM ĐANG HOẠT ĐỘNG theo DỮ LIỆU HIỆN TẠI trong DB, không tin bản chụp role trong JWT
 * (access token sống tới 15 phút): tài khoản bị khóa/xóa mềm => 401, bị gỡ hết vai trò CRM (còn mỗi EDITOR) => 403 ngay.
 *
 * Dùng qua `@ActiveCrmUser()` cho các GET danh mục CRM (FR-21, Q8). Chạy sau `JwtAuthGuard`/`RolesGuard` toàn cục nên
 * `request.user` đã có. Khác `ActiveAdminGuard` ở chỗ chấp nhận mọi role trong `CRM_ROLES` (ADMIN/MANAGER/STAFF).
 */
@Injectable()
export class ActiveCrmUserGuard implements CanActivate {
  constructor(private readonly actors: CrmActorService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{ user?: JwtPayload }>();
    if (!request.user?.sub) throw new ForbiddenException('Insufficient role');

    // `resolve` ném 401 khi tài khoản không còn tồn tại hoặc không ACTIVE.
    const actor = await this.actors.resolve(request.user);
    if (!hasAnyRole(actor.roles, CRM_ROLES)) {
      throw new ForbiddenException('Insufficient role');
    }
    return true;
  }
}
