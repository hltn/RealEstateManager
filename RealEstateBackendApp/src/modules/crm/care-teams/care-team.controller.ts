import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { ApiDataResponse } from '../../../common/decorators/api-response.decorators';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import type { JwtPayload } from '../../../common/decorators/current-user.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import { CRM_ROLES } from '../../../common/enums/user-role.enum';
import { CrmFeatureGuard } from '../../../common/guards/crm-feature.guard';
import { ParseObjectIdPipe } from '../../../common/pipes/parse-object-id.pipe';
import { CareTeamService } from './care-team.service';
import {
  AddCareTeamMembersDto,
  CareTeamResponseDto,
} from './dtos/care-team.dto';

const CLIENT_TYPE_HEADER = 'x-client-type';

/**
 * Nhóm chăm sóc của một khách (tài liệu 05 mục 2.5). Quyền chi tiết (Quản trị / Quản lý trong phạm vi / phụ trách
 * chính) do service kiểm theo nhóm hiện tại; khách ngoài phạm vi (hoặc người vừa bị gỡ) => 404 `CUSTOMER_NOT_FOUND`.
 */
@ApiTags('CRM - Care team')
@ApiBearerAuth()
@UseGuards(CrmFeatureGuard)
@Controller('crm/customers/:id/care-team')
export class CareTeamController {
  constructor(private readonly careTeam: CareTeamService) {}

  @Get()
  @Roles(...CRM_ROLES)
  @ApiOperation({ summary: 'Nhóm chăm sóc hiện tại của khách' })
  @ApiDataResponse(CareTeamResponseDto)
  async get(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseObjectIdPipe) id: string,
  ) {
    return { data: await this.careTeam.get(user, id) };
  }

  @Post('members')
  @Roles(...CRM_ROLES)
  @ApiOperation({
    summary:
      'Mời thành viên phụ (Quản trị, Quản lý trong phạm vi, phụ trách chính); người được mời ACTIVE, vai trò Quản lý/Nhân viên, KHÔNG giới hạn theo nhóm; tối đa 10 thành viên phụ mỗi khách; rate-limit 30 lượt/phút/người; primaryUserId chỉ nhận khi nhóm rỗng và người gọi là Quản trị/Quản lý',
  })
  @ApiDataResponse(CareTeamResponseDto, HttpStatus.CREATED)
  @ApiResponse({
    status: 400,
    description:
      'PRIMARY_REQUIRED | USER_NOT_ASSIGNABLE | VALIDATION_FAILED (primaryUserId khi nhóm đã có người)',
  })
  @ApiResponse({ status: 403, description: 'CARE_TEAM_ACTION_FORBIDDEN' })
  @ApiResponse({
    status: 409,
    description:
      'ALREADY_IN_CARE_TEAM | CARE_TEAM_LIMIT_EXCEEDED (quá 10 thành viên phụ) | VERSION_CONFLICT',
  })
  @ApiResponse({
    status: 429,
    description: 'RATE_LIMITED (CARE_TEAM_INVITE: 30 lượt/phút/người)',
  })
  async addMembers(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: AddCareTeamMembersDto,
    @Headers(CLIENT_TYPE_HEADER) clientType?: string,
  ) {
    return {
      data: await this.careTeam.addMembers(user, id, dto, clientType),
    };
  }

  @Delete('members/:userId')
  @Roles(...CRM_ROLES)
  @ApiOperation({
    summary:
      'Gỡ thành viên phụ; phụ trách chính bị khóa nên gỡ PRIMARY là 409 PRIMARY_LOCKED',
  })
  @ApiDataResponse(CareTeamResponseDto)
  @ApiResponse({ status: 403, description: 'CARE_TEAM_ACTION_FORBIDDEN' })
  @ApiResponse({ status: 409, description: 'PRIMARY_LOCKED' })
  async removeMember(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseObjectIdPipe) id: string,
    @Param('userId', ParseObjectIdPipe) userId: string,
    @Headers(CLIENT_TYPE_HEADER) clientType?: string,
  ) {
    return {
      data: await this.careTeam.removeMember(user, id, userId, clientType),
    };
  }
}
