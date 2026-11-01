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
import { AreasService } from './areas.service';
import {
  AreaResponseDto,
  CreateAreaDto,
  ListAreasQueryDto,
  UpdateAreaDto,
} from './dtos/area.dto';
import { AdminOnly } from '../common/access/admin-only.decorator';

/** Khu vực dạng cây (tài liệu 05 mục 2.8). Đọc: A/M/S. Ghi: Quản trị. */
@ApiTags('CRM - Areas')
@ApiBearerAuth()
@UseGuards(CrmFeatureGuard)
@Controller('crm/areas')
export class AreasController {
  constructor(private readonly areasService: AreasService) {}

  @Get()
  @Roles(...CRM_ROLES)
  @ApiOperation({
    summary: 'Danh sách khu vực (phẳng hoặc theo cha), kèm đường dẫn tổ tiên',
  })
  @ApiPaginatedResponse(AreaResponseDto)
  list(@Query() query: ListAreasQueryDto) {
    return this.areasService.list(query);
  }

  @Post()
  @AdminOnly()
  @ApiOperation({ summary: 'Thêm khu vực' })
  @ApiDataResponse(AreaResponseDto, HttpStatus.CREATED)
  @ApiResponse({
    status: 409,
    description: 'CATALOG_DUPLICATED (trùng tên trong cùng khu vực cha)',
  })
  async create(@CurrentUser() user: JwtPayload, @Body() dto: CreateAreaDto) {
    return { data: await this.areasService.create(user, dto) };
  }

  @Patch(':id')
  @AdminOnly()
  @ApiOperation({
    summary:
      'Sửa khu vực / chuyển khu vực cha (cập nhật tổ tiên của cả nhánh con)',
  })
  @ApiDataResponse(AreaResponseDto)
  async update(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: UpdateAreaDto,
  ) {
    return { data: await this.areasService.update(user, id, dto) };
  }

  @Delete(':id')
  @AdminOnly()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Xóa mềm khu vực (chặn khi còn khu vực con hoặc đang được dùng)',
  })
  @ApiResponse({ status: 204, description: 'Đã xóa mềm' })
  @ApiResponse({ status: 409, description: 'CATALOG_IN_USE' })
  remove(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseObjectIdPipe) id: string,
  ): Promise<void> {
    return this.areasService.remove(user, id);
  }
}
