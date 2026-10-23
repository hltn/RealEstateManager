import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { JwtPayload } from '../../../../common/decorators/current-user.decorator';
import { UserRole } from '../../../../common/enums/user-role.enum';
import { CrmActorService } from './crm-actor.service';

/**
 * Xác nhận người gọi LÀ ADMIN ĐANG HOẠT ĐỘNG theo DỮ LIỆU HIỆN TẠI trong DB, không tin bản chụp role trong JWT
 * (access token sống tới 15 phút): ADMIN bị khóa/xóa => 401, bị hạ vai trò => 403 ngay lập tức.
 *
 * Dùng qua `@AdminOnly()` cho mọi thao tác GHI chỉ dành cho Quản trị (danh mục, dự án, nhóm, cài đặt, quản lý tài khoản).
 * Chạy sau `JwtAuthGuard`/`RolesGuard` toàn cục nên `request.user` đã có.
 */
@Injectable()
export class ActiveAdminGuard implements CanActivate {
  constructor(private readonly actors: CrmActorService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{ user?: JwtPayload }>();
    if (!request.user?.sub) throw new ForbiddenException('Insufficient role');

    // `resolve` ném 401 khi tài khoản không còn tồn tại hoặc không ACTIVE.
    const actor = await this.actors.resolve(request.user);
    if (actor.role !== UserRole.ADMIN) {
      throw new ForbiddenException('Insufficient role');
    }
    return true;
  }
}
