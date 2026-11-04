import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiDataResponse } from '../../../common/decorators/api-response.decorators';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import type { JwtPayload } from '../../../common/decorators/current-user.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import { UserRole } from '../../../common/enums/user-role.enum';
import { CrmFeatureGuard } from '../../../common/guards/crm-feature.guard';
import { CrmSettingsService } from './crm-settings.service';
import {
  CrmSettingsResponseDto,
  UpdateCrmSettingsDto,
} from './dtos/crm-settings.dto';
import { AdminOnly } from '../common/access/admin-only.decorator';

/** Cấu hình CRM (tài liệu 05 mục 2.14): Quản trị đọc/sửa, Quản lý chỉ đọc. */
@ApiTags('CRM - Settings')
@ApiBearerAuth()
@UseGuards(CrmFeatureGuard)
@Controller('crm/settings')
export class CrmSettingsController {
  constructor(private readonly settingsService: CrmSettingsService) {}

  @Get()
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Cấu hình nhắc việc và quy tắc CRM' })
  @ApiDataResponse(CrmSettingsResponseDto)
  async get() {
    return { data: await this.settingsService.get() };
  }

  @Patch()
  @AdminOnly()
  @ApiOperation({ summary: 'Sửa cấu hình CRM (chỉ field được gửi)' })
  @ApiDataResponse(CrmSettingsResponseDto)
  async update(
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpdateCrmSettingsDto,
  ) {
    return { data: await this.settingsService.update(user, dto) };
  }
}
