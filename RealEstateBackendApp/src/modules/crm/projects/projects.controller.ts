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
import {
  CreateProjectDto,
  ListProjectsQueryDto,
  ProjectDetailResponseDto,
  ProjectResponseDto,
  RestoreProjectDto,
  UpdateProjectDto,
} from './dtos/project.dto';
import { ProjectsService } from './projects.service';
import { AdminOnly } from '../common/access/admin-only.decorator';

/** Dự án (tài liệu 05 mục 2.8). Đọc: A/M/S. Thêm/sửa/ngừng hoạt động/xóa mềm/khôi phục: chỉ Quản trị. */
@ApiTags('CRM - Projects')
@ApiBearerAuth()
@UseGuards(CrmFeatureGuard)
@Controller('crm')
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  @Get('projects')
  @Roles(...CRM_ROLES)
  @ApiOperation({
    summary: 'Danh sách dự án (isDeleted=true chỉ dành cho Quản trị)',
  })
  @ApiPaginatedResponse(ProjectResponseDto)
  list(@CurrentUser() user: JwtPayload, @Query() query: ListProjectsQueryDto) {
    return this.projectsService.list(user, query);
  }

  @Get('projects/:id')
  @Roles(...CRM_ROLES)
  @ApiOperation({ summary: 'Chi tiết dự án' })
  @ApiDataResponse(ProjectDetailResponseDto)
  async getById(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseObjectIdPipe) id: string,
  ) {
    return { data: await this.projectsService.getById(user, id) };
  }

  @Post('projects')
  @AdminOnly()
  @ApiOperation({
    summary:
      'Thêm dự án (mã bắt buộc, duy nhất không phân biệt hoa thường kể cả dự án đã xóa)',
  })
  @ApiDataResponse(ProjectDetailResponseDto, HttpStatus.CREATED)
  @ApiResponse({ status: 409, description: 'PROJECT_CODE_DUPLICATED' })
  async create(@CurrentUser() user: JwtPayload, @Body() dto: CreateProjectDto) {
    return { data: await this.projectsService.create(user, dto) };
  }

  @Patch('projects/:id')
  @AdminOnly()
  @ApiOperation({ summary: 'Sửa dự án; isActive=false = ngừng hoạt động' })
  @ApiDataResponse(ProjectDetailResponseDto)
  @ApiResponse({ status: 409, description: 'PROJECT_CODE_DUPLICATED' })
  async update(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: UpdateProjectDto,
  ) {
    return { data: await this.projectsService.update(user, id, dto) };
  }

  @Delete('projects/:id')
  @AdminOnly()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary:
      'Xóa mềm dự án, chỉ khi không còn khách tham chiếu (còn khách: dùng PATCH isActive=false)',
  })
  @ApiResponse({ status: 204, description: 'Đã xóa mềm' })
  @ApiResponse({ status: 409, description: 'PROJECT_IN_USE { customerCount }' })
  remove(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseObjectIdPipe) id: string,
  ): Promise<void> {
    return this.projectsService.remove(user, id);
  }

  @Post('project-restorations')
  @AdminOnly()
  @ApiOperation({ summary: 'Khôi phục dự án đã xóa mềm' })
  @ApiDataResponse(ProjectDetailResponseDto, HttpStatus.CREATED)
  @ApiResponse({
    status: 404,
    description: 'RESOURCE_NOT_FOUND khi dự án không tồn tại hoặc chưa bị xóa',
  })
  async restore(
    @CurrentUser() user: JwtPayload,
    @Body() dto: RestoreProjectDto,
  ) {
    return { data: await this.projectsService.restore(user, dto) };
  }
}
