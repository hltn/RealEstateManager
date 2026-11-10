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
import { CatalogCode } from '../../../../common/decorators/catalog-code.decorator';
import { OptionalNotNull } from '../../../../common/decorators/optional-not-null.decorator';
import { HasVisibleChar } from '../../../../common/decorators/has-visible-char.decorator';
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
import { MAX_TAGS_PER_CUSTOMER } from '../../tags/tag.constants';

const MAX_PROJECTS_PER_CUSTOMER = 20;
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

/**
 * Tạo khách (tài liệu 05 mục 2.3). Không nhận `careTeam`: người tạo luôn là phụ trách chính (FR-10); `ValidationPipe`
 * (`forbidNonWhitelisted`) trả 400 nếu client gửi trường này.
 */
export class CreateCustomerDto {
  @ApiProperty({ maxLength: CUSTOMER_NAME_MAX_LENGTH })
  @Trim()
  @IsString()
  @MinLength(1)
  @MaxLength(CUSTOMER_NAME_MAX_LENGTH)
  fullName: string;

  @ApiPropertyOptional({
    example: '0912 345 678',
    nullable: true,
    type: String,
    description:
      'Tùy chọn (FR-01): vắng mặt, `null` hoặc chuỗi rỗng = khách chưa có SĐT. Có giá trị thì chuẩn hóa về E.164 ở server; không kiểm trùng',
  })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(PHONE_INPUT_MAX_LENGTH)
  phone?: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @Trim()
  @IsEmail()
  @MaxLength(CUSTOMER_EMAIL_MAX_LENGTH)
  email?: string | null;

  @ApiPropertyOptional({
    description:
      'Mặc định: tình trạng mặc định (Chưa tiếp cận). Deprecated: dùng `statusCode`',
  })
  @IsOptional()
  @IsMongoId()
  statusId?: string;

  @ApiPropertyOptional({
    description:
      'Mã tình trạng (ưu tiên hơn `statusId`; gửi cả hai mà không cùng bản ghi: 400)',
  })
  @OptionalNotNull()
  @CatalogCode()
  statusCode?: string;

  @ApiPropertyOptional({
    nullable: true,
    type: String,
    description: 'Deprecated: dùng `sourceCode`',
  })
  @IsOptional()
  @IsMongoId()
  sourceId?: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @CatalogCode()
  sourceCode?: string | null;

  @ApiPropertyOptional({
    type: [String],
    description: 'Deprecated: dùng `projectCodes`',
  })
  @OptionalNotNull()
  @IsArray()
  @ArrayMaxSize(MAX_PROJECTS_PER_CUSTOMER)
  @IsMongoId({ each: true })
  interestedProjectIds?: string[];

  @ApiPropertyOptional({ type: [String], description: 'Mã dự án quan tâm' })
  @OptionalNotNull()
  @IsArray()
  @ArrayMaxSize(MAX_PROJECTS_PER_CUSTOMER)
  @CatalogCode({ each: true })
  projectCodes?: string[];

  @ApiPropertyOptional({
    nullable: true,
    type: String,
    description: 'Deprecated: dùng `areaCode`',
  })
  @IsOptional()
  @IsMongoId()
  areaId?: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @CatalogCode()
  areaCode?: string | null;

  @ApiPropertyOptional({
    type: [String],
    description: 'Thẻ sở thích/nghề nghiệp (id của /crm/tags)',
  })
  @OptionalNotNull()
  @IsArray()
  @ArrayMaxSize(MAX_TAGS_PER_CUSTOMER)
  @IsMongoId({ each: true })
  tagIds?: string[];

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

  @ApiPropertyOptional({
    nullable: true,
    type: String,
    description:
      'Vắng mặt = giữ nguyên; `null` hoặc chuỗi rỗng = xóa SĐT (FR-01); có giá trị = chuẩn hóa và thay. Không kiểm trùng',
  })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(PHONE_INPUT_MAX_LENGTH)
  phone?: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @Trim()
  @IsEmail()
  @MaxLength(CUSTOMER_EMAIL_MAX_LENGTH)
  email?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    type: String,
    description: 'Deprecated: dùng `sourceCode`',
  })
  @IsOptional()
  @IsMongoId()
  sourceId?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    type: String,
    description:
      'Mã nguồn (ưu tiên hơn `sourceId`; `null` = xóa; gửi cả hai mà không cùng bản ghi: 400)',
  })
  @IsOptional()
  @CatalogCode()
  sourceCode?: string | null;

  @ApiPropertyOptional({
    type: [String],
    description: 'Deprecated: dùng `projectCodes`',
  })
  @OptionalNotNull()
  @IsArray()
  @ArrayMaxSize(MAX_PROJECTS_PER_CUSTOMER)
  @IsMongoId({ each: true })
  interestedProjectIds?: string[];

  @ApiPropertyOptional({
    type: [String],
    description:
      'Mã dự án quan tâm (thay thế toàn bộ; `[]` = xóa hết); vắng mặt = giữ nguyên',
  })
  @OptionalNotNull()
  @IsArray()
  @ArrayMaxSize(MAX_PROJECTS_PER_CUSTOMER)
  @CatalogCode({ each: true })
  projectCodes?: string[];

  @ApiPropertyOptional({
    nullable: true,
    type: String,
    description: 'Deprecated: dùng `areaCode`',
  })
  @IsOptional()
  @IsMongoId()
  areaId?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    type: String,
    description:
      'Mã khu vực (ưu tiên hơn `areaId`; `null` = xóa; gửi cả hai mà không cùng bản ghi: 400)',
  })
  @IsOptional()
  @CatalogCode()
  areaCode?: string | null;

  @ApiPropertyOptional({
    type: [String],
    description:
      'Danh sách thẻ MONG MUỐN (thay thế toàn bộ); vắng mặt = giữ nguyên',
  })
  @OptionalNotNull()
  @IsArray()
  @ArrayMaxSize(MAX_TAGS_PER_CUSTOMER)
  @IsMongoId({ each: true })
  tagIds?: string[];
}

export class ChangeStatusDto {
  @ApiPropertyOptional({
    description:
      'Deprecated: dùng `statusCode`. Phải gửi một trong hai (`statusCode` hoặc `statusId`)',
  })
  @IsOptional()
  @IsMongoId()
  statusId?: string;

  @ApiPropertyOptional({
    description:
      'Mã tình trạng đích (ưu tiên hơn `statusId`; gửi cả hai mà không cùng bản ghi: 400)',
  })
  @OptionalNotNull()
  @CatalogCode()
  statusCode?: string;

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
  @HasVisibleChar()
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
