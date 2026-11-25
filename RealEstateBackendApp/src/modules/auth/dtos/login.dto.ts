import { IsEmail, IsString, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

/**
 * DTO đăng nhập.
 * email: trim + lowercase trước khi validate (chuẩn hoá để so khớp DB).
 * password: tối thiểu 8 ký tự.
 */
export class LoginDto {
  @ApiProperty({ example: 'admin@example.com' })
  @Transform(({ value }) => String(value).trim().toLowerCase())
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'Admin@123456' })
  @IsString()
  @MinLength(8)
  password: string;
}
