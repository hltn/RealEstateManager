import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  Equals,
  IsArray,
  IsBoolean,
  IsEmail,
  IsEnum,
  IsInt,
  IsMongoId,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { OptionalNotNull } from '../../../../common/decorators/optional-not-null.decorator';
import { Trim } from '../../../../common/decorators/trim.decorator';
import {
  ConsentMethod,
  ConsentStatus,
  CRITERION_DESCRIPTION_MAX_LENGTH,
  CUSTOMER_EMAIL_MAX_LENGTH,
  CUSTOMER_NAME_MAX_LENGTH,
  CUSTOMER_REASON_MAX_LENGTH,
  PhoneViewPurpose,
} from '../customer.constants';

const MAX_PROJECTS_PER_CUSTOMER = 20;
const MAX_CARE_MEMBERS_ON_CREATE = 20;
const PHONE_INPUT_MAX_LENGTH = 30;

/** Giá trị một tiêu chí khi gửi lên (cả hai field tùy chọn, không nhận `null`). */
export class CriterionInputDto {
  @ApiPropertyOptional()
  @OptionalNotNull()
  @IsBoolean()
  isDone?: boolean;

  @ApiPropertyOptional({ maxLength: CRITERION_DESCRIPTION_MAX_LENGTH })
  @OptionalNotNull()
  @Trim()
  @IsString()
  @MaxLength(CRITERION_DESCRIPTION_MAX_LENGTH)
  description?: string;
}

/** Tối đa 4 tiêu chí; field vắng mặt = giữ nguyên. */
export class CriteriaInputDto {
  @ApiPropertyOptional({ type: CriterionInputDto })
  @OptionalNotNull()
  @ValidateNested()
  @Type(() => CriterionInputDto)
  demand?: CriterionInputDto;

  @ApiPropertyOptional({ type: CriterionInputDto })
  @OptionalNotNull()
  @ValidateNested()
  @Type(() => CriterionInputDto)
  motivation?: CriterionInputDto;

  @ApiPropertyOptional({ type: CriterionInputDto })
  @OptionalNotNull()
  @ValidateNested()
  @Type(() => CriterionInputDto)
  finance?: CriterionInputDto;

  @ApiPropertyOptional({ type: CriterionInputDto })
  @OptionalNotNull()
  @ValidateNested()
  @Type(() => CriterionInputDto)
  timing?: CriterionInputDto;
}

export class CareTeamInputDto {
  @ApiProperty({
    type: [String],
    description: 'Người chăm sóc (MANAGER/STAFF đang hoạt động)',
  })
  @IsArray()
  @ArrayMaxSize(MAX_CARE_MEMBERS_ON_CREATE)
  @IsMongoId({ each: true })
  memberIds: string[];

  @ApiProperty({
    description: 'Phụ trách chính; tự được thêm nếu chưa có trong memberIds',
  })
  @IsMongoId()
  primaryUserId: string;
}

export class DataConsentInputDto {
  @ApiProperty({ enum: ConsentStatus })
  @IsEnum(ConsentStatus)
  status: ConsentStatus;

  @ApiPropertyOptional({ enum: ConsentMethod })
  @IsOptional()
  @IsEnum(ConsentMethod)
  method?: ConsentMethod;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(500)
  note?: string;
}

/** Tạo khách (tài liệu 05 mục 2.3). `tagIds` thuộc M4 nên chưa nhận. */
export class CreateCustomerDto {
  @ApiProperty({ maxLength: CUSTOMER_NAME_MAX_LENGTH })
  @Trim()
  @IsString()
  @MinLength(1)
  @MaxLength(CUSTOMER_NAME_MAX_LENGTH)
  fullName: string;

  @ApiProperty({
    example: '0912 345 678',
    description: 'Chuẩn hóa về E.164 ở server',
  })
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(PHONE_INPUT_MAX_LENGTH)
  phone: string;

  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @Trim()
  @IsEmail()
  @MaxLength(CUSTOMER_EMAIL_MAX_LENGTH)
  email?: string | null;

  @ApiPropertyOptional({
    description: 'Mặc định: tình trạng mặc định (Chưa tiếp cận)',
  })
  @IsOptional()
  @IsMongoId()
  statusId?: string;

  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @IsMongoId()
  sourceId?: string | null;

  @ApiPropertyOptional({ type: [String] })
  @OptionalNotNull()
  @IsArray()
  @ArrayMaxSize(MAX_PROJECTS_PER_CUSTOMER)
  @IsMongoId({ each: true })
  interestedProjectIds?: string[];

  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @IsMongoId()
  areaId?: string | null;

  @ApiPropertyOptional({
    description: 'CCCD 9 hoặc 12 chữ số; được mã hóa AES-256-GCM',
  })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(12)
  nationalId?: string;

  @ApiPropertyOptional({ type: CriteriaInputDto })
  @OptionalNotNull()
  @ValidateNested()
  @Type(() => CriteriaInputDto)
  criteria?: CriteriaInputDto;

  @ApiPropertyOptional({
    type: CareTeamInputDto,
    description:
      'Quản trị/Quản lý chỉ định; Nhân viên tạo thì tự là phụ trách chính',
  })
  @OptionalNotNull()
  @ValidateNested()
  @Type(() => CareTeamInputDto)
  careTeam?: CareTeamInputDto;

  @ApiPropertyOptional({ type: DataConsentInputDto })
  @OptionalNotNull()
  @ValidateNested()
  @Type(() => DataConsentInputDto)
  dataConsent?: DataConsentInputDto;
}

/** Sửa hồ sơ cơ bản; `version` bắt buộc (khóa lạc quan). `null` chỉ cho field không bắt buộc. */
export class UpdateCustomerDto {
  @ApiProperty({
    description: 'Version hiện tại của hồ sơ (CustomerDetail.version)',
  })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  version: number;

  @ApiPropertyOptional({ maxLength: CUSTOMER_NAME_MAX_LENGTH })
  @OptionalNotNull()
  @Trim()
  @IsString()
  @MinLength(1)
  @MaxLength(CUSTOMER_NAME_MAX_LENGTH)
  fullName?: string;

  @ApiPropertyOptional()
  @OptionalNotNull()
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(PHONE_INPUT_MAX_LENGTH)
  phone?: string;

  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @Trim()
  @IsEmail()
  @MaxLength(CUSTOMER_EMAIL_MAX_LENGTH)
  email?: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @IsMongoId()
  sourceId?: string | null;

  @ApiPropertyOptional({ type: [String] })
  @OptionalNotNull()
  @IsArray()
  @ArrayMaxSize(MAX_PROJECTS_PER_CUSTOMER)
  @IsMongoId({ each: true })
  interestedProjectIds?: string[];

  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @IsMongoId()
  areaId?: string | null;
}

export class ChangeStatusDto {
  @ApiProperty()
  @IsMongoId()
  statusId: string;

  @ApiProperty()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  version: number;

  @ApiPropertyOptional({ maxLength: CUSTOMER_REASON_MAX_LENGTH })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(CUSTOMER_REASON_MAX_LENGTH)
  reason?: string;
}

/** Cập nhật 1-4 tiêu chí; `progress` do server tính. */
export class UpdateCriteriaDto extends CriteriaInputDto {
  @ApiProperty()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  version: number;
}

export class UpdateDataConsentDto extends DataConsentInputDto {}

export class DeleteCustomerQueryDto {
  @ApiProperty({ maxLength: CUSTOMER_REASON_MAX_LENGTH })
  @Trim()
  @IsString()
  @MinLength(1)
  @MaxLength(CUSTOMER_REASON_MAX_LENGTH)
  reason: string;
}

export class RestoreCustomerDto {
  @ApiProperty()
  @IsMongoId()
  customerId: string;

  @ApiPropertyOptional({ maxLength: CUSTOMER_REASON_MAX_LENGTH })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(CUSTOMER_REASON_MAX_LENGTH)
  reason?: string;
}

export class AnonymizeCustomerDto {
  @ApiProperty()
  @IsMongoId()
  customerId: string;

  @ApiProperty({ maxLength: CUSTOMER_REASON_MAX_LENGTH })
  @Trim()
  @IsString()
  @MinLength(1)
  @MaxLength(CUSTOMER_REASON_MAX_LENGTH)
  reason: string;

  @ApiProperty({ description: 'Phải là true: thao tác không hoàn tác được' })
  @Equals(true, { message: 'confirm phải là true để ẩn danh hóa' })
  confirm: boolean;
}

export class PhoneLookupDto {
  @ApiProperty({ example: '0912 345 678' })
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(PHONE_INPUT_MAX_LENGTH)
  phone: string;
}

export class PhoneViewDto {
  @ApiProperty({ enum: PhoneViewPurpose })
  @IsEnum(PhoneViewPurpose)
  purpose: PhoneViewPurpose;
}

export class SetNationalIdDto {
  @ApiProperty({ description: '9 hoặc 12 chữ số', example: '012345678901' })
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(12)
  nationalId: string;
}

export class NationalIdViewDto {
  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(100)
  purpose?: string;
}
