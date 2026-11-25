import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiExtraModels,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { ApiDataResponse } from '../../common/decorators/api-response.decorators';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { JwtPayload } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { CRM_ROLES } from '../../common/enums/user-role.enum';
import { CrmFeatureGuard } from '../../common/guards/crm-feature.guard';
import {
  NotificationPreferencesResponseDto,
  PushTypeInfoDto,
  TypePreferenceDto,
  UpdateNotificationPreferencesDto,
} from './dtos/notification-preference.dto';
import { NotificationPreferencesService } from './notification-preferences.service';

/** Cài đặt thông báo của chính người gọi (tài liệu 05 mục 2.10). */
@ApiTags('Notifications')
@ApiBearerAuth()
@ApiExtraModels(TypePreferenceDto, PushTypeInfoDto)
@UseGuards(CrmFeatureGuard)
@Controller('notification-preferences')
export class NotificationPreferencesController {
  constructor(private readonly preferences: NotificationPreferencesService) {}

  @Get('me')
  @Roles(...CRM_ROLES)
  @ApiOperation({
    summary:
      'Cài đặt bật/tắt từng loại thông báo của tôi (loại chưa đổi = bật) kèm danh sách loại có push (pushTypes) và giờ yên lặng. Tắt inApp của một loại nghĩa là không có thông báo trong app VÀ không có push',
  })
  @ApiDataResponse(NotificationPreferencesResponseDto)
  async get(@CurrentUser() user: JwtPayload) {
    return { data: await this.preferences.get(user.sub) };
  }

  @Put('me')
  @Roles(...CRM_ROLES)
  @ApiOperation({
    summary:
      'Lưu cài đặt thông báo của tôi (chỉ cập nhật các loại gửi lên; quietHours=null để bỏ giờ yên lặng, start phải khác end). Tắt inApp nghĩa là không push',
  })
  @ApiDataResponse(NotificationPreferencesResponseDto)
  async update(
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpdateNotificationPreferencesDto,
  ) {
    return { data: await this.preferences.update(user.sub, dto) };
  }
}
