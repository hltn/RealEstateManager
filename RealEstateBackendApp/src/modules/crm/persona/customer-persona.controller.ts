import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Patch,
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
import { CustomerPersonaService } from './customer-persona.service';
import {
  CustomerPersonaResponseDto,
  PersonaUpdateResponseDto,
  UpdatePersonaDto,
} from './dtos/customer-persona.dto';

const CLIENT_TYPE_HEADER = 'x-client-type';

/**
 * Chân dung của khách (tài liệu 05 mục 2.7). Quyền: Quản trị, Quản lý và Nhân viên trong phạm vi khách của mình;
 * khách ngoài phạm vi => 404 `CUSTOMER_NOT_FOUND`.
 */
@ApiTags('CRM - Customer persona')
@ApiBearerAuth()
@UseGuards(CrmFeatureGuard)
@Controller('crm/customers')
export class CustomerPersonaController {
  constructor(private readonly persona: CustomerPersonaService) {}

  @Get(':id/persona')
  @Roles(...CRM_ROLES)
  @ApiOperation({
    summary:
      'Chân dung theo nhóm trường + độ đầy đủ + gợi ý thông tin còn thiếu (chỉ trường đang hoạt động)',
  })
  @ApiDataResponse(CustomerPersonaResponseDto)
  async get(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseObjectIdPipe) id: string,
  ) {
    return { data: await this.persona.get(user, id) };
  }

  @Patch(':id/persona')
  @Roles(...CRM_ROLES)
  @ApiOperation({
    summary:
      'Cập nhật nhiều giá trị chân dung (value null = xóa); ghi người/ngày/nguồn từng giá trị, khóa lạc quan theo version',
  })
  @ApiDataResponse(PersonaUpdateResponseDto)
  @ApiResponse({
    status: 400,
    description: 'PERSONA_VALUE_INVALID | SENSITIVE_FIELD_CONSENT_REQUIRED',
  })
  @ApiResponse({ status: 409, description: 'VERSION_CONFLICT' })
  async update(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: UpdatePersonaDto,
    @Headers(CLIENT_TYPE_HEADER) clientType?: string,
  ) {
    return { data: await this.persona.update(user, id, dto, clientType) };
  }
}
