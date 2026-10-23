import { applyDecorators, UseGuards } from '@nestjs/common';
import { Roles } from '../../../../common/decorators/roles.decorator';
import { UserRole } from '../../../../common/enums/user-role.enum';
import { ActiveAdminGuard } from './active-admin.guard';

/**
 * Route chỉ dành cho Quản trị: `@Roles(ADMIN)` (kiểm nhanh theo JWT) + `ActiveAdminGuard` (kiểm lại role/status trong DB).
 * Module chứa controller phải import `CrmCommonModule` (cung cấp `CrmActorService` cho guard).
 */
export const AdminOnly = () =>
  applyDecorators(Roles(UserRole.ADMIN), UseGuards(ActiveAdminGuard));
