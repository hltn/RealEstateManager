import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiPaginatedResponse } from '../../../common/decorators/api-response.decorators';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import type { JwtPayload } from '../../../common/decorators/current-user.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import { CRM_ROLES } from '../../../common/enums/user-role.enum';
import { CrmFeatureGuard } from '../../../common/guards/crm-feature.guard';
import { ParseObjectIdPipe } from '../../../common/pipes/parse-object-id.pipe';
import { AdminOnly } from '../common/access/admin-only.decorator';
import {
  AuditLogEntryDto,
  CustomerHistoriesService,
  HistoryEntryDto,
} from './customer-histories.service';
import {
  ListAuditLogsQueryDto,
  ListHistoriesQueryDto,
} from './dtos/customer-query.dto';

/** Lịch sử thay đổi của khách (mọi người xem được khách) và audit toàn CRM (chỉ Quản trị). */
@ApiTags('CRM - Audit & histories')
@ApiBearerAuth()
@UseGuards(CrmFeatureGuard)
@Controller('crm')
export class CustomerHistoriesController {
  constructor(private readonly histories: CustomerHistoriesService) {}

  @Get('customers/:id/histories')
  @Roles(...CRM_ROLES)
  @ApiOperation({
    summary:
      'Lịch sử thay đổi của khách (SĐT cũ -> mới đầy đủ, CCCD luôn che; PHONE_VIEWED/NATIONAL_ID_VIEWED chỉ Quản trị/Quản lý)',
  })
  @ApiPaginatedResponse(HistoryEntryDto)
  listForCustomer(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseObjectIdPipe) id: string,
    @Query() query: ListHistoriesQueryDto,
  ) {
    return this.histories.listForCustomer(user, id, query);
  }

  @Get('audit-logs')
  @AdminOnly()
  @ApiOperation({ summary: 'Audit toàn CRM (Quản trị)' })
  @ApiPaginatedResponse(AuditLogEntryDto)
  listAll(@Query() query: ListAuditLogsQueryDto) {
    return this.histories.listAll(query);
  }
}
