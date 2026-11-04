import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { OptionalNotNull } from '../../../../common/decorators/optional-not-null.decorator';
import { ToBoolean } from '../../../../common/decorators/to-boolean.decorator';
import { Trim } from '../../../../common/decorators/trim.decorator';
import { CATALOG_CODE_PATTERN, ListGroup } from '../catalog.enums';
import { CatalogPaginationQueryDto } from './catalog-common.dto';

const MAX_ORDER = 10_000;

export class CreateCustomerStatusDto {
  @ApiProperty({
    example: 'APPOINTED',
    description: 'Mã bất biến: chữ HOA, số, "_"',
  })
  @Trim()
  @Matches(CATALOG_CODE_PATTERN, {
    message: 'code gồm chữ HOA, số, "_", bắt đầu bằng chữ, tối đa 30 ký tự',
  })
  code: string;

  @ApiProperty({ example: 'Đã hẹn gặp', maxLength: 100 })
  @Trim()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  label: string;

  @ApiProperty({
    enum: ListGroup,
    description: 'Nhóm danh sách mà khách sẽ xuất hiện',
  })
  @IsEnum(ListGroup)
  listGroup: ListGroup;

  @ApiPropertyOptional({ example: 'success', maxLength: 30 })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(30)
  color?: string;

  @ApiPropertyOptional({ minimum: 0, maximum: MAX_ORDER })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(MAX_ORDER)
  order?: number;
}

export class UpdateCustomerStatusDto {
  @ApiPropertyOptional({ maxLength: 100 })
  @OptionalNotNull()
  @Trim()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  label?: string;

  @ApiPropertyOptional({ maxLength: 30 })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(30)
  color?: string;

  @ApiPropertyOptional({ minimum: 0, maximum: MAX_ORDER })
  @OptionalNotNull()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(MAX_ORDER)
  order?: number;

  @ApiPropertyOptional({
    enum: ListGroup,
    description: 'Không đổi được với tình trạng hệ thống (isSystem)',
  })
  @OptionalNotNull()
  @IsEnum(ListGroup)
  listGroup?: ListGroup;

  @ApiPropertyOptional({
    description:
      'Đặt làm tình trạng mặc định của khách mới (phải thuộc nhóm NOT_CONTACTED)',
  })
  @OptionalNotNull()
  @IsBoolean()
  isDefault?: boolean;

  @ApiPropertyOptional()
  @OptionalNotNull()
  @IsBoolean()
  isActive?: boolean;
}

export class ListCustomerStatusesQueryDto extends CatalogPaginationQueryDto {
  @ApiPropertyOptional({ enum: ListGroup })
  @IsOptional()
  @IsEnum(ListGroup)
  listGroup?: ListGroup;

  @ApiPropertyOptional()
  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  isActive?: boolean;
}

export class CustomerStatusResponseDto {
  @ApiProperty() id: string;
  @ApiProperty({ example: 'NOT_CONTACTED' }) code: string;
  @ApiProperty({ example: 'Chưa tiếp cận' }) label: string;
  @ApiProperty({ enum: ListGroup }) listGroup: ListGroup;
  @ApiProperty({ nullable: true, type: String, example: 'gray' }) color:
    | string
    | null;
  @ApiProperty() order: number;
  @ApiProperty() isDefault: boolean;
  @ApiProperty() isSystem: boolean;
  @ApiProperty() isActive: boolean;
}
