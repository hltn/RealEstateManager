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
  Put,
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
import { CRM_ROLES, UserRole } from '../../../common/enums/user-role.enum';
import { CrmFeatureGuard } from '../../../common/guards/crm-feature.guard';
import { ParseObjectIdPipe } from '../../../common/pipes/parse-object-id.pipe';
import { IdempotencyService } from '../../../common/services/idempotency.service';
import { runCrmIdempotent } from '../common/idempotency.helper';
import { CustomerCriteriaService } from './customer-criteria.service';
import { CustomerListService } from './customer-list.service';
import { CustomerLifecycleService } from './customer-lifecycle.service';
import { CustomerPhoneService } from './customer-phone.service';
import { CustomerStatusChangeService } from './customer-status-change.service';
import { CustomersService } from './customers.service';
import {
  ListCustomerCountsQueryDto,
  ListCustomersQueryDto,
} from './dtos/customer-query.dto';
import {
  ChangeStatusDto,
  CreateCustomerDto,
  DeleteCustomerQueryDto,
  PhoneLookupDto,
  UpdateCriteriaDto,
  UpdateCustomerDto,
  UpdateDataConsentDto,
} from './dtos/customer-request.dto';
import {
  ChangeStatusResponseDto,
  CriteriaUpdateResponseDto,
  CustomerDetailDto,
  CustomerListCountsDto,
  CustomerListItemDto,
  DataConsentResponseDto,
  PhoneLookupResponseDto,
} from './dtos/customer-response.dto';

const CLIENT_TYPE_HEADER = 'x-client-type';

/**
 * Khách hàng lõi (tài liệu 05 mục 2.3). Quyền: Quản trị, Quản lý (trong phạm vi), Nhân viên (trong phạm vi) —
 * phạm vi do `CustomerScope` ở tầng repository bảo đảm (ngoài phạm vi => 404 `CUSTOMER_NOT_FOUND`).
 * Route tĩnh (`list-counts`, `phone-lookups`) khai báo TRƯỚC `:id`.
 */
@ApiTags('CRM - Customers')
@ApiBearerAuth()
@UseGuards(CrmFeatureGuard)
@Controller('crm/customers')
export class CustomersController {
  constructor(
    private readonly customers: CustomersService,
    private readonly lists: CustomerListService,
    private readonly phones: CustomerPhoneService,
    private readonly statusChanges: CustomerStatusChangeService,
    private readonly criteria: CustomerCriteriaService,
    private readonly lifecycle: CustomerLifecycleService,
    private readonly idempotency: IdempotencyService,
  ) {}

  @Get()
  @Roles(...CRM_ROLES)
  @ApiOperation({
    summary:
      'Danh sách khách (tìm/lọc/sắp xếp, tab listGroup mặc định ALL); chỉ trả SĐT che',
  })
  @ApiPaginatedResponse(CustomerListItemDto)
  list(@CurrentUser() user: JwtPayload, @Query() query: ListCustomersQueryDto) {
    return this.lists.list(user, query);
  }

  @Get('list-counts')
  @Roles(...CRM_ROLES)
  @ApiOperation({
    summary:
      'Số khách mỗi tab Tất cả / Chưa tiếp cận / Có quan tâm / Khách net / Bỏ',
  })
  @ApiDataResponse(CustomerListCountsDto)
  async counts(
    @CurrentUser() user: JwtPayload,
    @Query() query: ListCustomerCountsQueryDto,
  ) {
    return { data: await this.lists.counts(user, query) };
  }

  @Post('phone-lookups')
  @Roles(...CRM_ROLES)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Kiểm tra trùng SĐT trước khi tạo (POST để SĐT không nằm trên URL); giới hạn 30 lần/phút/người',
  })
  @ApiDataResponse(PhoneLookupResponseDto)
  @ApiResponse({ status: 400, description: 'INVALID_PHONE' })
  @ApiResponse({ status: 429, description: 'RATE_LIMITED' })
  async lookupPhone(
    @CurrentUser() user: JwtPayload,
    @Body() dto: PhoneLookupDto,
    @Headers(CLIENT_TYPE_HEADER) clientType?: string,
  ) {
    return { data: await this.phones.lookup(user, dto, clientType) };
  }

  @Post()
  @Roles(...CRM_ROLES)
  @ApiOperation({
    summary:
      'Tạo khách (Nhân viên tạo => tự là phụ trách chính). Hỗ trợ X-Idempotency-Key',
  })
  @ApiHeader({ name: 'X-Idempotency-Key', required: false })
  @ApiDataResponse(CustomerDetailDto, HttpStatus.CREATED)
  @ApiResponse({ status: 409, description: 'CUSTOMER_PHONE_DUPLICATED' })
  create(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateCustomerDto,
    @Headers('x-idempotency-key') idempotencyKey?: string,
    @Headers(CLIENT_TYPE_HEADER) clientType?: string,
  ) {
    return runCrmIdempotent(
      this.idempotency,
      user.sub,
      'POST /crm/customers',
      idempotencyKey,
      async () => ({
        data: await this.customers.create(user, dto, clientType),
      }),
    );
  }

  @Get(':id')
  @Roles(...CRM_ROLES)
  @ApiOperation({ summary: 'Chi tiết hồ sơ khách (ngoài phạm vi: 404)' })
  @ApiDataResponse(CustomerDetailDto)
  async getById(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseObjectIdPipe) id: string,
  ) {
    return { data: await this.customers.getById(user, id) };
  }

  @Patch(':id')
  @Roles(...CRM_ROLES)
  @ApiOperation({
    summary:
      'Sửa hồ sơ cơ bản (khóa lạc quan theo version, lệch => 409 VERSION_CONFLICT)',
  })
  @ApiDataResponse(CustomerDetailDto)
  @ApiResponse({
    status: 409,
    description: 'VERSION_CONFLICT | CUSTOMER_PHONE_DUPLICATED',
  })
  async update(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: UpdateCustomerDto,
    @Headers(CLIENT_TYPE_HEADER) clientType?: string,
  ) {
    return { data: await this.customers.update(user, id, dto, clientType) };
  }

  @Patch(':id/status')
  @Roles(...CRM_ROLES)
  @ApiOperation({
    summary:
      'Đổi tình trạng; khách tự chuyển sang danh sách của tình trạng mới (dùng lại để Hoàn tác)',
  })
  @ApiDataResponse(ChangeStatusResponseDto)
  async changeStatus(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: ChangeStatusDto,
    @Headers(CLIENT_TYPE_HEADER) clientType?: string,
  ) {
    return { data: await this.statusChanges.change(user, id, dto, clientType) };
  }

  @Patch(':id/criteria')
  @Roles(...CRM_ROLES)
  @ApiOperation({
    summary:
      'Cập nhật 1-4 tiêu chí; server tính progress (số tiêu chí hoàn thành x 25)',
  })
  @ApiDataResponse(CriteriaUpdateResponseDto)
  async updateCriteria(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: UpdateCriteriaDto,
    @Headers(CLIENT_TYPE_HEADER) clientType?: string,
  ) {
    return {
      data: await this.criteria.updateCriteria(user, id, dto, clientType),
    };
  }

  @Put(':id/data-consent')
  @Roles(...CRM_ROLES)
  @ApiOperation({ summary: 'Ghi nhận / rút lại đồng ý xử lý dữ liệu cá nhân' })
  @ApiDataResponse(DataConsentResponseDto)
  async updateConsent(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: UpdateDataConsentDto,
    @Headers(CLIENT_TYPE_HEADER) clientType?: string,
  ) {
    return {
      data: await this.criteria.updateConsent(user, id, dto, clientType),
    };
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary:
      'Xóa mềm khách (Quản trị, Quản lý trong phạm vi); bắt buộc query reason',
  })
  @ApiResponse({ status: 204, description: 'Đã xóa mềm' })
  async remove(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseObjectIdPipe) id: string,
    @Query() query: DeleteCustomerQueryDto,
    @Headers(CLIENT_TYPE_HEADER) clientType?: string,
  ): Promise<void> {
    await this.lifecycle.softDelete(user, id, query.reason, clientType);
  }
}
