import { IsEnum } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { UserStatus } from '../../../common/enums/user-status.enum';

/**
 * DTO cập nhật trạng thái user (block/unblock).
 * Rule "không block chính mình" kiểm tra ở controller (trước khi gọi service).
 */
export class UpdateUserStatusDto {
  @ApiProperty({ enum: UserStatus, example: UserStatus.BLOCKED })
  @IsEnum(UserStatus)
  status: UserStatus;
}
