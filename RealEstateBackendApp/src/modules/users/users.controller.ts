import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { JwtPayload } from '../../common/decorators/current-user.decorator';
import { CrmFeatureGuard } from '../../common/guards/crm-feature.guard';
import { ParseObjectIdPipe } from '../../common/pipes/parse-object-id.pipe';
import { TeamsService } from '../teams/teams.service';
import { UsersService } from './users.service';
import { CreateUserDto } from './dtos/create-user.dto';
import { UpdateUserStatusDto } from './dtos/update-user-status.dto';
import { UpdateUserRoleDto } from './dtos/update-user-role.dto';
import { UpdateUserTeamDto } from './dtos/update-user-team.dto';
import { ListUsersQueryDto } from './dtos/list-users-query.dto';
import { AdminOnly } from '../crm/common/access/admin-only.decorator';

/**
 * UsersController — quản lý tài khoản (ADMIN only).
 * Rule "không block chính mình" chỉ áp dụng cho PATCH /users/:id/status,
 * KHÔNG áp dụng cho /role.
 */
@ApiTags('Users')
@Controller('users')
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly teamsService: TeamsService,
  ) {}

  @Get()
  @AdminOnly()
  @ApiOperation({
    summary:
      'List users (paginated, ADMIN only); lọc theo role, teamId, status, q',
  })
  findAll(@Query() query: ListUsersQueryDto) {
    const { page, limit, role, teamId, status, q } = query;
    return this.usersService.findAll(page, limit, { role, teamId, status, q });
  }

  @Post()
  @AdminOnly()
  @ApiOperation({ summary: 'Create a user (ADMIN only)' })
  create(@Body() dto: CreateUserDto) {
    return this.usersService.create(dto);
  }

  @Patch(':id/status')
  @AdminOnly()
  @ApiOperation({ summary: 'Update user status (block/unblock), ADMIN only' })
  updateStatus(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: UpdateUserStatusDto,
    @CurrentUser() currentUser: JwtPayload,
  ) {
    // Rule "không block chính mình": payload dùng `sub` (ObjectId string).
    // Doc 6.4/16.6 ban đầu ghi `currentUser._id` — đã sửa thành `sub` cho nhất
    // quán với JWT payload thực tế (xem mục 5.1).
    if (String(currentUser?.sub) === String(id)) {
      throw new ForbiddenException('Cannot block your own account');
    }
    return this.usersService.updateStatus(id, dto, currentUser);
  }

  @Patch(':id/role')
  @AdminOnly()
  @ApiOperation({ summary: 'Update user role (ADMIN only)' })
  updateRole(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: UpdateUserRoleDto,
    @CurrentUser() currentUser: JwtPayload,
  ) {
    return this.usersService.updateRole(id, dto, currentUser);
  }

  /** Gán/gỡ nhóm cho tài khoản (CRM). Nằm sau cổng FEATURE_CRM_ENABLED vì là endpoint mới của CRM. */
  @Patch(':id/team')
  @UseGuards(CrmFeatureGuard)
  @AdminOnly()
  @ApiOperation({
    summary:
      'Gán người dùng vào nhóm hoặc gỡ khỏi nhóm (teamId=null), ADMIN only',
  })
  async updateTeam(
    @CurrentUser() currentUser: JwtPayload,
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: UpdateUserTeamDto,
  ) {
    return {
      data: await this.teamsService.assignUserToTeam(
        currentUser,
        id,
        dto.teamId,
      ),
    };
  }
}
