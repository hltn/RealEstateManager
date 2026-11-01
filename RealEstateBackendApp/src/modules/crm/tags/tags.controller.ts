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
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
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
  CreateTagDto,
  ListTagsQueryDto,
  TagResponseDto,
  UpdateTagDto,
} from './dtos/tag.dto';
import { TagsService } from './tags.service';

/**
 * Thẻ sở thích/nghề nghiệp (tài liệu 05 mục 2.7, C11). Đọc và tạo: Quản trị/Quản lý/Nhân viên. Sửa, gộp, xóa: Quản trị.
 */
@ApiTags('CRM - Tags')
@ApiBearerAuth()
@UseGuards(CrmFeatureGuard)
@Controller('crm/tags')
export class TagsController {
  constructor(private readonly tags: TagsService) {}

  @Get()
  @Roles(...CRM_ROLES)
  @ApiOperation({ summary: 'Danh sách / gợi ý thẻ khi gõ' })
  @ApiPaginatedResponse(TagResponseDto)
  list(@Query() query: ListTagsQueryDto) {
    return this.tags.list(query);
  }

  @Post()
  @Roles(...CRM_ROLES)
  @ApiOperation({
    summary:
      'Tạo thẻ (giới hạn 30 lần/phút/người); trùng tên đã chuẩn hóa trong cùng nhóm thì trả thẻ có sẵn với 200',
  })
  @ApiDataResponse(TagResponseDto, HttpStatus.CREATED)
  @ApiResponse({ status: 200, description: 'Thẻ đã tồn tại (trả thẻ có sẵn)' })
  @ApiResponse({ status: 429, description: 'RATE_LIMITED' })
  async create(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateTagDto,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const { tag, created } = await this.tags.create(user, dto);
    void reply.status(created ? HttpStatus.CREATED : HttpStatus.OK);
    return { data: tag };
  }

  @Patch(':id')
  @AdminOnly()
  @ApiOperation({
    summary:
      'Sửa tên/nhóm/màu của thẻ, hoặc gộp vào thẻ khác (mergeIntoId; trả thẻ đích)',
  })
  @ApiDataResponse(TagResponseDto)
  @ApiResponse({ status: 409, description: 'CATALOG_DUPLICATED' })
  async update(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: UpdateTagDto,
  ) {
    return { data: await this.tags.update(user, id, dto) };
  }

  @Delete(':id')
  @AdminOnly()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Xóa mềm thẻ và gỡ khỏi mọi khách' })
  @ApiResponse({ status: 204, description: 'Đã xóa mềm' })
  remove(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseObjectIdPipe) id: string,
  ): Promise<void> {
    return this.tags.remove(user, id);
  }
}
