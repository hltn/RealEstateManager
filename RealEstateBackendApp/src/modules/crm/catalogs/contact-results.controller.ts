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
  toContactResultResponse,
} from './catalog-items.service';
import {
  ContactResultResponseDto,
  CreateContactResultDto,
  ListContactResultsQueryDto,
  UpdateContactResultDto,
} from './dtos/catalog-item.dto';
import { AdminOnly } from '../common/access/admin-only.decorator';

/** Kết quả liên hệ + gợi ý mốc hẹn (tài liệu 05 mục 2.8). Đọc: A/M/S. Ghi: Quản trị. */
@ApiTags('CRM - Contact results')
@ApiBearerAuth()
@UseGuards(CrmFeatureGuard)
@Controller('crm/contact-results')
export class ContactResultsController {
  constructor(private readonly itemsService: CatalogItemsService) {}

  @Get()
  @Roles(...CRM_ROLES)
  @ApiOperation({ summary: 'Danh sách kết quả liên hệ kèm gợi ý mốc hẹn' })
  @ApiPaginatedResponse(ContactResultResponseDto)
  async list(@Query() query: ListContactResultsQueryDto) {
    const result = await this.itemsService.list(
      CatalogItemType.CONTACT_RESULT,
      query,
    );
    return {
      data: result.data.map(toContactResultResponse),
      meta: result.meta,
    };
  }

  @Post()
  @AdminOnly()
  @ApiOperation({ summary: 'Thêm kết quả liên hệ' })
  @ApiDataResponse(ContactResultResponseDto, HttpStatus.CREATED)
  @ApiResponse({ status: 409, description: 'CATALOG_DUPLICATED' })
  async create(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateContactResultDto,
  ) {
    const created = await this.itemsService.create(
      CatalogItemType.CONTACT_RESULT,
      user,
      dto,
    );
    return { data: toContactResultResponse(created) };
  }

  @Patch(':id')
  @AdminOnly()
  @ApiOperation({ summary: 'Sửa kết quả liên hệ (không đổi mã)' })
  @ApiDataResponse(ContactResultResponseDto)
  async update(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: UpdateContactResultDto,
  ) {
    const updated = await this.itemsService.update(
      CatalogItemType.CONTACT_RESULT,
      user,
      id,
      dto,
    );
    return { data: toContactResultResponse(updated) };
  }

  @Delete(':id')
  @AdminOnly()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Xóa mềm kết quả liên hệ (chặn khi nhật ký đang dùng)',
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
    return this.itemsService.remove(CatalogItemType.CONTACT_RESULT, user, id);
  }
}
