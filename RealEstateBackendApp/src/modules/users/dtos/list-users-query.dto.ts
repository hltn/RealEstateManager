import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsMongoId,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { Trim } from '../../../common/decorators/trim.decorator';
import { UserRole } from '../../../common/enums/user-role.enum';
import { UserStatus } from '../../../common/enums/user-status.enum';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

/** Query `GET /users`: phân trang + lọc theo vai trò, nhóm, trạng thái, từ khóa (tài liệu 05 mục 2.2). */
export class ListUsersQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: UserRole })
  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;

  @ApiPropertyOptional({ description: 'Id nhóm' })
  @IsOptional()
  @IsMongoId()
  teamId?: string;

  @ApiPropertyOptional({ enum: UserStatus })
  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus;

  @ApiPropertyOptional({
    description: 'Tìm theo tên hiển thị hoặc email',
    maxLength: 100,
  })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(100)
  q?: string;
}
