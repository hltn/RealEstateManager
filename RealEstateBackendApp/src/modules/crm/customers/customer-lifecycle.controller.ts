import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpStatus,
  Param,
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
import { ParseObjectIdPipe } from '../../../common/pipes/parse-object-id.pipe';
import { CrmFeatureGuard } from '../../../common/guards/crm-feature.guard';
import { IdempotencyService } from '../../../common/services/idempotency.service';
import { AdminOnly } from '../common/access/admin-only.decorator';
import { runCrmIdempotent } from '../common/idempotency.helper';
import { CustomerLifecycleService } from './customer-lifecycle.service';
import { CustomerPurgeService } from './customer-purge.service';
import { CustomerListService } from './customer-list.service';
import { ListDeletedCustomersQueryDto } from './dtos/customer-query.dto';
import {
  AnonymizeCustomerDto,
  RestoreCustomerDto,
} from './dtos/customer-request.dto';
import {
  AnonymizeResponseDto,
  CustomerDetailDto,
  DeletedCustomerListItemDto,
  PurgeCustomerResponseDto,
} from './dtos/customer-response.dto';

const CLIENT_TYPE_HEADER = 'x-client-type';

/** Khách đã xóa mềm, khôi phục, ẩn danh hóa, xóa vĩnh viễn — chỉ Quản trị (kiểm lại role trong DB qua `@AdminOnly()`). */
@ApiTags('CRM - Customer lifecycle')
@ApiBearerAuth()
@UseGuards(CrmFeatureGuard)
@Controller('crm')
export class CustomerLifecycleController {
  constructor(
    private readonly lifecycle: CustomerLifecycleService,
    private readonly purgeService: CustomerPurgeService,
    private readonly lists: CustomerListService,
    private readonly idempotency: IdempotencyService,
  ) {}

  @Get('deleted-customers')
  @AdminOnly()
  @ApiOperation({ summary: 'Danh sách khách đã xóa mềm (Quản trị)' })
  @ApiPaginatedResponse(DeletedCustomerListItemDto)
  listDeleted(
    @CurrentUser() user: JwtPayload,
    @Query() query: ListDeletedCustomersQueryDto,
  ) {
    return this.lists.listDeleted(user, query);
  }

  /**
   * Xóa vĩnh viễn = xóa PHẦN TỬ khỏi tập `deleted-customers` (danh từ số nhiều, không động từ trong URL; cùng tập với
   * `GET /crm/deleted-customers` mà màn "Khách đã xóa" đang liệt kê). Khách chưa xóa mềm không thuộc tập này nên bị 409.
   */
  @Delete('deleted-customers/:id')
  @AdminOnly()
  @ApiOperation({
    summary:
      'Xóa VĨNH VIỄN khách đã xóa mềm (Quản trị, KHÔNG hoàn tác): xóa nhật ký, ảnh (cả file MinIO), lịch hẹn, yêu cầu nhóm chăm sóc, nhắc, thông báo, audit cũ; giữ một dòng audit CUSTOMER_PURGED không PII; giải phóng SĐT',
  })
  @ApiDataResponse(PurgeCustomerResponseDto)
  @ApiResponse({ status: 404, description: 'CUSTOMER_NOT_FOUND' })
  @ApiResponse({
    status: 409,
    description:
      'CUSTOMER_NOT_DELETED (khách chưa xóa mềm) hoặc CUSTOMER_PURGE_IN_PROGRESS (một lần xóa vĩnh viễn khác đang chạy)',
  })
  @ApiResponse({
    status: 503,
    description:
      'SERVICE_UNAVAILABLE: không xóa được file ở kho lưu trữ, CHƯA xóa dữ liệu nào, thử lại được',
  })
  async purge(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseObjectIdPipe) id: string,
    @Headers(CLIENT_TYPE_HEADER) clientType?: string,
  ) {
    return { data: await this.purgeService.purge(user, id, clientType) };
  }

  @Post('customer-restorations')
  @AdminOnly()
  @ApiOperation({
    summary: 'Khôi phục khách đã xóa mềm (không áp dụng cho khách đã ẩn danh)',
  })
  @ApiDataResponse(CustomerDetailDto, HttpStatus.CREATED)
  @ApiResponse({
    status: 409,
    description:
      'CUSTOMER_ANONYMIZED (khách đã ẩn danh) hoặc CUSTOMER_PURGE_IN_PROGRESS (đang xóa vĩnh viễn)',
  })
  async restore(
    @CurrentUser() user: JwtPayload,
    @Body() dto: RestoreCustomerDto,
    @Headers(CLIENT_TYPE_HEADER) clientType?: string,
  ) {
    return { data: await this.lifecycle.restore(user, dto, clientType) };
  }

  @Post('customer-anonymizations')
  @AdminOnly()
  @ApiOperation({
    summary:
      'Ẩn danh hóa theo yêu cầu khách (KHÔNG hoàn tác): ghi đè PII, giữ khung thống kê. Hỗ trợ X-Idempotency-Key',
  })
  @ApiHeader({ name: 'X-Idempotency-Key', required: false })
  @ApiDataResponse(AnonymizeResponseDto, HttpStatus.CREATED)
  @ApiResponse({
    status: 409,
    description:
      'CUSTOMER_ANONYMIZED (đã ẩn danh) hoặc CUSTOMER_PURGE_IN_PROGRESS (đang xóa vĩnh viễn)',
  })
  anonymize(
    @CurrentUser() user: JwtPayload,
    @Body() dto: AnonymizeCustomerDto,
    @Headers('x-idempotency-key') idempotencyKey?: string,
    @Headers(CLIENT_TYPE_HEADER) clientType?: string,
  ) {
    return runCrmIdempotent(
      this.idempotency,
      user.sub,
      'POST /crm/customer-anonymizations',
      idempotencyKey,
      async () => ({
        data: await this.lifecycle.anonymize(user, dto, clientType),
      }),
    );
  }
}
