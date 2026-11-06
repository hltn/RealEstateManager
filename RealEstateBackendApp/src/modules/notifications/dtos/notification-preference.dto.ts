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
  @ApiProperty({
    description:
      'Đẩy thông báo ra thiết bị. Chỉ có tác dụng khi `inApp` bật: tắt `inApp` nghĩa là không có thông báo trong app VÀ không có push',
  })
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
    description:
      'Giờ yên lặng theo giờ Việt Nam: `start` bao gồm, `end` không bao gồm, `start` phải khác `end`, được phép qua nửa đêm (22:00 đến 06:00); null = bỏ (mặc định tắt)',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => QuietHoursDto)
  quietHours?: QuietHoursDto | null;
}

export class PushTypeInfoDto {
  @ApiProperty({ example: 'CUSTOMER_ASSIGNED' })
  type: string;

  @ApiProperty({ description: 'Tên hiển thị của loại thông báo' })
  label: string;

  @ApiProperty({ description: 'Mô tả ngắn khi nào push được gửi' })
  description: string;

  @ApiProperty({ description: 'Mặc định bật push cho loại này' })
  defaultEnabled: boolean;

  @ApiProperty({ description: 'Người dùng có được tắt push loại này không' })
  canDisable: boolean;
}

export class NotificationPreferencesResponseDto {
  @ApiProperty({
    type: 'object',
    additionalProperties: { $ref: '#/components/schemas/TypePreferenceDto' },
  })
  types: Record<string, TypePreferenceDto>;

  @ApiProperty({
    nullable: true,
    type: QuietHoursDto,
    description: 'Giờ yên lặng (giờ Việt Nam); null = tắt (mặc định)',
  })
  quietHours: QuietHoursDto | null;

  @ApiProperty({
    type: [PushTypeInfoDto],
    description:
      'Các loại thông báo có push, theo thứ tự danh mục (nguồn: PUSH_CATALOG). Tắt `inApp` của một loại thì loại đó cũng không push',
  })
  pushTypes: PushTypeInfoDto[];
}
