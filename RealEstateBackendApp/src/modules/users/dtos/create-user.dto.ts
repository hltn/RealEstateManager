import {
  IsEmail,
  IsEnum,
  IsMongoId,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { UserRole } from '../../../common/enums/user-role.enum';

/**
 * DTO tạo user (ADMIN only).
 * Email unique check thực hiện ở DB (service throw ConflictException khi trùng)
 * — DTO chỉ validate format.
 */
export class CreateUserDto {
  @ApiProperty({ example: 'editor@example.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'Editor@123456' })
  @IsString()
  @MinLength(8)
  password: string;

  @ApiProperty({ example: 'Editor One' })
  @IsString()
  @MinLength(2)
  @MaxLength(50)
  displayName: string;

  @ApiProperty({ enum: UserRole, example: UserRole.EDITOR })
  @IsEnum(UserRole)
  role: UserRole;

  @ApiPropertyOptional({
    description: 'Id nhóm (chỉ với vai trò MANAGER/STAFF của CRM)',
    example: '66f1a2b3c4d5e6f708192a3b',
  })
  @IsOptional()
  @IsMongoId()
  teamId?: string;
}
