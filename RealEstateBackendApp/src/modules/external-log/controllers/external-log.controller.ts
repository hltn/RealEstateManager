import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';

import { Roles } from '../../../common/decorators/roles.decorator';
import { UserRole } from '../../../common/enums/user-role.enum';
import {
  buildPaginationMeta,
  normalizePagination,
} from '../../../common/utils/pagination.util';
import { QueryExternalLogDto } from '../dtos/query-external-log.dto';
import { ExternalLogService } from '../services/external-log.service';

/**
 * Admin Query API (§10 spec) — chỉ phục vụ Admin.
 * Route đầy đủ (global prefix api/v1): GET /api/v1/external-logs, GET /api/v1/external-logs/:id.
 * Auth: được bảo vệ bởi global APP_GUARD (JwtAuthGuard + RolesGuard) như mọi controller khác.
 */
@ApiTags('External Logs')
@Controller('external-logs')
@Roles(UserRole.ADMIN)
export class ExternalLogController {
  constructor(private readonly externalLogService: ExternalLogService) {}

  @Get()
  @ApiOperation({
    summary: 'Query external request logs (crawl + AI)',
    description:
      'Danh sách log outgoing request có filter + phân trang. Response: { data, meta: { total, page, limit, totalPages } }',
  })
  async findAll(@Query() query: QueryExternalLogDto): Promise<{
    data: unknown[];
    meta: ReturnType<typeof buildPaginationMeta>;
  }> {
    const { data, total } = await this.externalLogService.findAll(query);
    // Chuẩn hóa page/limit để meta trả về luôn khớp với tham số thực dùng cho skip/limit.
    const { page, limit } = normalizePagination(query.page, query.limit);
    return { data, meta: buildPaginationMeta(total, page, limit) };
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get external log by ID',
    description:
      'Trả document đầy đủ (kể cả error.stack, response.body) — dữ liệu đã sanitize lúc ghi nên an toàn để hiển thị. Id sai → 400, không tìm thấy → 404.',
  })
  @ApiParam({ name: 'id', required: true, description: 'MongoDB ObjectId' })
  async findById(@Param('id') id: string): Promise<unknown> {
    return this.externalLogService.findById(id);
  }
}
