import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiPaginatedResponse } from '../../../common/decorators/api-response.decorators';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import type { JwtPayload } from '../../../common/decorators/current-user.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import { CRM_ROLES } from '../../../common/enums/user-role.enum';
import { CrmFeatureGuard } from '../../../common/guards/crm-feature.guard';
import { CustomerAssigneesService } from './customer-assignees.service';
import {
  CustomerAssigneeResponseDto,
  ListCustomerAssigneesQueryDto,
} from './dtos/customer-assignees.dto';

/** Người phụ trách xuất hiện trong khách mình được thấy: nguồn cho ô lọc "Người phụ trách" (FR-09, FR-18). */
@ApiTags('CRM - Customers')
@ApiBearerAuth()
@UseGuards(CrmFeatureGuard)
@Controller('crm/customer-assignees')
export class CustomerAssigneesController {
  constructor(private readonly assignees: CustomerAssigneesService) {}

  @Get()
  @Roles(...CRM_ROLES)
  @ApiOperation({
    summary:
      'Người phụ trách cho ô lọc: người xuất hiện trong nhóm chăm sóc của các khách người gọi được thấy (bỏ khách xóa mềm), gồm cả người bị khóa (isLocked); lọc q/teamId; limit tối đa 100; không email/SĐT/CCCD',
  })
  @ApiPaginatedResponse(CustomerAssigneeResponseDto)
  list(
    @CurrentUser() user: JwtPayload,
    @Query() query: ListCustomerAssigneesQueryDto,
  ) {
    return this.assignees.list(user, query);
  }
}
