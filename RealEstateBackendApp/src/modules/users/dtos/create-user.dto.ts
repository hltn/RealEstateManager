import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsEmail,
  IsEnum,
  IsMongoId,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { UserRole } from '../../../common/enums/user-role.enum';

/**
 * DTO tạo user (ADMIN only).
 * Email unique check thực hiện ở DB (service throw ConflictException khi trùng)
 * — DTO chỉ validate format.
 *
 * Tương thích ngược: `role` đơn là viết tắt của `roles = [role]`; `teamId` đơn là viết tắt của `teamIds = [teamId]`.
 * Gửi cả hai dạng thì phải nhất quán: `role` = role cao nhất của `roles`, `teamId` = `teamIds[0]`; mâu thuẫn → 400.
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

  @ApiPropertyOptional({
    enum: UserRole,
    example: UserRole.EDITOR,
    description:
      'Viết tắt của roles=[role]; bắt buộc khi không gửi roles. Nếu gửi cùng roles thì phải bằng role cao nhất của roles (nếu không → 400)',
  })
  @ValidateIf((dto: CreateUserDto) => dto.roles === undefined)
  @IsEnum(UserRole)
  role?: UserRole;

  @ApiPropertyOptional({
    enum: UserRole,
    isArray: true,
    example: [UserRole.MANAGER, UserRole.STAFF],
    description:
      'Mọi role của tài khoản (≥1, không trùng). Quyền lấy theo role cao nhất trong phân vùng CRM',
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsEnum(UserRole, { each: true })
  roles?: UserRole[];

  @ApiPropertyOptional({
    description:
      'Viết tắt của teamIds=[teamId] (chỉ với role MANAGER/STAFF). Nếu gửi cùng teamIds thì phải bằng teamIds[0] (nếu không → 400)',
    example: '66f1a2b3c4d5e6f708192a3b',
  })
  @IsOptional()
  @IsMongoId()
  teamId?: string;

  @ApiPropertyOptional({
    type: [String],
    description: 'Các nhóm của tài khoản (chỉ với role MANAGER/STAFF)',
    example: ['66f1a2b3c4d5e6f708192a3b'],
  })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsMongoId({ each: true })
  teamIds?: string[];
}
