import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

/** Giá trị mặc định / giới hạn dùng chung cho mọi API trả danh sách */
export const DEFAULT_PAGE = 1;
export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 100;

/**
 * DTO phân trang dùng chung. Các endpoint có filter riêng thì extend class này
 * và bổ sung field, không tự khai báo lại page/limit.
 */
export class PaginationQueryDto {
  @ApiPropertyOptional({
    description: 'Trang hiện tại, bắt đầu từ 1',
    minimum: 1,
    default: DEFAULT_PAGE,
    example: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'page phải là số nguyên' })
  @Min(1, { message: 'page tối thiểu là 1' })
  page?: number = DEFAULT_PAGE;

  @ApiPropertyOptional({
    description: `Số bản ghi mỗi trang (tối đa ${MAX_LIMIT})`,
    minimum: 1,
    maximum: MAX_LIMIT,
    default: DEFAULT_LIMIT,
    example: 20,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'limit phải là số nguyên' })
  @Min(1, { message: 'limit tối thiểu là 1' })
  @Max(MAX_LIMIT, { message: `limit tối đa là ${MAX_LIMIT}` })
  limit?: number = DEFAULT_LIMIT;
}
