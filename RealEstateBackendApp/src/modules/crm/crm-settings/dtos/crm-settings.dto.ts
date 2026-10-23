import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsInt,
  IsOptional,
  Matches,
  Max,
  Min,
} from 'class-validator';

/** Giờ dạng `HH:mm` (00:00 – 23:59), theo giờ Việt Nam. */
export const TIME_OF_DAY_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const TIME_MESSAGE = 'Giờ phải có dạng HH:mm (00:00 – 23:59)';

/** Mặc định cấu hình (tài liệu 04 mục 3.7) — dùng khi Quản trị chưa đổi field nào. */
export const DEFAULT_CRM_SETTINGS = {
  staleCustomerDays: 14,
  staleCheckTime: '08:00',
  occasionNotifyTime: '07:30',
  occasionLeadDays: [0, 1],
  defaultAppointmentReminderMinutes: [60, 1440],
  careLogEditWindowHours: 24,
  careLogNotifyDebounceMinutes: 10,
  phoneViewAlertPerHour: 200,
} as const;

export class CrmSettingsResponseDto {
  @ApiProperty({
    example: 14,
    description:
      'Số ngày không có nhật ký thì khách bị coi là "lâu chưa chăm sóc"',
  })
  staleCustomerDays: number;

  @ApiProperty({ example: '08:00' }) staleCheckTime: string;
  @ApiProperty({ example: '07:30' }) occasionNotifyTime: string;

  @ApiProperty({
    type: [Number],
    example: [0, 1],
    description: 'Nhắc dịp đặc biệt trước N ngày (0 = đúng ngày)',
  })
  occasionLeadDays: number[];

  @ApiProperty({
    type: [Number],
    example: [60, 1440],
    description: 'Nhắc lịch hẹn trước N phút',
  })
  defaultAppointmentReminderMinutes: number[];

  @ApiProperty({ example: 24 }) careLogEditWindowHours: number;
  @ApiProperty({ example: 10 }) careLogNotifyDebounceMinutes: number;
  @ApiProperty({ example: 200 }) phoneViewAlertPerHour: number;
}

/** Sửa cấu hình: mọi field tùy chọn; chỉ field có gửi mới được ghi. */
export class UpdateCrmSettingsDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 365 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  staleCustomerDays?: number;

  @ApiPropertyOptional({ example: '08:00' })
  @IsOptional()
  @Matches(TIME_OF_DAY_PATTERN, { message: TIME_MESSAGE })
  staleCheckTime?: string;

  @ApiPropertyOptional({ example: '07:30' })
  @IsOptional()
  @Matches(TIME_OF_DAY_PATTERN, { message: TIME_MESSAGE })
  occasionNotifyTime?: string;

  @ApiPropertyOptional({ type: [Number], example: [0, 1] })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(5)
  @ArrayUnique()
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(30, { each: true })
  occasionLeadDays?: number[];

  @ApiPropertyOptional({ type: [Number], example: [60, 1440] })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(5)
  @ArrayUnique()
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(10_080, { each: true })
  defaultAppointmentReminderMinutes?: number[];

  @ApiPropertyOptional({ minimum: 1, maximum: 168 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(168)
  careLogEditWindowHours?: number;

  @ApiPropertyOptional({ minimum: 0, maximum: 120 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(120)
  careLogNotifyDebounceMinutes?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 10_000 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10_000)
  phoneViewAlertPerHour?: number;
}
