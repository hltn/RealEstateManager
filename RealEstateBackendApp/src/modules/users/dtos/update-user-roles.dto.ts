import { ApiProperty } from '@nestjs/swagger';
import { ArrayMinSize, ArrayUnique, IsArray, IsEnum } from 'class-validator';
import { UserRole } from '../../../common/enums/user-role.enum';

/** DTO đặt toàn bộ role của tài khoản (`PATCH /users/:id/roles`): ≥1 role, không trùng. */
export class UpdateUserRolesDto {
  @ApiProperty({
    enum: UserRole,
    isArray: true,
    example: [UserRole.MANAGER, UserRole.STAFF],
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsEnum(UserRole, { each: true })
  roles: UserRole[];
}
