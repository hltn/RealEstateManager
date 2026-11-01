import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  ApiDataResponse,
  ApiPaginatedResponse,
} from '../../../common/decorators/api-response.decorators';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import type { JwtPayload } from '../../../common/decorators/current-user.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import { CRM_ROLES } from '../../../common/enums/user-role.enum';
import { CrmFeatureGuard } from '../../../common/guards/crm-feature.guard';
import { DailyTasksService } from './daily-tasks.service';
import {
  DailyTaskResponseDto,
  DailyTaskSummaryDto,
  DailyTaskSummaryQueryDto,
  ListDailyTasksQueryDto,
} from './dtos/daily-task.dto';

/** "Việc hôm nay" (tài liệu 05 mục 2.9): mặc định việc của mình; `scope=team` chỉ Quản trị/Quản lý. */
@ApiTags('CRM - Daily tasks')
@ApiBearerAuth()
@UseGuards(CrmFeatureGuard)
@Controller('crm/daily-tasks')
export class DailyTasksController {
  constructor(private readonly dailyTasks: DailyTasksService) {}

  @Get()
  @Roles(...CRM_ROLES)
  @ApiOperation({
    summary:
      'Việc hôm nay theo nhóm Quá hạn / Hôm nay / Sắp tới (lịch hẹn, bước tiếp theo, dịp đặc biệt, khách lâu chưa chăm sóc)',
  })
  @ApiPaginatedResponse(DailyTaskResponseDto)
  @ApiResponse({ status: 403, description: 'scope=team với Nhân viên' })
  list(
    @CurrentUser() user: JwtPayload,
    @Query() query: ListDailyTasksQueryDto,
  ) {
    return this.dailyTasks.list(user, query);
  }

  @Get('summary')
  @Roles(...CRM_ROLES)
  @ApiOperation({ summary: 'Số việc mỗi nhóm (badge tab, app)' })
  @ApiDataResponse(DailyTaskSummaryDto)
  async summary(
    @CurrentUser() user: JwtPayload,
    @Query() query: DailyTaskSummaryQueryDto,
  ) {
    return { data: await this.dailyTasks.summary(user, query) };
  }
}
