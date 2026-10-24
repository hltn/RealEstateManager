import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayUnique,
  Equals,
  IsArray,
  IsBoolean,
  IsEnum,
  IsISO8601,
  IsMongoId,
  IsOptional,
} from 'class-validator';
import { CsvList } from '../../../common/decorators/csv-list.decorator';
import { OptionalNotNull } from '../../../common/decorators/optional-not-null.decorator';
import { ToBoolean } from '../../../common/decorators/to-boolean.decorator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import {
  NOTIFICATION_BULK_MAX_IDS,
  NOTIFICATION_TYPES_FILTER_MAX,
  NotificationPriority,
  NotificationType,
} from '../notification.constants';

export class ListNotificationsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'true = đã đọc, false = chưa đọc' })
  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  isRead?: boolean;

  @ApiPropertyOptional({
    enum: NotificationType,
    isArray: true,
    description: 'Lọc theo loại, phân tách bằng dấu phẩy',
  })
  @IsOptional()
  @CsvList()
  @IsArray()
  @ArrayMaxSize(NOTIFICATION_TYPES_FILTER_MAX)
  @IsEnum(NotificationType, { each: true })
  types?: NotificationType[];
}

export class UpdateNotificationDto {
  @ApiProperty({ description: 'true = đã đọc, false = đánh dấu chưa đọc' })
  @IsBoolean()
  isRead: boolean;
}

export class MarkNotificationsReadDto {
  @ApiProperty({ enum: [true], description: 'Hàng loạt chỉ có "đã đọc"' })
  @Equals(true, { message: 'isRead phải là true' })
  isRead: true;

  @ApiPropertyOptional({
    type: [String],
    description: `Chỉ các thông báo này (tối đa ${NOTIFICATION_BULK_MAX_IDS}); bỏ trống = tất cả của mình`,
  })
  @OptionalNotNull()
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(NOTIFICATION_BULK_MAX_IDS)
  @IsMongoId({ each: true })
  ids?: string[];

  @ApiPropertyOptional({
    example: '2026-10-24T03:00:00.000Z',
    description: 'Chỉ thông báo tạo trước mốc này',
  })
  @OptionalNotNull()
  @IsISO8601({ strict: true })
  before?: string;
}

export class NotificationDataDto {
  @ApiPropertyOptional() customerId?: string;
  @ApiPropertyOptional() appointmentId?: string;
  @ApiPropertyOptional() requestId?: string;
  @ApiProperty({ example: '/crm/customers/66f1a2b3c4d5e6f708192a3b' })
  deepLink: string;
}

export class NotificationResponseDto {
  @ApiProperty() id: string;
  @ApiProperty({ enum: NotificationType }) type: NotificationType;
  @ApiProperty() title: string;
  @ApiProperty({ description: 'Không chứa SĐT hoặc CCCD' }) body: string;
  @ApiProperty({ type: NotificationDataDto }) data: NotificationDataDto;
  @ApiProperty({ enum: NotificationPriority }) priority: NotificationPriority;
  @ApiProperty({ nullable: true, type: String }) readAt: string | null;
  @ApiProperty() createdAt: string;
}

export class UnreadCountResponseDto {
  @ApiProperty({ example: 3 }) count: number;
}

export class MarkReadResultDto {
  @ApiProperty({ example: 5 }) updated: number;
}
