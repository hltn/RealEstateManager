import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsInt,
  Max,
  Min,
  IsEnum,
  IsISO8601,
  IsMongoId,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { OptionalNotNull } from '../../../../common/decorators/optional-not-null.decorator';
import { Trim } from '../../../../common/decorators/trim.decorator';
import { PaginationQueryDto } from '../../../../common/dto/pagination-query.dto';
import { RefDto, UserRefDto } from '../../../../common/dto/ref.dto';
import {
  APPOINTMENT_LOCATION_MAX_LENGTH,
  APPOINTMENT_MAX_REMIND_MINUTES,
  APPOINTMENT_MAX_REMINDERS,
  AppointmentType,
} from '../../appointments/appointment.constants';
import { CUSTOMER_REASON_MAX_LENGTH } from '../../customers/customer.constants';
import {
  CARE_LOG_CONTENT_MAX_LENGTH,
  CARE_LOG_SUGGESTION_MAX_LENGTH,
  AttachmentStatus,
  CareLogSource,
  ContactChannel,
} from '../care-log.constants';

/** Số id ảnh tối đa chấp nhận ở tầng DTO (giới hạn nghiệp vụ 5 ảnh kiểm ở service với mã lỗi riêng). */
const MAX_ATTACHMENT_IDS_IN_REQUEST = 20;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DATE_MESSAGE = 'Ngày phải theo định dạng YYYY-MM-DD (giờ Việt Nam)';

/**
 * Lịch hẹn tạo kèm nhật ký (M5): bắt đầu đúng `nextAction.dueAt` (bắt buộc khi có `appointment`), người thực hiện là
 * người ghi nhật ký (Quản trị/Quản lý ngoài nhóm chăm sóc thì phụ trách chính), tiêu đề lấy từ `suggestion`.
 */
export class CareLogNextActionAppointmentDto {
  @ApiProperty({ enum: AppointmentType })
  @IsEnum(AppointmentType)
  type: AppointmentType;

  @ApiPropertyOptional({ maxLength: APPOINTMENT_LOCATION_MAX_LENGTH })
  @OptionalNotNull()
  @Trim()
  @IsString()
  @MaxLength(APPOINTMENT_LOCATION_MAX_LENGTH)
  location?: string;

  @ApiPropertyOptional({
    nullable: true,
    type: String,
    description:
      'Dự án của buổi hẹn (không bắt buộc); phải còn hoạt động, ngược lại 400 VALIDATION_FAILED (field projectId)',
  })
  @IsOptional()
  @IsMongoId()
  projectId?: string | null;

  @ApiPropertyOptional({
    type: [Number],
    description: 'Nhắc trước giờ hẹn (phút); không gửi = mặc định theo cài đặt',
  })
  @OptionalNotNull()
  @IsArray()
  @ArrayMaxSize(APPOINTMENT_MAX_REMINDERS)
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(APPOINTMENT_MAX_REMIND_MINUTES, { each: true })
  remindBeforeMinutes?: number[];
}

/** Bước tiếp theo gợi ý; `appointment` tạo luôn lịch hẹn tại `dueAt` (M5). */
export class CareLogNextActionInputDto {
  @ApiPropertyOptional({ maxLength: CARE_LOG_SUGGESTION_MAX_LENGTH })
  @OptionalNotNull()
  @Trim()
  @IsString()
  @MaxLength(CARE_LOG_SUGGESTION_MAX_LENGTH)
  suggestion?: string;

  @ApiPropertyOptional({ example: '2026-10-30T02:00:00.000Z' })
  @OptionalNotNull()
  @IsISO8601({ strict: true })
  dueAt?: string;

  @ApiPropertyOptional({ type: CareLogNextActionAppointmentDto })
  @OptionalNotNull()
  @ValidateNested()
  @Type(() => CareLogNextActionAppointmentDto)
  appointment?: CareLogNextActionAppointmentDto;
}

export class CreateCareLogDto {
  @ApiProperty({ maxLength: CARE_LOG_CONTENT_MAX_LENGTH })
  @Trim()
  @IsString()
  @MinLength(1)
  @MaxLength(CARE_LOG_CONTENT_MAX_LENGTH)
  content: string;

  @ApiProperty({ enum: ContactChannel })
  @IsEnum(ContactChannel)
  contactChannel: ContactChannel;

  @ApiPropertyOptional({
    example: '2026-10-23T03:15:00.000Z',
    description: 'Mặc định: bây giờ; không được ở tương lai',
  })
  @OptionalNotNull()
  @IsISO8601({ strict: true })
  occurredAt?: string;

  @ApiPropertyOptional({
    description: 'Danh mục CONTACT_RESULT đang hoạt động',
  })
  @OptionalNotNull()
  @IsMongoId()
  contactResultId?: string;

  @ApiPropertyOptional({
    type: [String],
    description:
      'Ảnh đã upload (tối đa 5), phải do chính người ghi tải lên cho khách này',
  })
  @OptionalNotNull()
  @ArrayMaxSize(MAX_ATTACHMENT_IDS_IN_REQUEST)
  @ArrayUnique()
  @IsMongoId({ each: true })
  attachmentIds?: string[];

  @ApiPropertyOptional({ type: CareLogNextActionInputDto })
  @OptionalNotNull()
  @ValidateNested()
  @Type(() => CareLogNextActionInputDto)
  nextAction?: CareLogNextActionInputDto;
}

export class UpdateCareLogDto {
  @ApiPropertyOptional({ maxLength: CARE_LOG_CONTENT_MAX_LENGTH })
  @OptionalNotNull()
  @Trim()
  @IsString()
  @MinLength(1)
  @MaxLength(CARE_LOG_CONTENT_MAX_LENGTH)
  content?: string;

  @ApiPropertyOptional({ enum: ContactChannel })
  @OptionalNotNull()
  @IsEnum(ContactChannel)
  contactChannel?: ContactChannel;

  @ApiPropertyOptional({ example: '2026-10-23T03:15:00.000Z' })
  @OptionalNotNull()
  @IsISO8601({ strict: true })
  occurredAt?: string;

  @ApiPropertyOptional({
    nullable: true,
    type: String,
    description: '`null` = bỏ kết quả liên hệ',
  })
  @IsOptional()
  @IsMongoId()
  contactResultId?: string | null;

  @ApiPropertyOptional({
    type: [String],
    description:
      'Tập ảnh MONG MUỐN sau khi sửa (thay thế toàn bộ): ảnh vắng mặt bị gỡ, ảnh mới được gắn',
  })
  @OptionalNotNull()
  @ArrayMaxSize(MAX_ATTACHMENT_IDS_IN_REQUEST)
  @ArrayUnique()
  @IsMongoId({ each: true })
  attachmentIds?: string[];
}

export class ListCareLogsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsMongoId()
  authorId?: string;

  @ApiPropertyOptional({ enum: ContactChannel })
  @IsOptional()
  @IsEnum(ContactChannel)
  contactChannel?: ContactChannel;

  @ApiPropertyOptional({ example: '2026-10-01', description: 'Giờ Việt Nam' })
  @IsOptional()
  @Matches(DATE_PATTERN, { message: DATE_MESSAGE })
  @IsISO8601({ strict: true })
  from?: string;

  @ApiPropertyOptional({ example: '2026-10-21', description: 'Giờ Việt Nam' })
  @IsOptional()
  @Matches(DATE_PATTERN, { message: DATE_MESSAGE })
  @IsISO8601({ strict: true })
  to?: string;
}

export class DeleteCareLogQueryDto {
  @ApiPropertyOptional({ maxLength: CUSTOMER_REASON_MAX_LENGTH })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(CUSTOMER_REASON_MAX_LENGTH)
  reason?: string;
}

export class CareLogAttachmentResponseDto {
  @ApiProperty() id: string;
  @ApiProperty({ description: 'Chưa có ảnh thu nhỏ ở M3: trùng `url`' })
  thumbUrl: string;
  @ApiProperty({ description: 'URL có chữ ký, hết hạn sau 15 phút' })
  url: string;
  @ApiProperty() mimeType: string;
  @ApiProperty() size: number;
}

export class CareLogNextActionResponseDto {
  @ApiProperty({ nullable: true, type: String }) suggestion: string | null;
  @ApiProperty({ nullable: true, type: String }) dueAt: string | null;
  @ApiProperty({ nullable: true, type: String }) appointmentId: string | null;
}

export class CareLogResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() customerId: string;
  @ApiProperty({ type: UserRefDto }) author: UserRefDto;
  @ApiProperty() occurredAt: string;
  @ApiProperty() content: string;
  @ApiProperty({ type: [CareLogAttachmentResponseDto] })
  attachments: CareLogAttachmentResponseDto[];
  @ApiProperty({ enum: ContactChannel }) contactChannel: ContactChannel;
  @ApiProperty({ nullable: true, type: RefDto }) contactResult: RefDto | null;
  @ApiProperty({ nullable: true, type: CareLogNextActionResponseDto })
  nextAction: CareLogNextActionResponseDto | null;
  @ApiProperty({ enum: CareLogSource }) source: CareLogSource;
  @ApiProperty({ nullable: true, type: String }) editedAt: string | null;
  @ApiProperty({ description: 'Người gọi còn quyền sửa/xóa nhật ký này' })
  canEdit: boolean;
}

export class AttachmentUploadResponseDto {
  @ApiProperty() id: string;
  @ApiProperty({ enum: AttachmentStatus }) status: AttachmentStatus;
}
