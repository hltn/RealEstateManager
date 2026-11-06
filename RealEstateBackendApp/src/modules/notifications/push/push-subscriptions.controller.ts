import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { ApiDataResponse } from '../../../common/decorators/api-response.decorators';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import type { JwtPayload } from '../../../common/decorators/current-user.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import { CRM_ROLES } from '../../../common/enums/user-role.enum';
import { CrmFeatureGuard } from '../../../common/guards/crm-feature.guard';
import {
  PushSubscriptionRegisteredDto,
  RegisterPushSubscriptionDto,
} from './dtos/push-subscription.dto';
import { PushRegistrationThrottlerGuard } from './push-registration-throttler.guard';
import { PushSubscriptionsService } from './push-subscriptions.service';

/**
 * Thiết bị Web Push của CHÍNH người gọi (FR-01). `userId` luôn lấy từ JWT, không nhận từ body nên không đăng ký hộ
 * người khác. T-26 chỉ có đăng ký; liệt kê/hủy/cấu hình ở T-27.
 */
@ApiTags('Push Subscriptions')
@ApiBearerAuth()
@UseGuards(CrmFeatureGuard)
@Controller('push-subscriptions')
export class PushSubscriptionsController {
  constructor(private readonly subscriptions: PushSubscriptionsService) {}

  @Post()
  @Roles(...CRM_ROLES)
  @UseGuards(PushRegistrationThrottlerGuard)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary:
      'Đăng ký/làm mới thiết bị nhận push (upsert theo endpoint, tối đa 3 thiết bị mỗi người, giới hạn 10 yêu cầu/phút/người)',
  })
  @ApiDataResponse(PushSubscriptionRegisteredDto, HttpStatus.CREATED)
  @ApiResponse({
    status: 200,
    description: 'Endpoint đã có: làm mới/gán lại cho người gọi',
  })
  @ApiResponse({
    status: 400,
    description:
      'PUSH_SUBSCRIPTION_INVALID (endpoint không https/không thuộc allowlist/khóa sai) hoặc VALIDATION_FAILED',
  })
  @ApiResponse({ status: 429, description: 'Vượt 10 yêu cầu/phút' })
  async register(
    @CurrentUser() user: JwtPayload,
    @Body() dto: RegisterPushSubscriptionDto,
    @Headers('user-agent') userAgent: string | undefined,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const { created, subscription } = await this.subscriptions.register(
      user.sub,
      dto,
      userAgent,
    );
    void reply.status(created ? HttpStatus.CREATED : HttpStatus.OK);
    return { data: subscription };
  }
}
