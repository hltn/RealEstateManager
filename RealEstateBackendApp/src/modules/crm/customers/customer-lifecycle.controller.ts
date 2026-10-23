import {
  Body,
  Controller,
  Get,
  Headers,
  HttpStatus,
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
import { CrmFeatureGuard } from '../../../common/guards/crm-feature.guard';
import { IdempotencyService } from '../../../common/services/idempotency.service';
import { AdminOnly } from '../common/access/admin-only.decorator';
import { runCrmIdempotent } from '../common/idempotency.helper';
import { CustomerLifecycleService } from './customer-lifecycle.service';
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
} from './dtos/customer-response.dto';

const CLIENT_TYPE_HEADER = 'x-client-type';

/** Khách đã xóa mềm, khôi phục, ẩn danh hóa — chỉ Quản trị (kiểm lại role trong DB qua `@AdminOnly()`). */
@ApiTags('CRM - Customer lifecycle')
@ApiBearerAuth()
@UseGuards(CrmFeatureGuard)
@Controller('crm')
export class CustomerLifecycleController {
  constructor(
    private readonly lifecycle: CustomerLifecycleService,
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

  @Post('customer-restorations')
  @AdminOnly()
  @ApiOperation({
    summary: 'Khôi phục khách đã xóa mềm (không áp dụng cho khách đã ẩn danh)',
  })
  @ApiDataResponse(CustomerDetailDto, HttpStatus.CREATED)
  @ApiResponse({ status: 409, description: 'CUSTOMER_ANONYMIZED' })
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
