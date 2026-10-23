import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import {
  MAX_LIMIT,
  PaginationQueryDto,
} from '../../../../common/dto/pagination-query.dto';

/** Danh mục nhỏ mặc định trả tối đa 100 phần tử mỗi trang (tài liệu 05 mục 1.4). */
export const DEFAULT_CATALOG_LIMIT = 100;

/** Phân trang cho danh mục: giống `PaginationQueryDto` nhưng `limit` mặc định 100. */
export class CatalogPaginationQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description: `Số bản ghi mỗi trang (tối đa ${MAX_LIMIT})`,
    minimum: 1,
    maximum: MAX_LIMIT,
    default: DEFAULT_CATALOG_LIMIT,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'limit phải là số nguyên' })
  @Min(1, { message: 'limit tối thiểu là 1' })
  @Max(MAX_LIMIT, { message: `limit tối đa là ${MAX_LIMIT}` })
  limit?: number = DEFAULT_CATALOG_LIMIT;
}
