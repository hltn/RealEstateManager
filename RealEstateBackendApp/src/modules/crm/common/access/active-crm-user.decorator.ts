import { applyDecorators, UseGuards } from '@nestjs/common';
import { Roles } from '../../../../common/decorators/roles.decorator';
import { CRM_ROLES } from '../../../../common/enums/user-role.enum';
import { ActiveCrmUserGuard } from './active-crm-user.guard';

/**
 * Route đọc dành cho người dùng CRM: `@Roles(...CRM_ROLES)` (kiểm nhanh theo JWT) + `ActiveCrmUserGuard` (kiểm lại
 * status/role trong DB). Module chứa controller phải import `CrmCommonModule` (cung cấp `CrmActorService` cho guard).
 */
export const ActiveCrmUser = () =>
  applyDecorators(Roles(...CRM_ROLES), UseGuards(ActiveCrmUserGuard));
