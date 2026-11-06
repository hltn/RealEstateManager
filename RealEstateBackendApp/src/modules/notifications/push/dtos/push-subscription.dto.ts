import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDefined,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { PushPlatform } from '../push-subscription.constants';

/**
 * Chỉ kiểm kiểu và chặn payload quá lớn ở DTO; độ dài/định dạng khóa và allowlist `endpoint` do
 * `push-endpoint.policy.ts` kiểm để trả đúng mã `PUSH_SUBSCRIPTION_INVALID` (Architecture 4.1).
 */
export class PushKeysDto {
  @ApiProperty({
    description: 'Khóa công khai P-256 của trình duyệt (base64url, 87 ký tự)',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  p256dh: string;

  @ApiProperty({
    description:
      'Bí mật xác thực của trình duyệt (base64url, 22 ký tự). Được mã hóa khi lưu, không bao giờ trả lại',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  auth: string;
}

export class RegisterPushSubscriptionDto {
  @ApiProperty({
    description:
      'URL dịch vụ push (https, tối đa 1024 ký tự, host thuộc FCM/Mozilla/Apple/WNS)',
    example: 'https://fcm.googleapis.com/fcm/send/abc',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(4096)
  endpoint: string;

  @ApiProperty({ type: PushKeysDto })
  @IsDefined()
  @ValidateNested()
  @Type(() => PushKeysDto)
  keys: PushKeysDto;

  @ApiPropertyOptional({
    nullable: true,
    type: Number,
    description:
      '`PushSubscription.expirationTime` (mili giây từ epoch), null nếu không có',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(8_640_000_000_000_000)
  expirationTime?: number | null;
}

export class DisplacedPushSubscriptionDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ example: 'iPhone · Safari' })
  deviceLabel: string;
}

export class PushSubscriptionRegisteredDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ example: 'iPhone · Safari' })
  deviceLabel: string;

  @ApiProperty({ enum: PushPlatform })
  platform: PushPlatform;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  lastSeenAt: Date;

  @ApiProperty({
    nullable: true,
    type: DisplacedPushSubscriptionDto,
    description:
      'Thiết bị bị gỡ để nhường chỗ khi vượt 3 thiết bị (null nếu không có)',
  })
  displaced: DisplacedPushSubscriptionDto | null;
}
