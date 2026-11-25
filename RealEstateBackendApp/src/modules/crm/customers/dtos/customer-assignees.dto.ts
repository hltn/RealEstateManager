import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsMongoId, IsOptional, IsString, MaxLength } from 'class-validator';
import { Trim } from '../../../../common/decorators/trim.decorator';
import { PaginationQueryDto } from '../../../../common/dto/pagination-query.dto';
import { RefDto } from '../../../../common/dto/ref.dto';
import { UserRole } from '../../../../common/enums/user-role.enum';

/** Độ dài tối đa của từ khóa `q` (Architecture mục 4, `customer-assignees`). */
export const ASSIGNEE_SEARCH_MAX_LENGTH = 50;

/** Query `GET /crm/customer-assignees` (limit ≤ 100 theo `PaginationQueryDto`). */
export class ListCustomerAssigneesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description: 'Tìm theo tên hiển thị (không phân biệt hoa/thường)',
    maxLength: ASSIGNEE_SEARCH_MAX_LENGTH,
  })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(ASSIGNEE_SEARCH_MAX_LENGTH)
  q?: string;

  @ApiPropertyOptional({
    description: 'Chỉ lấy người thuộc nhóm này',
    example: '66f1a2b3c4d5e6f708192a3b',
  })
  @IsOptional()
  @IsMongoId()
  teamId?: string;
}

/**
 * Người xuất hiện trong nhóm chăm sóc của các khách mà người gọi được thấy. Chỉ id, tên, vai trò, nhóm và cờ khóa —
 * không email/SĐT/CCCD.
 */
export class CustomerAssigneeResponseDto {
  @ApiProperty({ example: '66f1a2b3c4d5e6f708192a3b' })
  id: string;

  @ApiProperty({ example: 'Hạnh' })
  displayName: string;

  @ApiProperty({
    enum: UserRole,
    description:
      'Role cao nhất trong các role được phân chăm sóc (MANAGER/STAFF); người đã đổi sang role khác thì lấy role cao nhất hiện tại',
  })
  role: UserRole;

  @ApiProperty({
    nullable: true,
    type: RefDto,
    description: 'Nhóm chính (phần tử đầu của teams)',
  })
  team: RefDto | null;

  @ApiProperty({ type: [RefDto] })
  teams: RefDto[];

  @ApiProperty({
    description:
      'true khi tài khoản đang bị khóa (BLOCKED): hiện nhãn "đã khóa"',
    example: false,
  })
  isLocked: boolean;
}
