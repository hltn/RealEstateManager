import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsMongoId,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { OptionalNotNull } from '../../../common/decorators/optional-not-null.decorator';
import { ToBoolean } from '../../../common/decorators/to-boolean.decorator';
import { Trim } from '../../../common/decorators/trim.decorator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { UserRefDto } from '../../../common/dto/ref.dto';

/** Mã nhóm: chữ/số/`-`/`_`, tối đa 20 ký tự; lưu chữ HOA nên so trùng không phân biệt hoa thường. */
export const TEAM_CODE_PATTERN = /^[A-Za-z0-9_-]{1,20}$/;
export const TEAM_MAX_MANAGERS = 20;

export class CreateTeamDto {
  @ApiProperty({ example: 'Nhóm Kinh doanh 1', maxLength: 100 })
  @Trim()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name: string;

  @ApiProperty({
    example: 'KD1',
    description:
      'Chữ, số, "-", "_", tối đa 20 ký tự; duy nhất không phân biệt hoa thường',
  })
  @Trim()
  @Matches(TEAM_CODE_PATTERN, {
    message: 'code chỉ gồm chữ không dấu, số, "-" hoặc "_", tối đa 20 ký tự',
  })
  code: string;

  @ApiPropertyOptional({
    type: [String],
    description: 'Id người dùng vai trò MANAGER đang hoạt động',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(TEAM_MAX_MANAGERS)
  @ArrayUnique()
  @IsMongoId({ each: true })
  managerIds?: string[];
}

/** Sửa nhóm: không đổi `code` (mã bất biến để tham chiếu ổn định). */
export class UpdateTeamDto {
  @ApiPropertyOptional({ maxLength: 100 })
  @OptionalNotNull()
  @Trim()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({ type: [String] })
  @OptionalNotNull()
  @IsArray()
  @ArrayMaxSize(TEAM_MAX_MANAGERS)
  @ArrayUnique()
  @IsMongoId({ each: true })
  managerIds?: string[];

  @ApiPropertyOptional()
  @OptionalNotNull()
  @IsBoolean()
  isActive?: boolean;
}

export class ListTeamsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description: 'Tìm theo tên hoặc mã nhóm',
    maxLength: 100,
  })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(100)
  q?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  isActive?: boolean;
}

export class TeamResponseDto {
  @ApiProperty({ example: '66f1a2b3c4d5e6f708192a3b' })
  id: string;

  @ApiProperty({ example: 'Nhóm Kinh doanh 1' })
  name: string;

  @ApiProperty({ example: 'KD1' })
  code: string;

  @ApiProperty({ type: [UserRefDto] })
  managers: UserRefDto[];

  @ApiProperty({
    description: 'Số thành viên (người dùng chưa xóa có teamId = nhóm này)',
  })
  memberCount: number;

  @ApiProperty()
  isActive: boolean;
}
