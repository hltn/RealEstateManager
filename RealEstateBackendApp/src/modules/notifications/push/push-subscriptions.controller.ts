import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
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
import { ParseObjectIdPipe } from '../../../common/pipes/parse-object-id.pipe';
import {
  PushConfigDto,
  PushSubscriptionListDto,
  PushSubscriptionRegisteredDto,
  RegisterPushSubscriptionDto,
} from './dtos/push-subscription.dto';
import { PushRegistrationThrottlerGuard } from './push-registration-throttler.guard';
import { PushSubscriptionManagementService } from './push-subscription-management.service';
import { PushSubscriptionsService } from './push-subscriptions.service';

/**
 * Thiết bị Web Push của CHÍNH người gọi (FR-01). `userId` luôn lấy từ JWT, không nhận từ body nên không đăng ký hộ
 * người khác. Liệt kê/gỡ/cấu hình (T-27) vẫn hoạt động khi cờ push tắt.
 */
@ApiTags('Push Subscriptions')
@ApiBearerAuth()
@UseGuards(CrmFeatureGuard)
@Controller('push-subscriptions')
export class PushSubscriptionsController {
  constructor(
    private readonly subscriptions: PushSubscriptionsService,
    private readonly management: PushSubscriptionManagementService,
  ) {}

  @Get('config')
  @Roles(...CRM_ROLES)
  @ApiOperation({
    summary:
      'Cấu hình push cho trình duyệt: enabled (cờ bật và đủ VAPID) và publicKey (null khi tắt)',
  })
  @ApiDataResponse(PushConfigDto)
  getConfig() {
    return { data: this.management.getConfig() };
  }

  @Get()
  @Roles(...CRM_ROLES)
  @ApiOperation({
    summary:
      'Thiết bị của chính mình: active (đang hiệu lực) và recentlyRevoked (thu hồi trong 7 ngày gần nhất)',
  })
  @ApiDataResponse(PushSubscriptionListDto)
  async list(@CurrentUser() user: JwtPayload) {
    return { data: await this.management.list(user.sub) };
  }

  @Delete(':id')
  @Roles(...CRM_ROLES)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary:
      'Gỡ một thiết bị của chính mình (lý do USER). Idempotent: gỡ lại vẫn 204',
  })
  @ApiResponse({ status: 204, description: 'Đã gỡ (hoặc đã gỡ từ trước)' })
  @ApiResponse({
    status: 404,
    description: 'RESOURCE_NOT_FOUND: không có hoặc là thiết bị của người khác',
  })
  async remove(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseObjectIdPipe) id: string,
  ): Promise<void> {
    await this.management.revokeOwn(user.sub, id);
  }

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
