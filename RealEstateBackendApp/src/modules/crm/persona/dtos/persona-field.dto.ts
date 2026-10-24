import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsMongoId,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { OptionalNotNull } from '../../../../common/decorators/optional-not-null.decorator';
import { ToBoolean } from '../../../../common/decorators/to-boolean.decorator';
import { Trim } from '../../../../common/decorators/trim.decorator';
import { CatalogPaginationQueryDto } from '../../catalogs/dtos/catalog-common.dto';
import {
  LinkedCriterion,
  PERSONA_HELP_TEXT_MAX_LENGTH,
  PERSONA_KEY_PATTERN,
  PERSONA_LABEL_MAX_LENGTH,
  PERSONA_MAX_OPTIONS,
  PERSONA_MAX_SUGGEST_PRIORITY,
  PERSONA_MAX_WEIGHT,
  PERSONA_OPTION_VALUE_MAX_LENGTH,
  PersonaFieldType,
} from '../persona.constants';

const MAX_REORDER_ITEMS = 200;
const MAX_ORDER = 100_000;

export class PersonaOptionInputDto {
  @ApiProperty({
    maxLength: PERSONA_OPTION_VALUE_MAX_LENGTH,
    example: 'APARTMENT',
    description:
      'Mã lựa chọn (lưu vào dữ liệu khách), không đổi được sau khi dùng',
  })
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(PERSONA_OPTION_VALUE_MAX_LENGTH)
  value: string;

  @ApiProperty({ maxLength: PERSONA_LABEL_MAX_LENGTH })
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(PERSONA_LABEL_MAX_LENGTH)
  label: string;

  @ApiPropertyOptional({ default: true })
  @OptionalNotNull()
  @IsBoolean()
  isActive?: boolean;
}

/** Thêm trường chân dung (X10). `key` bất biến sau khi tạo. */
export class CreatePersonaFieldDto {
  @ApiProperty({
    example: 'occupation',
    description: 'Slug chữ thường, bắt đầu bằng chữ, tối đa 40 ký tự; bất biến',
  })
  @IsString()
  @Matches(PERSONA_KEY_PATTERN, {
    message: 'key gồm chữ thường, số, "_", bắt đầu bằng chữ, tối đa 40 ký tự',
  })
  key: string;

  @ApiProperty({ maxLength: PERSONA_LABEL_MAX_LENGTH })
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(PERSONA_LABEL_MAX_LENGTH)
  label: string;

  @ApiProperty({
    example: 'OCCUPATION',
    description: 'Mã nhóm (catalog PERSONA_GROUP)',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  groupCode: string;

  @ApiProperty({ enum: PersonaFieldType })
  @IsEnum(PersonaFieldType)
  type: PersonaFieldType;

  @ApiPropertyOptional({
    type: [PersonaOptionInputDto],
    description: 'Chỉ cho SELECT/MULTI_SELECT',
  })
  @OptionalNotNull()
  @IsArray()
  @ArrayMaxSize(PERSONA_MAX_OPTIONS)
  @ValidateNested({ each: true })
  @Type(() => PersonaOptionInputDto)
  options?: PersonaOptionInputDto[];

  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(PERSONA_HELP_TEXT_MAX_LENGTH)
  helpText?: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(PERSONA_HELP_TEXT_MAX_LENGTH)
  placeholder?: string | null;

  @ApiPropertyOptional({
    default: 1,
    minimum: 0,
    maximum: PERSONA_MAX_WEIGHT,
    description: 'Trọng số độ đầy đủ; 0 = không tính',
  })
  @OptionalNotNull()
  @IsInt()
  @Min(0)
  @Max(PERSONA_MAX_WEIGHT)
  weight?: number;

  @ApiPropertyOptional({ default: 50, description: 'Nhỏ = hỏi trước' })
  @OptionalNotNull()
  @IsInt()
  @Min(0)
  @Max(PERSONA_MAX_SUGGEST_PRIORITY)
  suggestPriority?: number;

  @ApiPropertyOptional({
    default: false,
    description: 'Chỉ TEXT, SELECT, MULTI_SELECT, BOOLEAN',
  })
  @OptionalNotNull()
  @IsBoolean()
  isFilterable?: boolean;

  @ApiPropertyOptional({ default: false, description: 'Chỉ kiểu DATE' })
  @OptionalNotNull()
  @IsBoolean()
  isOccasion?: boolean;

  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(PERSONA_LABEL_MAX_LENGTH)
  occasionLabel?: string | null;

  @ApiPropertyOptional({ enum: LinkedCriterion, nullable: true })
  @IsOptional()
  @IsEnum(LinkedCriterion)
  linkedCriterion?: LinkedCriterion | null;

  @ApiPropertyOptional({
    default: false,
    description:
      'Nhạy cảm: khi lưu bắt buộc source=CUSTOMER_SHARED + sensitiveAcknowledged=true',
  })
  @OptionalNotNull()
  @IsBoolean()
  isSensitive?: boolean;
}

/**
 * Sửa trường: mọi thuộc tính của POST trừ `key` (bất biến). `type` chỉ đổi được khi chưa có dữ liệu.
 * `options` là DANH SÁCH MONG MUỐN: lựa chọn vắng mặt bị tắt (không xóa).
 */
export class UpdatePersonaFieldDto {
  @ApiPropertyOptional({ maxLength: PERSONA_LABEL_MAX_LENGTH })
  @OptionalNotNull()
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(PERSONA_LABEL_MAX_LENGTH)
  label?: string;

  @ApiPropertyOptional()
  @OptionalNotNull()
  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  groupCode?: string;

  @ApiPropertyOptional({
    enum: PersonaFieldType,
    description: 'Khóa khi đã có dữ liệu (409 PERSONA_FIELD_TYPE_LOCKED)',
  })
  @OptionalNotNull()
  @IsEnum(PersonaFieldType)
  type?: PersonaFieldType;

  @ApiPropertyOptional({ type: [PersonaOptionInputDto] })
  @OptionalNotNull()
  @IsArray()
  @ArrayMaxSize(PERSONA_MAX_OPTIONS)
  @ValidateNested({ each: true })
  @Type(() => PersonaOptionInputDto)
  options?: PersonaOptionInputDto[];

  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(PERSONA_HELP_TEXT_MAX_LENGTH)
  helpText?: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(PERSONA_HELP_TEXT_MAX_LENGTH)
  placeholder?: string | null;

  @ApiPropertyOptional({ minimum: 0, maximum: PERSONA_MAX_WEIGHT })
  @OptionalNotNull()
  @IsInt()
  @Min(0)
  @Max(PERSONA_MAX_WEIGHT)
  weight?: number;

  @ApiPropertyOptional()
  @OptionalNotNull()
  @IsInt()
  @Min(0)
  @Max(PERSONA_MAX_SUGGEST_PRIORITY)
  suggestPriority?: number;

  @ApiPropertyOptional()
  @OptionalNotNull()
  @IsBoolean()
  isFilterable?: boolean;

  @ApiPropertyOptional()
  @OptionalNotNull()
  @IsBoolean()
  isOccasion?: boolean;

  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(PERSONA_LABEL_MAX_LENGTH)
  occasionLabel?: string | null;

  @ApiPropertyOptional({ enum: LinkedCriterion, nullable: true })
  @IsOptional()
  @IsEnum(LinkedCriterion)
  linkedCriterion?: LinkedCriterion | null;

  @ApiPropertyOptional()
  @OptionalNotNull()
  @IsBoolean()
  isSensitive?: boolean;

  @ApiPropertyOptional({
    description: 'false = ẩn trường (giữ nguyên dữ liệu khách)',
  })
  @OptionalNotNull()
  @IsBoolean()
  isActive?: boolean;
}

export class ListPersonaFieldsQueryDto extends CatalogPaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ example: 'REAL_ESTATE' })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  groupCode?: string;
}

export class ReorderPersonaFieldItemDto {
  @ApiProperty()
  @IsMongoId()
  id: string;

  @ApiProperty({ minimum: 0, maximum: MAX_ORDER })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(MAX_ORDER)
  order: number;

  @ApiPropertyOptional({ description: 'Chuyển trường sang nhóm khác' })
  @OptionalNotNull()
  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  groupCode?: string;
}

export class ReorderPersonaFieldsDto {
  @ApiProperty({ type: [ReorderPersonaFieldItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_REORDER_ITEMS)
  @ArrayUnique((item: ReorderPersonaFieldItemDto) => item.id)
  @ValidateNested({ each: true })
  @Type(() => ReorderPersonaFieldItemDto)
  items: ReorderPersonaFieldItemDto[];
}

export class PersonaOptionResponseDto {
  @ApiProperty() value: string;
  @ApiProperty() label: string;
  @ApiProperty() isActive: boolean;
}

export class PersonaFieldResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() key: string;
  @ApiProperty() label: string;
  @ApiProperty({ nullable: true, type: String }) helpText: string | null;
  @ApiProperty({ nullable: true, type: String }) placeholder: string | null;
  @ApiProperty() groupCode: string;
  @ApiProperty({ enum: PersonaFieldType }) type: PersonaFieldType;
  @ApiProperty({ type: [PersonaOptionResponseDto] })
  options: PersonaOptionResponseDto[];
  @ApiProperty() order: number;
  @ApiProperty() weight: number;
  @ApiProperty() suggestPriority: number;
  @ApiProperty() isFilterable: boolean;
  @ApiProperty() isOccasion: boolean;
  @ApiProperty({ nullable: true, type: String }) occasionLabel: string | null;
  @ApiProperty({ enum: LinkedCriterion, nullable: true })
  linkedCriterion: LinkedCriterion | null;
  @ApiProperty() isSensitive: boolean;
  @ApiProperty() isSystem: boolean;
  @ApiProperty() isActive: boolean;
}
