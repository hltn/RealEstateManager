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
} from '../../common/decorators/api-response.decorators';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { JwtPayload } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../common/enums/user-role.enum';
import { CrmFeatureGuard } from '../../common/guards/crm-feature.guard';
import { ParseObjectIdPipe } from '../../common/pipes/parse-object-id.pipe';
import {
  AddTeamMemberDto,
  CreateTeamDto,
  ListTeamMembersQueryDto,
  ListTeamsQueryDto,
  TeamMemberResponseDto,
  TeamResponseDto,
  UpdateTeamDto,
} from './dtos/team.dto';
import { TeamMembersService } from './team-members.service';
import { TeamsService } from './teams.service';
import { AdminOnly } from '../crm/common/access/admin-only.decorator';

/** Nhóm làm việc (tài liệu 05 mục 2.2). Đọc: Quản trị + Quản lý (nhóm mình). Ghi: Quản trị. */
@ApiTags('Teams')
@ApiBearerAuth()
@UseGuards(CrmFeatureGuard)
@Controller('teams')
export class TeamsController {
  constructor(
    private readonly teamsService: TeamsService,
    private readonly teamMembersService: TeamMembersService,
  ) {}

  @Get()
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({
    summary:
      'Danh sách nhóm (Quản trị: tất cả; Quản lý: nhóm mình quản lý/thuộc về)',
  })
  @ApiPaginatedResponse(TeamResponseDto)
  list(@CurrentUser() user: JwtPayload, @Query() query: ListTeamsQueryDto) {
    return this.teamsService.list(user, query);
  }

  @Post()
  @AdminOnly()
  @ApiOperation({ summary: 'Tạo nhóm (Quản trị)' })
  @ApiDataResponse(TeamResponseDto, HttpStatus.CREATED)
  @ApiResponse({ status: 409, description: 'TEAM_CODE_DUPLICATED' })
  async create(@CurrentUser() user: JwtPayload, @Body() dto: CreateTeamDto) {
    return { data: await this.teamsService.create(user, dto) };
  }

  @Patch(':id')
  @AdminOnly()
  @ApiOperation({
    summary: 'Sửa nhóm, đổi Quản lý, bật/tắt hoạt động (Quản trị)',
  })
  @ApiDataResponse(TeamResponseDto)
  async update(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: UpdateTeamDto,
  ) {
    return { data: await this.teamsService.update(user, id, dto) };
  }

  @Delete(':id')
  @AdminOnly()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Xóa mềm nhóm, chỉ khi không còn thành viên (Quản trị)',
  })
  @ApiResponse({ status: 204, description: 'Đã xóa mềm' })
  @ApiResponse({ status: 409, description: 'TEAM_NOT_EMPTY' })
  remove(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseObjectIdPipe) id: string,
  ): Promise<void> {
    return this.teamsService.remove(user, id);
  }

  @Get(':id/members')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({
    summary:
      'Danh sách thành viên của nhóm (Quản trị: mọi nhóm; Quản lý: chỉ nhóm mình quản lý)',
  })
  @ApiPaginatedResponse(TeamMemberResponseDto)
  @ApiResponse({ status: 403, description: 'Quản lý không quản lý nhóm này' })
  @ApiResponse({ status: 404, description: 'Không tìm thấy nhóm' })
  listMembers(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseObjectIdPipe) id: string,
    @Query() query: ListTeamMembersQueryDto,
  ) {
    return this.teamMembersService.list(user, id, query);
  }

  @Post(':id/members')
  @AdminOnly()
  @ApiOperation({
    summary:
      'Thêm thành viên vào nhóm (Quản trị); idempotent, đồng bộ teamIds/teamId và customers.teamIds',
  })
  @ApiDataResponse(TeamMemberResponseDto, HttpStatus.CREATED)
  @ApiResponse({
    status: 400,
    description: 'VALIDATION_FAILED: người dùng không có role MANAGER/STAFF',
  })
  @ApiResponse({
    status: 404,
    description: 'Nhóm (không tồn tại/đã tắt) hoặc người dùng không tồn tại',
  })
  async addMember(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: AddTeamMemberDto,
  ) {
    return { data: await this.teamMembersService.add(user, id, dto.userId) };
  }

  @Delete(':id/members/:userId')
  @AdminOnly()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary:
      'Gỡ thành viên khỏi nhóm (Quản trị); idempotent, không gỡ quyền Quản lý của nhóm',
  })
  @ApiResponse({
    status: 204,
    description: 'Đã gỡ (hoặc vốn không thuộc nhóm)',
  })
  @ApiResponse({
    status: 404,
    description: 'Không tìm thấy nhóm hoặc người dùng',
  })
  removeMember(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseObjectIdPipe) id: string,
    @Param('userId', ParseObjectIdPipe) userId: string,
  ): Promise<void> {
    return this.teamMembersService.remove(user, id, userId);
  }
}
