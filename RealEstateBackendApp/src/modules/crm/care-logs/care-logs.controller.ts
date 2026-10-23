import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiHeader,
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
import { ParseObjectIdPipe } from '../../../common/pipes/parse-object-id.pipe';
import { IdempotencyService } from '../../../common/services/idempotency.service';
import { runCrmIdempotent } from '../common/idempotency.helper';
import { CareLogsService } from './care-logs.service';
import {
  CareLogResponseDto,
  CreateCareLogDto,
  DeleteCareLogQueryDto,
  ListCareLogsQueryDto,
  UpdateCareLogDto,
} from './dtos/care-log.dto';

const CLIENT_TYPE_HEADER = 'x-client-type';

/**
 * Nhật ký chăm sóc (tài liệu 05 mục 2.6). Quyền: Quản trị, Quản lý (trong phạm vi), Nhân viên trong nhóm chăm sóc;
 * sửa/xóa: tác giả trong 24 giờ, Quản trị, Quản lý (trong phạm vi) — do service kiểm.
 */
@ApiTags('CRM - Care logs')
@ApiBearerAuth()
@UseGuards(CrmFeatureGuard)
@Controller('crm/customers/:id/care-logs')
export class CareLogsController {
  constructor(
    private readonly careLogs: CareLogsService,
    private readonly idempotency: IdempotencyService,
  ) {}

  @Get()
  @Roles(...CRM_ROLES)
  @ApiOperation({
    summary:
      'Dòng thời gian nhật ký chăm sóc, mới nhất trước (ảnh có URL ký 15 phút)',
  })
  @ApiPaginatedResponse(CareLogResponseDto)
  list(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseObjectIdPipe) id: string,
    @Query() query: ListCareLogsQueryDto,
  ) {
    return this.careLogs.list(user, id, query);
  }

  @Post()
  @Roles(...CRM_ROLES)
  @ApiOperation({
    summary:
      'Ghi nhật ký chăm sóc: cập nhật lastCareLogAt, gắn ảnh đã upload. Hỗ trợ X-Idempotency-Key',
  })
  @ApiHeader({ name: 'X-Idempotency-Key', required: false })
  @ApiDataResponse(CareLogResponseDto, HttpStatus.CREATED)
  @ApiResponse({ status: 400, description: 'ATTACHMENT_LIMIT_EXCEEDED' })
  create(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: CreateCareLogDto,
    @Headers('x-idempotency-key') idempotencyKey?: string,
    @Headers(CLIENT_TYPE_HEADER) clientType?: string,
  ) {
    return runCrmIdempotent(
      this.idempotency,
      user.sub,
      `POST /crm/customers/${id}/care-logs`,
      idempotencyKey,
      async () => ({
        data: await this.careLogs.create(user, id, dto, clientType),
      }),
    );
  }

  @Patch(':logId')
  @Roles(...CRM_ROLES)
  @ApiOperation({
    summary:
      'Sửa nhật ký (tác giả trong 24 giờ, Quản trị, Quản lý trong phạm vi)',
  })
  @ApiDataResponse(CareLogResponseDto)
  @ApiResponse({ status: 403, description: 'CARE_LOG_EDIT_WINDOW_EXPIRED' })
  async update(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseObjectIdPipe) id: string,
    @Param('logId', ParseObjectIdPipe) logId: string,
    @Body() dto: UpdateCareLogDto,
    @Headers(CLIENT_TYPE_HEADER) clientType?: string,
  ) {
    return {
      data: await this.careLogs.update(user, id, logId, dto, clientType),
    };
  }

  @Delete(':logId')
  @Roles(...CRM_ROLES)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Xóa mềm nhật ký (cùng quyền với sửa)' })
  @ApiResponse({ status: 204, description: 'Đã xóa mềm' })
  @ApiResponse({ status: 403, description: 'CARE_LOG_EDIT_WINDOW_EXPIRED' })
  async remove(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseObjectIdPipe) id: string,
    @Param('logId', ParseObjectIdPipe) logId: string,
    @Query() query: DeleteCareLogQueryDto,
    @Headers(CLIENT_TYPE_HEADER) clientType?: string,
  ): Promise<void> {
    await this.careLogs.remove(user, id, logId, query.reason, clientType);
  }
}
