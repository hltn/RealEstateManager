import {
  Body,
  Controller,
  Delete,
  Get,
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
import { CustomerStatusesService } from './customer-statuses.service';
import {
  CreateCustomerStatusDto,
  CustomerStatusResponseDto,
  ListCustomerStatusesQueryDto,
  UpdateCustomerStatusDto,
} from './dtos/customer-status.dto';
import { AdminOnly } from '../common/access/admin-only.decorator';

/** Tình trạng khách (tài liệu 05 mục 2.8). Đọc: Quản trị/Quản lý/Nhân viên. Ghi: Quản trị. */
@ApiTags('CRM - Customer statuses')
@ApiBearerAuth()
@UseGuards(CrmFeatureGuard)
@Controller('crm/customer-statuses')
export class CustomerStatusesController {
  constructor(private readonly statusesService: CustomerStatusesService) {}

  @Get()
  @Roles(...CRM_ROLES)
  @ApiOperation({
    summary: 'Danh sách tình trạng khách (lọc theo nhóm danh sách, trạng thái)',
  })
  @ApiPaginatedResponse(CustomerStatusResponseDto)
  list(@Query() query: ListCustomerStatusesQueryDto) {
    return this.statusesService.list(query);
  }

  @Post()
  @AdminOnly()
  @ApiOperation({
    summary: 'Thêm tình trạng khách (bắt buộc chọn nhóm danh sách)',
  })
  @ApiDataResponse(CustomerStatusResponseDto, HttpStatus.CREATED)
  @ApiResponse({ status: 409, description: 'CATALOG_DUPLICATED' })
  async create(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateCustomerStatusDto,
  ) {
    return { data: await this.statusesService.create(user, dto) };
  }

  @Patch(':id')
  @AdminOnly()
  @ApiOperation({
    summary: 'Sửa nhãn/màu/thứ tự/nhóm/mặc định/hoạt động của tình trạng',
  })
  @ApiDataResponse(CustomerStatusResponseDto)
  @ApiResponse({
    status: 409,
    description: 'CATALOG_SYSTEM khi đổi nhóm của tình trạng hệ thống',
  })
  async update(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: UpdateCustomerStatusDto,
  ) {
    return { data: await this.statusesService.update(user, id, dto) };
  }

  @Delete(':id')
  @AdminOnly()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Xóa mềm tình trạng (chặn hệ thống/mặc định/đang có khách)',
  })
  @ApiResponse({ status: 204, description: 'Đã xóa mềm' })
  @ApiResponse({
    status: 409,
    description: 'CATALOG_SYSTEM hoặc CATALOG_IN_USE',
  })
  remove(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseObjectIdPipe) id: string,
  ): Promise<void> {
    return this.statusesService.remove(user, id);
  }
}
