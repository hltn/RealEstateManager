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
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiExtraModels,
  ApiOperation,
  ApiResponse,
  ApiTags,
  getSchemaPath,
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
import { AdminOnly } from '../common/access/admin-only.decorator';
import {
  CreatePersonaFieldDto,
  ListPersonaFieldsQueryDto,
  PersonaFieldResponseDto,
  ReorderPersonaFieldsDto,
  UpdatePersonaFieldDto,
} from './dtos/persona-field.dto';
import { PersonaFieldsService } from './persona-fields.service';

/**
 * Cấu hình trường chân dung (tài liệu 05 mục 2.7, X10). Đọc: Quản trị/Quản lý/Nhân viên. Ghi: chỉ Quản trị.
 * Mọi thay đổi cấu hình giữ nguyên dữ liệu chân dung đã nhập của khách.
 */
@ApiTags('CRM - Persona fields')
@ApiBearerAuth()
@UseGuards(CrmFeatureGuard)
@Controller('crm/persona-fields')
export class PersonaFieldsController {
  constructor(private readonly fields: PersonaFieldsService) {}

  @Get()
  @Roles(...CRM_ROLES)
  @ApiOperation({ summary: 'Danh sách trường chân dung (render form, bộ lọc)' })
  @ApiPaginatedResponse(PersonaFieldResponseDto)
  list(@Query() query: ListPersonaFieldsQueryDto) {
    return this.fields.list(query);
  }

  @Post()
  @AdminOnly()
  @ApiOperation({ summary: 'Thêm trường chân dung (tính lại độ đầy đủ nền)' })
  @ApiDataResponse(PersonaFieldResponseDto, HttpStatus.CREATED)
  @ApiResponse({ status: 409, description: 'CATALOG_DUPLICATED (trùng key)' })
  async create(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreatePersonaFieldDto,
  ) {
    return { data: await this.fields.create(user, dto) };
  }

  /** Khai báo TRƯỚC `:id` để `order` không bị hiểu là id. */
  @Put('order')
  @AdminOnly()
  @ApiOperation({ summary: 'Sắp lại thứ tự trường (có thể chuyển nhóm)' })
  @ApiExtraModels(PersonaFieldResponseDto)
  @ApiResponse({
    status: 200,
    schema: {
      type: 'object',
      properties: {
        data: {
          type: 'array',
          items: { $ref: getSchemaPath(PersonaFieldResponseDto) },
        },
      },
    },
  })
  async reorder(
    @CurrentUser() user: JwtPayload,
    @Body() dto: ReorderPersonaFieldsDto,
  ) {
    return { data: await this.fields.reorder(user, dto) };
  }

  @Patch(':id')
  @AdminOnly()
  @ApiOperation({
    summary:
      'Sửa trường (nhãn, lựa chọn, trọng số, bật/tắt...); key bất biến, type khóa khi đã có dữ liệu',
  })
  @ApiDataResponse(PersonaFieldResponseDto)
  @ApiResponse({ status: 409, description: 'PERSONA_FIELD_TYPE_LOCKED' })
  async update(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: UpdatePersonaFieldDto,
  ) {
    return { data: await this.fields.update(user, id, dto) };
  }

  @Delete(':id')
  @AdminOnly()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary:
      'Bớt trường = xóa mềm, giữ nguyên dữ liệu khách; không áp dụng cho trường hệ thống',
  })
  @ApiResponse({ status: 204, description: 'Đã xóa mềm' })
  @ApiResponse({ status: 409, description: 'PERSONA_FIELD_SYSTEM' })
  remove(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseObjectIdPipe) id: string,
  ): Promise<void> {
    return this.fields.remove(user, id);
  }
}
