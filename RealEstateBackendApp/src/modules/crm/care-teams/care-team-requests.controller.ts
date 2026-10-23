import {
  Body,
  Controller,
  Get,
  Headers,
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
import { CRM_ROLES, UserRole } from '../../../common/enums/user-role.enum';
import { CrmFeatureGuard } from '../../../common/guards/crm-feature.guard';
import { ParseObjectIdPipe } from '../../../common/pipes/parse-object-id.pipe';
import { CareTeamRequestsService } from './care-team-requests.service';
import {
  CareTeamRequestItemDto,
  CreateCareTeamRequestDto,
  CreateCareTeamRequestResponseDto,
  ListCareTeamRequestsQueryDto,
  ResolveCareTeamRequestDto,
} from './dtos/care-team.dto';

const CLIENT_TYPE_HEADER = 'x-client-type';

/** Đề nghị tham gia nhóm chăm sóc (tài liệu 05 mục 2.5). */
@ApiTags('CRM - Care team requests')
@ApiBearerAuth()
@UseGuards(CrmFeatureGuard)
@Controller('crm/care-team-requests')
export class CareTeamRequestsController {
  constructor(private readonly requests: CareTeamRequestsService) {}

  @Post()
  @Roles(UserRole.MANAGER, UserRole.STAFF)
  @ApiOperation({
    summary:
      'Đề nghị tham gia nhóm chăm sóc khách đã có (customerRef từ phone-lookups); giới hạn 20 lần/phút/người',
  })
  @ApiDataResponse(CreateCareTeamRequestResponseDto, HttpStatus.CREATED)
  @ApiResponse({
    status: 409,
    description: 'JOIN_REQUEST_EXISTS | ALREADY_IN_CARE_TEAM',
  })
  @ApiResponse({ status: 429, description: 'RATE_LIMITED' })
  async create(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateCareTeamRequestDto,
    @Headers(CLIENT_TYPE_HEADER) clientType?: string,
  ) {
    return { data: await this.requests.create(user, dto, clientType) };
  }

  @Get()
  @Roles(...CRM_ROLES)
  @ApiOperation({
    summary:
      'Danh sách đề nghị: box=mine (mình gửi) hoặc box=to-review (mình có quyền duyệt)',
  })
  @ApiPaginatedResponse(CareTeamRequestItemDto)
  list(
    @CurrentUser() user: JwtPayload,
    @Query() query: ListCareTeamRequestsQueryDto,
  ) {
    return this.requests.list(user, query);
  }

  @Patch(':id')
  @Roles(...CRM_ROLES)
  @ApiOperation({
    summary:
      'Duyệt/từ chối (người duyệt) hoặc hủy (người gửi). Duyệt => thêm người gửi làm MEMBER',
  })
  @ApiDataResponse(CareTeamRequestItemDto)
  @ApiResponse({ status: 409, description: 'JOIN_REQUEST_RESOLVED' })
  async resolve(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: ResolveCareTeamRequestDto,
    @Headers(CLIENT_TYPE_HEADER) clientType?: string,
  ) {
    return { data: await this.requests.resolve(user, id, dto, clientType) };
  }
}
