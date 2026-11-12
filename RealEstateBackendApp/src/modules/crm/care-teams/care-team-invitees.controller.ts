import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { ApiPaginatedResponse } from '../../../common/decorators/api-response.decorators';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import type { JwtPayload } from '../../../common/decorators/current-user.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import { CRM_ROLES } from '../../../common/enums/user-role.enum';
import { CrmFeatureGuard } from '../../../common/guards/crm-feature.guard';
import { CareTeamInviteesService } from './care-team-invitees.service';
import {
  CareTeamInviteeResponseDto,
  ListCareTeamInviteesQueryDto,
} from './dtos/care-team-invitees.dto';

/** Người có thể được mời vào nhóm chăm sóc (tài liệu 05 mục 2.5, FR-13/FR-14). */
@ApiTags('CRM - Care team')
@ApiBearerAuth()
@UseGuards(CrmFeatureGuard)
@Controller('crm/care-team-invitees')
export class CareTeamInviteesController {
  constructor(private readonly invitees: CareTeamInviteesService) {}

  @Get()
  @Roles(...CRM_ROLES)
  @ApiOperation({
    summary:
      'Người có thể được mời vào nhóm chăm sóc: toàn hệ thống, user ACTIVE vai trò Quản lý/Nhân viên, loại người gọi và người đã trong nhóm (khi có customerId); chỉ trả id, tên, tên nhóm; Quản trị/Quản lý hoặc phụ trách chính (không customerId: chỉ Quản trị/Quản lý); rate-limit 60 lượt/phút/người; limit tối đa 20',
  })
  @ApiPaginatedResponse(CareTeamInviteeResponseDto)
  @ApiResponse({ status: 403, description: 'CARE_TEAM_ACTION_FORBIDDEN' })
  @ApiResponse({
    status: 404,
    description: 'CUSTOMER_NOT_FOUND (khách không tồn tại hoặc ngoài phạm vi)',
  })
  @ApiResponse({
    status: 429,
    description: 'RATE_LIMITED (INVITEE_SEARCH: 60 lượt/phút/người)',
  })
  list(
    @CurrentUser() user: JwtPayload,
    @Query() query: ListCareTeamInviteesQueryDto,
  ) {
    return this.invitees.list(user, query);
  }
}
