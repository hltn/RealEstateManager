import { ApiProperty } from '@nestjs/swagger';
import { UserRole } from '../../../common/enums/user-role.enum';

/**
 * Phần user trả về ở login response (KHÔNG chứa password, KHÔNG chứa status).
 * status chỉ trả ở /auth/me.
 *
 * LƯU Ý THỨ TỰ CLASS: UserPublicDto phải khai báo TRƯỚC AuthResponseDto
 * vì field `user: UserPublicDto` mang `@ApiProperty()` + tsconfig
 * `emitDecoratorMetadata: true` → TypeScript emit `Reflect.metadata("design:type", UserPublicDto)`
 * ngay lúc class AuthResponseDto được define. Nếu UserPublicDto khai báo sau,
 * nó đang nằm trong Temporal Dead Zone → ReferenceError lúc module load.
 */
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

export class AuthResponseDto {
  @ApiProperty()
  accessToken: string;

  @ApiProperty({ type: UserPublicDto })
  user: UserPublicDto;
}
