import { ApiProperty } from '@nestjs/swagger';
import { UserRole } from '../../../common/enums/user-role.enum';

/**
 * Phần user trả về ở login response (KHÔNG chứa password, KHÔNG chứa status).
 * status chỉ trả ở /auth/me.
 */
export class AuthResponseDto {
  @ApiProperty()
  accessToken: string;

  @ApiProperty()
  user: UserPublicDto;
}

export class UserPublicDto {
  @ApiProperty()
  _id: string;

  @ApiProperty()
  email: string;

  @ApiProperty()
  displayName: string;

  @ApiProperty({ enum: UserRole })
  role: UserRole;
}
