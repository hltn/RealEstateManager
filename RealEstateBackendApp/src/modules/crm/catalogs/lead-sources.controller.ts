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
import { CatalogItemType } from './catalog.enums';
import {
  CatalogItemsService,
  toLeadSourceResponse,
} from './catalog-items.service';
import {
  CreateLeadSourceDto,
  LeadSourceResponseDto,
  ListLeadSourcesQueryDto,
  UpdateLeadSourceDto,
} from './dtos/catalog-item.dto';
import { AdminOnly } from '../common/access/admin-only.decorator';

/** Nguồn khách (tài liệu 05 mục 2.8). Đọc: A/M/S. Ghi: Quản trị. */
@ApiTags('CRM - Lead sources')
@ApiBearerAuth()
@UseGuards(CrmFeatureGuard)
@Controller('crm/lead-sources')
export class LeadSourcesController {
  constructor(private readonly itemsService: CatalogItemsService) {}

  @Get()
  @Roles(...CRM_ROLES)
  @ApiOperation({ summary: 'Danh sách nguồn khách' })
  @ApiPaginatedResponse(LeadSourceResponseDto)
  async list(@Query() query: ListLeadSourcesQueryDto) {
    const result = await this.itemsService.list(
      CatalogItemType.LEAD_SOURCE,
      query,
    );
    return { data: result.data.map(toLeadSourceResponse), meta: result.meta };
  }

  @Post()
  @AdminOnly()
  @ApiOperation({ summary: 'Thêm nguồn khách' })
  @ApiDataResponse(LeadSourceResponseDto, HttpStatus.CREATED)
  @ApiResponse({ status: 409, description: 'CATALOG_DUPLICATED' })
  async create(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateLeadSourceDto,
  ) {
    const created = await this.itemsService.create(
      CatalogItemType.LEAD_SOURCE,
      user,
      dto,
    );
    return { data: toLeadSourceResponse(created) };
  }

  @Patch(':id')
  @AdminOnly()
  @ApiOperation({ summary: 'Sửa nguồn khách (nhãn, thứ tự, hoạt động)' })
  @ApiDataResponse(LeadSourceResponseDto)
  async update(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: UpdateLeadSourceDto,
  ) {
    const updated = await this.itemsService.update(
      CatalogItemType.LEAD_SOURCE,
      user,
      id,
      dto,
    );
    return { data: toLeadSourceResponse(updated) };
  }

  @Delete(':id')
  @AdminOnly()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Xóa mềm nguồn khách (chặn khi đang có khách dùng)',
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
    return this.itemsService.remove(CatalogItemType.LEAD_SOURCE, user, id);
  }
}
