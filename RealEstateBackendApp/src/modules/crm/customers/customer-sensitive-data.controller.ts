import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
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
} from '../../../common/decorators/api-response.decorators';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import type { JwtPayload } from '../../../common/decorators/current-user.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import { CRM_ROLES, UserRole } from '../../../common/enums/user-role.enum';
import { CrmFeatureGuard } from '../../../common/guards/crm-feature.guard';
import { ParseObjectIdPipe } from '../../../common/pipes/parse-object-id.pipe';
import { CustomerNationalIdService } from './customer-national-id.service';
import { CustomerPhoneService } from './customer-phone.service';
import { ListNationalIdViewsQueryDto } from './dtos/customer-query.dto';
import {
  NationalIdViewDto,
  PhoneViewDto,
  SetNationalIdDto,
} from './dtos/customer-request.dto';
import {
  NationalIdSummaryDto,
  NationalIdViewEntryDto,
  NationalIdViewResponseDto,
  PhoneViewResponseDto,
} from './dtos/customer-response.dto';

const CLIENT_TYPE_HEADER = 'x-client-type';

/**
 * Dữ liệu nhạy cảm của khách: CCCD và xem/gọi SĐT đầy đủ (tài liệu 05 mục 2.4). Mọi lần lộ số đều ghi audit và
 * trả `Cache-Control: no-store`. Người ngoài phạm vi nhận 404.
 */
@ApiTags('CRM - Customer sensitive data')
@ApiBearerAuth()
@UseGuards(CrmFeatureGuard)
@Controller('crm/customers/:id')
export class CustomerSensitiveDataController {
  constructor(
    private readonly nationalIds: CustomerNationalIdService,
    private readonly phones: CustomerPhoneService,
  ) {}

  @Put('national-id')
  @Roles(...CRM_ROLES)
  @ApiOperation({
    summary: 'Nhập/sửa CCCD (mã hóa AES-256-GCM, chỉ lưu 4 số cuối dạng rõ)',
  })
  @ApiDataResponse(NationalIdSummaryDto)
  async setNationalId(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: SetNationalIdDto,
    @Headers(CLIENT_TYPE_HEADER) clientType?: string,
  ) {
    return { data: await this.nationalIds.set(user, id, dto, clientType) };
  }

  @Delete('national-id')
  @Roles(...CRM_ROLES)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Xóa CCCD khỏi hồ sơ' })
  @ApiResponse({ status: 204, description: 'Đã xóa (hoặc khách chưa có CCCD)' })
  async removeNationalId(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseObjectIdPipe) id: string,
    @Headers(CLIENT_TYPE_HEADER) clientType?: string,
  ): Promise<void> {
    await this.nationalIds.remove(user, id, clientType);
  }

  @Post('national-id-views')
  @Roles(...CRM_ROLES)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary:
      'Xem CCCD đầy đủ (Quản trị, Quản lý trong phạm vi, Phụ trách chính); ghi audit; giới hạn 10 lần/phút/người',
  })
  @ApiDataResponse(NationalIdViewResponseDto, HttpStatus.CREATED)
  @ApiResponse({ status: 403, description: 'NATIONAL_ID_FORBIDDEN' })
  async viewNationalId(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: NationalIdViewDto,
    @Headers(CLIENT_TYPE_HEADER) clientType?: string,
  ) {
    return { data: await this.nationalIds.view(user, id, dto, clientType) };
  }

  @Get('national-id-views')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({
    summary: 'Nhật ký các lần xem CCCD của khách (Quản trị, Quản lý)',
  })
  @ApiPaginatedResponse(NationalIdViewEntryDto)
  listNationalIdViews(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseObjectIdPipe) id: string,
    @Query() query: ListNationalIdViewsQueryDto,
  ) {
    return this.nationalIds.listViews(user, id, query);
  }

  @Post('phone-views')
  @Roles(...CRM_ROLES)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary:
      'Xem/gọi/sao chép số đầy đủ: ghi audit PHONE_VIEWED (không lưu số); mọi thành viên trong phạm vi; 60 lần/phút/người',
  })
  @ApiDataResponse(PhoneViewResponseDto, HttpStatus.CREATED)
  async viewPhone(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: PhoneViewDto,
    @Headers(CLIENT_TYPE_HEADER) clientType?: string,
  ) {
    return { data: await this.phones.view(user, id, dto, clientType) };
  }
}
