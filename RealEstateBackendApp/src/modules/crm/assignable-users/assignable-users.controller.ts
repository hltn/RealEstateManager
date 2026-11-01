import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiPaginatedResponse } from '../../../common/decorators/api-response.decorators';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import type { JwtPayload } from '../../../common/decorators/current-user.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import { CRM_ROLES } from '../../../common/enums/user-role.enum';
import { CrmFeatureGuard } from '../../../common/guards/crm-feature.guard';
import { AssignableUsersService } from './assignable-users.service';
import {
  AssignableUserResponseDto,
  ListAssignableUsersQueryDto,
} from './dtos/assignable-users.dto';

@ApiTags('CRM - Assignable users')
@ApiBearerAuth()
@UseGuards(CrmFeatureGuard)
@Controller('crm/assignable-users')
export class AssignableUsersController {
  constructor(
    private readonly assignableUsersService: AssignableUsersService,
  ) {}

  @Get()
  @Roles(...CRM_ROLES)
  @ApiOperation({
    summary:
      'Người có thể được phân chăm sóc (Quản trị: tất cả; Quản lý: nhóm mình quản lý; Nhân viên: cùng nhóm). ' +
      'purpose=filter: nguồn ô lọc Người phụ trách (Quản lý: người trong careTeam của khách mình được thấy)',
  })
  @ApiPaginatedResponse(AssignableUserResponseDto)
  list(
    @CurrentUser() user: JwtPayload,
    @Query() query: ListAssignableUsersQueryDto,
  ) {
    return this.assignableUsersService.list(user, query);
  }
}
