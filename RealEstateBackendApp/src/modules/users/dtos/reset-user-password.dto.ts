import { IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/** DTO đặt lại mật khẩu cho tài khoản (ADMIN only). Rule độ mạnh giống `password` của CreateUserDto. */
export class ResetUserPasswordDto {
  @ApiProperty({ example: 'NewPass@123456', minLength: 8 })
  @IsString()
  @MinLength(8)
  newPassword: string;
}
