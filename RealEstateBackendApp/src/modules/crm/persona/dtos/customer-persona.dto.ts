import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsDefined,
  IsIn,
  IsInt,
  IsNumber,
  IsString,
  Matches,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { UserRefDto } from '../../../../common/dto/ref.dto';
import { OptionalNotNull } from '../../../../common/decorators/optional-not-null.decorator';
import {
  PERSONA_KEY_PATTERN,
  PERSONA_MAX_MULTI_VALUES,
  PERSONA_MAX_VALUES_PER_REQUEST,
  PERSONA_OPTION_VALUE_MAX_LENGTH,
  PersonaFieldType,
  PersonaSource,
  WRITABLE_PERSONA_SOURCES,
} from '../persona.constants';

/** Trần thô chống payload quá lớn; giới hạn đúng theo kiểu (TEXT 500, TEXTAREA 2000) do service kiểm. */
const VALUE_TEXT_INPUT_MAX_LENGTH = 5000;

/**
 * Giá trị một trường: chỉ gửi các khóa hợp với kiểu trường (TEXT/TEXTAREA: `valueText`; NUMBER: `valueNumber`;
 * NUMBER_RANGE: `valueNumber` + `valueNumberTo`; DATE: `valueDate` YYYY-MM-DD; SELECT/MULTI_SELECT: `valueOptions`;
 * BOOLEAN: `valueBoolean`). Khóa sai kiểu bị từ chối ở service (`PERSONA_VALUE_INVALID`).
 */
export class PersonaValueDto {
  @ApiPropertyOptional()
  @OptionalNotNull()
  @IsString()
  @MaxLength(VALUE_TEXT_INPUT_MAX_LENGTH)
  valueText?: string;

  @ApiPropertyOptional({
    description: 'NUMBER / đầu dưới của NUMBER_RANGE (VNĐ)',
  })
  @OptionalNotNull()
  @IsNumber({ allowNaN: false, allowInfinity: false })
  valueNumber?: number;

  @ApiPropertyOptional({ description: 'Đầu trên của NUMBER_RANGE' })
  @OptionalNotNull()
  @IsNumber({ allowNaN: false, allowInfinity: false })
  valueNumberTo?: number;

  @ApiPropertyOptional({ example: '1990-05-17' })
  @OptionalNotNull()
  @IsString()
  @MaxLength(10)
  valueDate?: string;

  @ApiPropertyOptional({ type: [String], description: 'Mã lựa chọn' })
  @OptionalNotNull()
  @IsArray()
  @ArrayMaxSize(PERSONA_MAX_MULTI_VALUES + 1)
  @IsString({ each: true })
  @MaxLength(PERSONA_OPTION_VALUE_MAX_LENGTH, { each: true })
  valueOptions?: string[];

  @ApiPropertyOptional()
  @OptionalNotNull()
  @IsBoolean()
  valueBoolean?: boolean;
}

export class PersonaValueUpdateItemDto {
  @ApiProperty({ example: 'occupation' })
  @IsString()
  @Matches(PERSONA_KEY_PATTERN, { message: 'fieldKey không hợp lệ' })
  fieldKey: string;

  @ApiProperty({
    type: PersonaValueDto,
    nullable: true,
    description: 'null = xóa giá trị của trường',
  })
  @ValidateIf((_item: unknown, value: unknown) => value !== null)
  @IsDefined()
  @ValidateNested()
  @Type(() => PersonaValueDto)
  value: PersonaValueDto | null;

  @ApiProperty({ enum: WRITABLE_PERSONA_SOURCES })
  @IsIn(WRITABLE_PERSONA_SOURCES as readonly string[])
  source: PersonaSource.CUSTOMER_SHARED | PersonaSource.STAFF_OBSERVED;

  @ApiPropertyOptional({
    description:
      'Bắt buộc true khi trường isSensitive: xác nhận khách tự nguyện chia sẻ',
  })
  @OptionalNotNull()
  @IsBoolean()
  sensitiveAcknowledged?: boolean;
}

export class UpdatePersonaDto {
  @ApiProperty({ description: 'Version hiện tại của hồ sơ khách' })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  version: number;

  @ApiProperty({ type: [PersonaValueUpdateItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(PERSONA_MAX_VALUES_PER_REQUEST)
  @ArrayUnique((item: PersonaValueUpdateItemDto) => item.fieldKey)
  @ValidateNested({ each: true })
  @Type(() => PersonaValueUpdateItemDto)
  values: PersonaValueUpdateItemDto[];
}

export class PersonaFieldValueDto {
  @ApiProperty() fieldKey: string;
  @ApiProperty() label: string;
  @ApiProperty() groupCode: string;
  @ApiProperty({ enum: PersonaFieldType }) type: PersonaFieldType;
  @ApiProperty({ type: PersonaValueDto, nullable: true })
  value: PersonaValueDto | null;
  @ApiProperty({ enum: PersonaSource, nullable: true })
  source: PersonaSource | null;
  @ApiProperty({ nullable: true, type: String }) updatedAt: string | null;
  @ApiProperty({ nullable: true, type: UserRefDto })
  updatedBy: UserRefDto | null;
}

export class PersonaGroupDto {
  @ApiProperty() code: string;
  @ApiProperty() label: string;
  @ApiProperty({ type: [PersonaFieldValueDto] })
  fields: PersonaFieldValueDto[];
}

export class MissingSuggestionDto {
  @ApiProperty() fieldKey: string;
  @ApiProperty() label: string;
  @ApiProperty() groupCode: string;
}

export class CustomerPersonaResponseDto {
  @ApiProperty({ type: [PersonaGroupDto] }) groups: PersonaGroupDto[];
  @ApiProperty({ description: 'Độ đầy đủ 0-100' }) completeness: number;
  @ApiProperty({ type: [MissingSuggestionDto] })
  missingSuggestions: MissingSuggestionDto[];
  @ApiProperty({ description: 'Version hồ sơ để gửi kèm khi PATCH' })
  version: number;
}

export class PersonaUpdateResponseDto {
  @ApiProperty() completeness: number;
  @ApiProperty({ type: [PersonaFieldValueDto] })
  updated: PersonaFieldValueDto[];
  @ApiProperty() version: number;
}
