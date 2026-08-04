import { IsEnum } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { UserRole } from '../../../common/enums/user-role.enum';

/**
 * DTO cập nhật role user (ADMIN/EDITOR).
 * Không áp dụng rule "không đổi chính mình" ở MVP.
 */
export class UpdateUserRoleDto {
  @ApiProperty({ enum: UserRole, example: UserRole.EDITOR })
  @IsEnum(UserRole)
  role: UserRole;
}
