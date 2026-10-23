import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsMongoId,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { OptionalNotNull } from '../../../../common/decorators/optional-not-null.decorator';
import { ToBoolean } from '../../../../common/decorators/to-boolean.decorator';
import { Trim } from '../../../../common/decorators/trim.decorator';
import { RefDto } from '../../../../common/dto/ref.dto';
import { AreaType } from '../catalog.enums';
import { CatalogPaginationQueryDto } from './catalog-common.dto';

const MAX_ORDER = 10_000;
/** Giá trị đặc biệt của `parentId` khi lọc: chỉ lấy khu vực gốc (không có cha). */
export const AREA_ROOT_FILTER = 'root';

export class CreateAreaDto {
  @ApiProperty({ example: 'Quận 7', maxLength: 150 })
  @Trim()
  @IsString()
  @MinLength(1)
  @MaxLength(150)
  name: string;

  @ApiProperty({ enum: AreaType })
  @IsEnum(AreaType)
  type: AreaType;

  @ApiPropertyOptional({
    description: 'Id khu vực cha; bỏ trống = khu vực gốc',
  })
  @IsOptional()
  @IsMongoId()
  parentId?: string;

  @ApiPropertyOptional({ maxLength: 30, description: 'Mã đơn vị hành chính' })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(30)
  adminCode?: string;

  @ApiPropertyOptional({ minimum: 0, maximum: MAX_ORDER })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(MAX_ORDER)
  order?: number;
}

export class UpdateAreaDto {
  @ApiPropertyOptional({ maxLength: 150 })
  @OptionalNotNull()
  @Trim()
  @IsString()
  @MinLength(1)
  @MaxLength(150)
  name?: string;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: 'Id khu vực cha mới; null = chuyển thành khu vực gốc',
  })
  @IsOptional()
  @ValidateIf((_obj, value) => value !== null)
  @IsMongoId()
  parentId?: string | null;

  @ApiPropertyOptional()
  @OptionalNotNull()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional()
  @OptionalNotNull()
  @IsBoolean()
  isLegacy?: boolean;

  @ApiPropertyOptional({ minimum: 0, maximum: MAX_ORDER })
  @OptionalNotNull()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(MAX_ORDER)
  order?: number;
}

export class ListAreasQueryDto extends CatalogPaginationQueryDto {
  @ApiPropertyOptional({
    description: `Id khu vực cha (lấy con trực tiếp) hoặc "${AREA_ROOT_FILTER}" (chỉ khu vực gốc); bỏ trống = phẳng`,
  })
  @IsOptional()
  @Trim()
  @IsString()
  parentId?: string;

  @ApiPropertyOptional({ enum: AreaType })
  @IsOptional()
  @IsEnum(AreaType)
  type?: AreaType;

  @ApiPropertyOptional({
    description: 'Tìm theo tên (không phân biệt dấu)',
    maxLength: 100,
  })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(100)
  q?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({
    description: 'Gồm cả khu vực hành chính cũ (mặc định false)',
  })
  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  includeLegacy?: boolean;
}

export class AreaResponseDto {
  @ApiProperty() id: string;
  @ApiProperty({ description: 'Tên khu vực (đóng vai trò `label` của Ref)' })
  label: string;
  @ApiProperty() name: string;
  @ApiProperty({ enum: AreaType }) type: AreaType;
  @ApiProperty({ nullable: true, type: String }) parentId: string | null;
  @ApiProperty({
    type: [RefDto],
    description: 'Tổ tiên từ gốc tới cha trực tiếp',
  })
  path: RefDto[];
  @ApiProperty({ nullable: true, type: String }) adminCode: string | null;
  @ApiProperty() isLegacy: boolean;
  @ApiProperty() order: number;
  @ApiProperty() isActive: boolean;
}
