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
import {
  PushPlatform,
  PushRevokedReason,
} from '../push-subscription.constants';

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

/** Một thiết bị đang nhận push của người gọi. Cố ý KHÔNG có `endpoint`, `keys`, `endpointHash`. */
export class ActivePushSubscriptionDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ example: 'iPhone · Safari' })
  deviceLabel: string;

  @ApiProperty({ enum: PushPlatform })
  platform: PushPlatform;

  @ApiProperty()
  lastSeenAt: Date;

  @ApiProperty()
  createdAt: Date;
}

/** Thiết bị vừa bị gỡ (trong 7 ngày) để trang cài đặt báo "đã gỡ thiết bị X". Không có `id`: chỉ để hiển thị. */
export class RevokedPushSubscriptionDto {
  @ApiProperty({ example: 'iPhone · Safari' })
  deviceLabel: string;

  @ApiProperty({ enum: PushRevokedReason })
  reason: PushRevokedReason;

  @ApiProperty()
  revokedAt: Date;
}

export class PushSubscriptionListDto {
  @ApiProperty({ type: [ActivePushSubscriptionDto] })
  active: ActivePushSubscriptionDto[];

  @ApiProperty({
    type: [RevokedPushSubscriptionDto],
    description: 'Đã thu hồi trong 7 ngày gần nhất, mới nhất trước',
  })
  recentlyRevoked: RevokedPushSubscriptionDto[];
}

export class PushConfigDto {
  @ApiProperty({
    description:
      'Cờ `FEATURE_CRM_PUSH` bật VÀ đủ biến `VAPID_*` hợp lệ. FE chỉ hiện nút bật push khi `true`',
  })
  enabled: boolean;

  @ApiProperty({
    nullable: true,
    type: String,
    description:
      'Khóa công khai VAPID (không bí mật) để `pushManager.subscribe`; `null` khi `enabled = false`',
  })
  publicKey: string | null;
}
