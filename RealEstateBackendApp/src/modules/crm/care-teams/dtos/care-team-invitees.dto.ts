import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsMongoId,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Trim } from '../../../../common/decorators/trim.decorator';
import { PaginationQueryDto } from '../../../../common/dto/pagination-query.dto';

/** Độ dài tối đa của từ khóa `q` (FR-14). */
export const INVITEE_SEARCH_MAX_LENGTH = 50;
/** Số người tối đa mỗi trang (FR-14). */
export const INVITEE_MAX_LIMIT = 20;

/** Query `GET /crm/care-team-invitees` (Architecture mục 4). */
export class ListCareTeamInviteesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description:
      'Khách cần mời thêm người: kết quả loại người đã trong nhóm chăm sóc của khách này; người gọi phải là Quản trị/Quản lý hoặc phụ trách chính. Bỏ trống (thao tác hàng loạt): chỉ Quản trị/Quản lý',
    example: '66f1a2b3c4d5e6f708192a3b',
  })
  @IsOptional()
  @IsMongoId()
  customerId?: string;

  @ApiPropertyOptional({
    description: 'Tìm theo tên hiển thị (không phân biệt hoa/thường)',
    maxLength: INVITEE_SEARCH_MAX_LENGTH,
  })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(INVITEE_SEARCH_MAX_LENGTH)
  q?: string;

  @ApiPropertyOptional({
    description: `Số bản ghi mỗi trang (tối đa ${INVITEE_MAX_LIMIT})`,
    minimum: 1,
    maximum: INVITEE_MAX_LIMIT,
    default: 20,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'limit phải là số nguyên' })
  @Min(1, { message: 'limit tối thiểu là 1' })
  @Max(INVITEE_MAX_LIMIT, {
    message: `limit tối đa là ${INVITEE_MAX_LIMIT}`,
  })
  limit?: number = 20;
}

/** Người có thể được mời: chỉ id, tên hiển thị và tên nhóm (không email/SĐT/CCCD/vai trò/id nhóm, FR-14). */
export class CareTeamInviteeResponseDto {
  @ApiProperty({ example: '66f1a2b3c4d5e6f708192a3b' })
  id: string;

  @ApiProperty({ example: 'Hạnh' })
  displayName: string;

  @ApiProperty({
    type: [String],
    example: ['Nhóm Quận 1'],
    description: 'Tên các nhóm của người này (rỗng nếu chưa thuộc nhóm nào)',
  })
  teamNames: string[];
}
