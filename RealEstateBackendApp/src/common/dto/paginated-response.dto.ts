import { ApiProperty } from '@nestjs/swagger';

/** Metadata phân trang trả kèm mọi response danh sách */
export class PaginationMetaDto {
  @ApiProperty({ description: 'Tổng số bản ghi khớp filter', example: 137 })
  total: number;

  @ApiProperty({ description: 'Trang hiện tại', example: 1 })
  page: number;

  @ApiProperty({ description: 'Số bản ghi mỗi trang', example: 20 })
  limit: number;

  @ApiProperty({
    description: 'Tổng số trang, bằng 0 khi không có bản ghi',
    example: 7,
  })
  totalPages: number;
}

/**
 * Kết quả truy vấn ở tầng Service: chỉ gồm danh sách của trang hiện tại
 * và tổng số bản ghi khớp filter (đếm bằng countDocuments cùng query).
 */
export interface PaginatedResult<T> {
  data: T[];
  total: number;
}

/** Shape response chuẩn cho API danh sách: { data, meta } */
export class PaginatedResponseDto<T> {
  data: T[];
  meta: PaginationMetaDto;
}
