import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  ApiDataResponse,
  ApiPaginatedResponse,
} from '../../common/decorators/api-response.decorators';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { JwtPayload } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { CRM_ROLES } from '../../common/enums/user-role.enum';
import { CrmFeatureGuard } from '../../common/guards/crm-feature.guard';
import { ParseObjectIdPipe } from '../../common/pipes/parse-object-id.pipe';
import {
  ListNotificationsQueryDto,
  MarkNotificationsReadDto,
  MarkReadResultDto,
  NotificationResponseDto,
  UnreadCountResponseDto,
  UpdateNotificationDto,
} from './dtos/notification.dto';
import { NotificationsService } from './notifications.service';

/**
 * Hộp thông báo (chuông) của CHÍNH người gọi (tài liệu 05 mục 2.10). Mọi truy vấn lọc theo `userId` trong JWT nên
 * không có cách đọc/sửa thông báo của người khác; EDITOR không có quyền CRM.
 */
@ApiTags('Notifications')
@ApiBearerAuth()
@UseGuards(CrmFeatureGuard)
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @Roles(...CRM_ROLES)
  @ApiOperation({ summary: 'Hộp thông báo của tôi, mới nhất trước' })
  @ApiPaginatedResponse(NotificationResponseDto)
  list(
    @CurrentUser() user: JwtPayload,
    @Query() query: ListNotificationsQueryDto,
  ) {
    return this.notifications.list(user.sub, query);
  }

  @Get('unread-count')
  @Roles(...CRM_ROLES)
  @ApiOperation({ summary: 'Số thông báo chưa đọc (badge chuông)' })
  @ApiDataResponse(UnreadCountResponseDto)
  async unreadCount(@CurrentUser() user: JwtPayload) {
    return { data: { count: await this.notifications.unreadCount(user.sub) } };
  }

  @Patch(':id')
  @Roles(...CRM_ROLES)
  @ApiOperation({ summary: 'Đánh dấu một thông báo đã đọc/chưa đọc' })
  @ApiDataResponse(NotificationResponseDto)
  @ApiResponse({ status: 404, description: 'RESOURCE_NOT_FOUND' })
  async setRead(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: UpdateNotificationDto,
  ) {
    return { data: await this.notifications.setRead(user.sub, id, dto.isRead) };
  }

  @Patch()
  @Roles(...CRM_ROLES)
  @ApiOperation({
    summary:
      'Đánh dấu đã đọc hàng loạt (ids bỏ trống = tất cả thông báo chưa đọc của tôi; before = chỉ thông báo cũ hơn mốc)',
  })
  @ApiDataResponse(MarkReadResultDto)
  async markManyRead(
    @CurrentUser() user: JwtPayload,
    @Body() dto: MarkNotificationsReadDto,
  ) {
    return {
      data: {
        updated: await this.notifications.markManyRead(user.sub, {
          ids: dto.ids,
          before: dto.before,
        }),
      },
    };
  }
}
