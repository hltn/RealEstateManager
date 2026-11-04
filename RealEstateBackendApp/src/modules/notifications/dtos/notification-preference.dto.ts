import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDefined,
  IsObject,
  IsOptional,
  Matches,
  ValidateNested,
} from 'class-validator';
import { TIME_OF_DAY_PATTERN } from '../notification-preference.rules';

const TIME_MESSAGE = 'Giờ phải có dạng HH:mm (00:00 – 23:59)';

export class TypePreferenceDto {
  @ApiProperty({ description: 'Đẩy thông báo ra thiết bị (M7, FCM)' })
  @IsBoolean()
  push: boolean;

  @ApiProperty({ description: 'Hiện trong hộp thông báo của ứng dụng' })
  @IsBoolean()
  inApp: boolean;
}

export class QuietHoursDto {
  @ApiProperty({ example: '22:00' })
  @Matches(TIME_OF_DAY_PATTERN, { message: TIME_MESSAGE })
  start: string;

  @ApiProperty({ example: '06:00' })
  @Matches(TIME_OF_DAY_PATTERN, { message: TIME_MESSAGE })
  end: string;
}

export class UpdateNotificationPreferencesDto {
  @ApiProperty({
    type: 'object',
    additionalProperties: { $ref: '#/components/schemas/TypePreferenceDto' },
    description:
      'Theo loại thông báo; loại không gửi giữ mặc định (bật cả hai). Khóa phải là một NotificationType hợp lệ',
  })
  @IsDefined()
  @IsObject()
  types: Record<string, TypePreferenceDto>;

  @ApiPropertyOptional({
    nullable: true,
    type: QuietHoursDto,
    description: 'Giờ yên lặng (giờ Việt Nam); null = bỏ',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => QuietHoursDto)
  quietHours?: QuietHoursDto | null;
}

export class NotificationPreferencesResponseDto {
  @ApiProperty({
    type: 'object',
    additionalProperties: { $ref: '#/components/schemas/TypePreferenceDto' },
  })
  types: Record<string, TypePreferenceDto>;

  @ApiProperty({ nullable: true, type: QuietHoursDto })
  quietHours: QuietHoursDto | null;
}
