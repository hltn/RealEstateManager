import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiHeader,
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
import { IdempotencyService } from '../../../common/services/idempotency.service';
import { runCrmIdempotent } from '../common/idempotency.helper';
import { BulkOperationsService } from './bulk-operations.service';
import {
  BulkOperationDto,
  BulkOperationResponseDto,
} from './dtos/bulk-operation.dto';

const CLIENT_TYPE_HEADER = 'x-client-type';

/** Thao tác hàng loạt trên khách (tài liệu 05 mục 2.3). */
@ApiTags('CRM - Customer bulk operations')
@ApiBearerAuth()
@UseGuards(CrmFeatureGuard)
@Controller('crm/customer-bulk-operations')
export class BulkOperationsController {
  constructor(
    private readonly bulk: BulkOperationsService,
    private readonly idempotency: IdempotencyService,
  ) {}

  @Post()
  @Roles(...CRM_ROLES)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Thao tác hàng loạt (≤ 200 khách, đồng bộ, mỗi khách một transaction): CHANGE_STATUS, ASSIGN (Quản trị/Quản lý). Giới hạn 10 lần/phút/người. Hỗ trợ X-Idempotency-Key',
  })
  @ApiHeader({ name: 'X-Idempotency-Key', required: false })
  @ApiDataResponse(BulkOperationResponseDto)
  @ApiResponse({ status: 400, description: 'VALIDATION_FAILED' })
  @ApiResponse({ status: 403, description: 'INSUFFICIENT_ROLE (ASSIGN)' })
  @ApiResponse({ status: 429, description: 'RATE_LIMITED' })
  run(
    @CurrentUser() user: JwtPayload,
    @Body() dto: BulkOperationDto,
    @Headers('x-idempotency-key') idempotencyKey?: string,
    @Headers(CLIENT_TYPE_HEADER) clientType?: string,
  ) {
    return runCrmIdempotent(
      this.idempotency,
      user.sub,
      'POST /crm/customer-bulk-operations',
      idempotencyKey,
      async () => ({ data: await this.bulk.run(user, dto, clientType) }),
    );
  }
}
