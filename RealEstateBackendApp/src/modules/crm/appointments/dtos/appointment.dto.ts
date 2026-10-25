import { applyDecorators } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsISO8601,
  IsMongoId,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { CsvList } from '../../../../common/decorators/csv-list.decorator';
import { OptionalNotNull } from '../../../../common/decorators/optional-not-null.decorator';
import { Trim } from '../../../../common/decorators/trim.decorator';
import { PaginationQueryDto } from '../../../../common/dto/pagination-query.dto';
import { RefDto, UserRefDto } from '../../../../common/dto/ref.dto';
import { StatusRefDto } from '../../customers/dtos/customer-response.dto';
import { CareLogResponseDto } from '../../care-logs/dtos/care-log.dto';
import {
  APPOINTMENT_LOCATION_MAX_LENGTH,
  APPOINTMENT_MAX_REMIND_MINUTES,
  APPOINTMENT_MAX_REMINDERS,
  APPOINTMENT_NOTE_MAX_LENGTH,
  APPOINTMENT_OUTCOME_MAX_LENGTH,
  APPOINTMENT_TITLE_MAX_LENGTH,
  AppointmentStatus,
  AppointmentType,
} from '../appointment.constants';

const ISO_EXAMPLE = '2026-10-30T02:00:00.000Z';

/** Mốc nhắc trước giờ hẹn (phút): tối đa 5 mốc khác nhau, mỗi mốc 0 – 7 ngày. */
const RemindBeforeMinutes = () =>
  applyDecorators(
    IsArray(),
    ArrayMaxSize(APPOINTMENT_MAX_REMINDERS),
    ArrayUnique(),
    IsInt({ each: true }),
    Min(0, { each: true }),
    Max(APPOINTMENT_MAX_REMIND_MINUTES, { each: true }),
  );

export class CreateAppointmentDto {
  @ApiProperty()
  @IsMongoId()
  customerId: string;

  @ApiProperty({ enum: AppointmentType })
  @IsEnum(AppointmentType)
  type: AppointmentType;

  @ApiProperty({
    example: ISO_EXAMPLE,
    description:
      'ISO 8601 có offset (vd 2026-10-30T09:00:00+07:00); lưu UTC. Không được ở quá khứ (dung sai 5 phút)',
  })
  @IsISO8601({ strict: true })
  startAt: string;

  @ApiPropertyOptional({
    example: ISO_EXAMPLE,
    description: 'Sau startAt, tối đa 24 giờ',
  })
  @OptionalNotNull()
  @IsISO8601({ strict: true })
  endAt?: string;

  @ApiPropertyOptional({ maxLength: APPOINTMENT_TITLE_MAX_LENGTH })
  @OptionalNotNull()
  @Trim()
  @IsString()
  @MaxLength(APPOINTMENT_TITLE_MAX_LENGTH)
  title?: string;

  @ApiPropertyOptional({ maxLength: APPOINTMENT_LOCATION_MAX_LENGTH })
  @OptionalNotNull()
  @Trim()
  @IsString()
  @MaxLength(APPOINTMENT_LOCATION_MAX_LENGTH)
  location?: string;

  @ApiPropertyOptional({ maxLength: APPOINTMENT_NOTE_MAX_LENGTH })
  @OptionalNotNull()
  @Trim()
  @IsString()
  @MaxLength(APPOINTMENT_NOTE_MAX_LENGTH)
  note?: string;

  @ApiPropertyOptional({
    description:
      'Người thực hiện, phải thuộc nhóm chăm sóc của khách. Mặc định: chính mình nếu thuộc nhóm, không thì phụ trách chính',
  })
  @OptionalNotNull()
  @IsMongoId()
  assigneeId?: string;

  @ApiPropertyOptional({
    nullable: true,
    type: String,
    description:
      'Dự án của buổi hẹn (mọi loại lịch, không bắt buộc); phải còn hoạt động, ngược lại 400 VALIDATION_FAILED (field projectId). null/bỏ trống = không gắn',
  })
  @IsOptional()
  @IsMongoId()
  projectId?: string | null;

  @ApiPropertyOptional({
    type: [Number],
    example: [60, 1440],
    description:
      'Nhắc trước giờ hẹn (phút). Không gửi = mặc định theo cài đặt CRM; [] = không nhắc',
  })
  @OptionalNotNull()
  @RemindBeforeMinutes()
  remindBeforeMinutes?: number[];
}

export class UpdateAppointmentDto {
  @ApiPropertyOptional({
    description: 'Phiên bản đã đọc; lệch với hiện tại => 409 VERSION_CONFLICT',
  })
  @OptionalNotNull()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  version?: number;

  @ApiPropertyOptional({ example: ISO_EXAMPLE })
  @OptionalNotNull()
  @IsISO8601({ strict: true })
  startAt?: string;

  @ApiPropertyOptional({ example: ISO_EXAMPLE, nullable: true, type: String })
  @IsOptional()
  @IsISO8601({ strict: true })
  endAt?: string | null;

  @ApiPropertyOptional({ enum: AppointmentType })
  @OptionalNotNull()
  @IsEnum(AppointmentType)
  type?: AppointmentType;

  @ApiPropertyOptional({ maxLength: APPOINTMENT_TITLE_MAX_LENGTH })
  @OptionalNotNull()
  @Trim()
  @IsString()
  @MaxLength(APPOINTMENT_TITLE_MAX_LENGTH)
  title?: string;

  @ApiPropertyOptional({ maxLength: APPOINTMENT_LOCATION_MAX_LENGTH })
  @OptionalNotNull()
  @Trim()
  @IsString()
  @MaxLength(APPOINTMENT_LOCATION_MAX_LENGTH)
  location?: string;

  @ApiPropertyOptional({ maxLength: APPOINTMENT_NOTE_MAX_LENGTH })
  @OptionalNotNull()
  @Trim()
  @IsString()
  @MaxLength(APPOINTMENT_NOTE_MAX_LENGTH)
  note?: string;

  @ApiPropertyOptional()
  @OptionalNotNull()
  @IsMongoId()
  assigneeId?: string;

  @ApiPropertyOptional({
    nullable: true,
    type: String,
    description:
      'Đổi dự án (phải còn hoạt động khi gắn MỚI; gửi lại đúng dự án cũ thì bỏ qua kiểm tra). null = gỡ dự án; bỏ trống = giữ nguyên',
  })
  @IsOptional()
  @IsMongoId()
  projectId?: string | null;

  @ApiPropertyOptional({ type: [Number] })
  @OptionalNotNull()
  @RemindBeforeMinutes()
  remindBeforeMinutes?: number[];
}

export class ChangeAppointmentStatusDto {
  @ApiPropertyOptional({ description: 'Phiên bản đã đọc (tùy chọn)' })
  @OptionalNotNull()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  version?: number;

  @ApiProperty({ enum: AppointmentStatus })
  @IsEnum(AppointmentStatus)
  status: AppointmentStatus;

  @ApiPropertyOptional({
    maxLength: APPOINTMENT_OUTCOME_MAX_LENGTH,
    description: 'Kết quả buổi hẹn (khi hoàn thành) hoặc lý do hủy',
  })
  @OptionalNotNull()
  @Trim()
  @IsString()
  @MaxLength(APPOINTMENT_OUTCOME_MAX_LENGTH)
  outcome?: string;

  @ApiPropertyOptional({
    description:
      'Chỉ khi chuyển sang DONE: ghi luôn nhật ký chăm sóc từ kết quả (nội dung mặc định nếu không có outcome)',
  })
  @OptionalNotNull()
  @IsBoolean()
  createCareLog?: boolean;
}

export class ListAppointmentsQueryDto extends PaginationQueryDto {
  @ApiProperty({
    example: '2026-10-01',
    description:
      'YYYY-MM-DD (ngày giờ VN) hoặc ISO 8601; khoảng from..to tối đa 62 ngày',
  })
  @IsISO8601({ strict: true })
  from: string;

  @ApiProperty({ example: '2026-10-31' })
  @IsISO8601({ strict: true })
  to: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsMongoId()
  customerId?: string;

  @ApiPropertyOptional({ description: 'Chỉ lịch hẹn của dự án này' })
  @IsOptional()
  @IsMongoId()
  projectId?: string;

  @ApiPropertyOptional({
    type: [String],
    description: 'Phân tách bằng dấu phẩy',
  })
  @IsOptional()
  @CsvList()
  @IsArray()
  @ArrayMaxSize(50)
  @IsMongoId({ each: true })
  assigneeIds?: string[];

  @ApiPropertyOptional({ enum: AppointmentType, isArray: true })
  @IsOptional()
  @CsvList()
  @IsArray()
  @ArrayMaxSize(10)
  @IsEnum(AppointmentType, { each: true })
  types?: AppointmentType[];

  @ApiPropertyOptional({ enum: AppointmentStatus })
  @IsOptional()
  @IsEnum(AppointmentStatus)
  status?: AppointmentStatus;

  @ApiPropertyOptional({
    description: 'startAt | -startAt',
    default: 'startAt',
  })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  sort?: string;
}

export class AppointmentCustomerDto {
  @ApiProperty() id: string;
  @ApiProperty() fullName: string;
  @ApiProperty({ type: StatusRefDto }) status: StatusRefDto;
}

export class AppointmentResponseDto {
  @ApiProperty() id: string;
  @ApiProperty({ type: AppointmentCustomerDto })
  customer: AppointmentCustomerDto;
  @ApiProperty({ enum: AppointmentType }) type: AppointmentType;
  @ApiProperty() title: string;
  @ApiProperty({ example: ISO_EXAMPLE }) startAt: string;
  @ApiProperty({ nullable: true, type: String }) endAt: string | null;
  @ApiProperty() location: string;
  @ApiProperty() note: string;
  @ApiProperty({ type: UserRefDto }) assignee: UserRefDto;
  @ApiProperty({
    type: RefDto,
    nullable: true,
    description:
      'Dự án của buổi hẹn; vẫn trả tên khi dự án đã ngừng hoạt động/ẩn. null = chưa gắn',
  })
  project: RefDto | null;
  @ApiProperty({ type: [Number] }) remindBeforeMinutes: number[];
  @ApiProperty({ enum: AppointmentStatus }) status: AppointmentStatus;
  @ApiProperty({ nullable: true, type: String }) completedAt: string | null;
  @ApiProperty({ nullable: true, type: String }) outcome: string | null;
  @ApiProperty({ type: UserRefDto }) createdBy: UserRefDto;
  @ApiProperty({ description: 'Dùng làm `version` khi sửa (khóa lạc quan)' })
  version: number;
  @ApiProperty({ description: 'Người gọi có được xóa lịch này không' })
  canDelete: boolean;
}

export class AppointmentWithCareLogResponseDto extends AppointmentResponseDto {
  @ApiPropertyOptional({ type: CareLogResponseDto })
  careLog?: CareLogResponseDto;
}
