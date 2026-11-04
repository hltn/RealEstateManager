import {
  IsEmail,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Trim } from '../../../common/decorators/trim.decorator';

/**
 * DTO sửa thông tin tài khoản (ADMIN only). Rule field giống CreateUserDto.
 * Yêu cầu "ít nhất một trường" và email trùng (409) kiểm ở service.
 */
export class UpdateUserDto {
  @ApiPropertyOptional({ example: 'Editor One', minLength: 2, maxLength: 50 })
  @IsOptional()
  @Trim()
  @IsString()
  @MinLength(2)
  @MaxLength(50)
  displayName?: string;

  @ApiPropertyOptional({ example: 'editor@example.com' })
  @IsOptional()
  @Trim()
  @IsEmail()
  email?: string;
}
