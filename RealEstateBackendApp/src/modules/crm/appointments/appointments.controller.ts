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
import { AppointmentsService } from './appointments.service';
import {
  AppointmentResponseDto,
  AppointmentWithCareLogResponseDto,
  ChangeAppointmentStatusDto,
  CreateAppointmentDto,
  ListAppointmentsQueryDto,
  UpdateAppointmentDto,
} from './dtos/appointment.dto';

const CLIENT_TYPE_HEADER = 'x-client-type';

/**
 * Lịch hẹn (tài liệu 05 mục 2.9). Quyền: Quản trị, Quản lý (trong phạm vi), Nhân viên trong nhóm chăm sóc của khách;
 * xóa mềm: Quản trị, Quản lý (trong phạm vi) hoặc người tạo lịch — do service kiểm. Lịch của khách ngoài phạm vi
 * (hoặc không tồn tại) trả 404 `RESOURCE_NOT_FOUND`.
 */
@ApiTags('CRM - Appointments')
@ApiBearerAuth()
@UseGuards(CrmFeatureGuard)
@Controller('crm/appointments')
export class AppointmentsController {
  constructor(
    private readonly appointments: AppointmentsService,
    private readonly idempotency: IdempotencyService,
  ) {}

  @Get()
  @Roles(...CRM_ROLES)
  @ApiOperation({
    summary:
      'Lịch hẹn theo khoảng thời gian (tối đa 62 ngày) hoặc theo khách, theo phạm vi của người gọi',
  })
  @ApiPaginatedResponse(AppointmentResponseDto)
  list(
    @CurrentUser() user: JwtPayload,
    @Query() query: ListAppointmentsQueryDto,
  ) {
    return this.appointments.list(user, query);
  }

  @Post()
  @Roles(...CRM_ROLES)
  @ApiOperation({
    summary:
      'Tạo lịch hẹn: tự tạo nhắc việc, cập nhật nextAppointmentAt của khách. Hỗ trợ X-Idempotency-Key',
  })
  @ApiHeader({ name: 'X-Idempotency-Key', required: false })
  @ApiDataResponse(AppointmentResponseDto, HttpStatus.CREATED)
  @ApiResponse({
    status: 400,
    description: 'VALIDATION_FAILED, USER_NOT_ASSIGNABLE',
  })
  @ApiResponse({ status: 404, description: 'CUSTOMER_NOT_FOUND' })
  create(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateAppointmentDto,
    @Headers('x-idempotency-key') idempotencyKey?: string,
    @Headers(CLIENT_TYPE_HEADER) clientType?: string,
  ) {
    return runCrmIdempotent(
      this.idempotency,
      user.sub,
      'POST /crm/appointments',
      idempotencyKey,
      async () => ({
        data: await this.appointments.create(user, dto, clientType),
      }),
    );
  }

  @Get(':id')
  @Roles(...CRM_ROLES)
  @ApiOperation({ summary: 'Chi tiết lịch hẹn' })
  @ApiDataResponse(AppointmentResponseDto)
  @ApiResponse({ status: 404, description: 'RESOURCE_NOT_FOUND' })
  async get(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseObjectIdPipe) id: string,
  ) {
    return { data: await this.appointments.get(user, id) };
  }

  @Patch(':id')
  @Roles(...CRM_ROLES)
  @ApiOperation({
    summary:
      'Dời lịch / sửa lịch đang chờ thực hiện (tính lại nhắc việc). `version` tùy chọn để chống ghi đè',
  })
  @ApiDataResponse(AppointmentResponseDto)
  @ApiResponse({
    status: 409,
    description: 'VERSION_CONFLICT, APPOINTMENT_STATUS_INVALID',
  })
  async update(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: UpdateAppointmentDto,
    @Headers(CLIENT_TYPE_HEADER) clientType?: string,
  ) {
    return { data: await this.appointments.update(user, id, dto, clientType) };
  }

  @Patch(':id/status')
  @Roles(...CRM_ROLES)
  @ApiOperation({
    summary:
      'Hoàn thành / hủy / mở lại lịch hẹn; createCareLog (khi DONE) ghi luôn nhật ký kết quả',
  })
  @ApiDataResponse(AppointmentWithCareLogResponseDto)
  @ApiResponse({
    status: 409,
    description: 'VERSION_CONFLICT, APPOINTMENT_STATUS_INVALID',
  })
  async changeStatus(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: ChangeAppointmentStatusDto,
    @Headers(CLIENT_TYPE_HEADER) clientType?: string,
  ) {
    return {
      data: await this.appointments.changeStatus(user, id, dto, clientType),
    };
  }

  @Delete(':id')
  @Roles(...CRM_ROLES)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary:
      'Xóa mềm lịch hẹn nhập nhầm (Quản trị, Quản lý trong phạm vi, người tạo lịch)',
  })
  @ApiResponse({ status: 204, description: 'Đã xóa mềm' })
  @ApiResponse({ status: 403, description: 'Không phải người tạo lịch' })
  async remove(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseObjectIdPipe) id: string,
    @Headers(CLIENT_TYPE_HEADER) clientType?: string,
  ): Promise<void> {
    await this.appointments.remove(user, id, clientType);
  }
}
