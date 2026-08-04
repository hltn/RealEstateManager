import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

import { ExternalRequestType } from '../schemas/external-request-log.schema';

/**
 * Filter + phân trang cho GET /api/v1/external-logs (§10.1 spec).
 * page/limit theo convention dự án: default 1/20, limit tối đa 100.
 */
export class QueryExternalLogDto {
  @ApiPropertyOptional({
    description: 'Loại log: CRAWL_OUTGOING | AI_OUTGOING',
    enum: ExternalRequestType,
  })
  @IsOptional()
  @IsEnum(ExternalRequestType)
  type?: ExternalRequestType;

  @ApiPropertyOptional({
    description:
      'Tìm chính xác tên trang báo / AI provider (VD: VnExpress, OpenRouter)',
  })
  @IsOptional()
  @IsString()
  targetService?: string;

  @ApiPropertyOptional({
    description: 'HTTP status code (VD: 403 anti-bot)',
    minimum: 100,
    maximum: 599,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(100)
  @Max(599)
  statusCode?: number;

  @ApiPropertyOptional({
    description: 'ISO 8601 — lọc createdAt >= startDate',
    example: '2026-08-01T00:00:00.000Z',
  })
  @IsOptional()
  @IsISO8601()
  startDate?: string;

  @ApiPropertyOptional({
    description: 'ISO 8601 — lọc createdAt <= endDate',
    example: '2026-08-03T23:59:59.999Z',
  })
  @IsOptional()
  @IsISO8601()
  endDate?: string;

  @ApiPropertyOptional({
    description: 'Trang hiện tại, bắt đầu từ 1',
    minimum: 1,
    default: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({
    description: 'Số bản ghi mỗi trang (tối đa 100)',
    minimum: 1,
    maximum: 100,
    default: 20,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({
    description: "Sort theo createdAt: 'newest' (default) | 'oldest'",
    enum: ['newest', 'oldest'],
    default: 'newest',
  })
  @IsOptional()
  @IsIn(['newest', 'oldest'])
  sort?: 'newest' | 'oldest';
}
