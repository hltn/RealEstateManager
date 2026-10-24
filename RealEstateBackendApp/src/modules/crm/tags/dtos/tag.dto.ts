import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsMongoId,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { OptionalNotNull } from '../../../../common/decorators/optional-not-null.decorator';
import { Trim } from '../../../../common/decorators/trim.decorator';
import { CatalogPaginationQueryDto } from '../../catalogs/dtos/catalog-common.dto';
import {
  TAG_COLOR_PATTERN,
  TAG_NAME_MAX_LENGTH,
  TagCategory,
} from '../tag.constants';

export class CreateTagDto {
  @ApiProperty({
    maxLength: TAG_NAME_MAX_LENGTH,
    description:
      'Trùng tên đã chuẩn hóa (không dấu, không phân biệt hoa thường) trong cùng nhóm thì trả thẻ có sẵn',
  })
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(TAG_NAME_MAX_LENGTH)
  name: string;

  @ApiProperty({ enum: TagCategory })
  @IsEnum(TagCategory)
  category: TagCategory;
}

/** Sửa thẻ hoặc gộp vào thẻ khác (`mergeIntoId` không đi kèm field khác). */
export class UpdateTagDto {
  @ApiPropertyOptional({ maxLength: TAG_NAME_MAX_LENGTH })
  @OptionalNotNull()
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(TAG_NAME_MAX_LENGTH)
  name?: string;

  @ApiPropertyOptional({ enum: TagCategory })
  @OptionalNotNull()
  @IsEnum(TagCategory)
  category?: TagCategory;

  @ApiPropertyOptional({
    nullable: true,
    type: String,
    example: '#3b82f6',
    description: 'Mã màu #RRGGBB hoặc tên màu thiết kế; null = bỏ màu',
  })
  @IsOptional()
  @Matches(TAG_COLOR_PATTERN, { message: 'color không hợp lệ' })
  color?: string | null;

  @ApiPropertyOptional({
    description:
      'Gộp thẻ này vào thẻ khác: khách đang gắn thẻ này chuyển sang thẻ đích, thẻ này bị xóa mềm',
  })
  @OptionalNotNull()
  @IsMongoId()
  mergeIntoId?: string;
}

export class ListTagsQueryDto extends CatalogPaginationQueryDto {
  @ApiPropertyOptional({
    description: 'Gợi ý khi gõ (không dấu, chứa từ khóa)',
    maxLength: TAG_NAME_MAX_LENGTH,
  })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(TAG_NAME_MAX_LENGTH)
  q?: string;

  @ApiPropertyOptional({ enum: TagCategory })
  @IsOptional()
  @IsEnum(TagCategory)
  category?: TagCategory;

  @ApiPropertyOptional({
    description: 'name | usageCount, tiền tố "-" = giảm dần (mặc định name)',
    example: '-usageCount',
  })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  sort?: string;
}

export class TagResponseDto {
  @ApiProperty() id: string;
  @ApiProperty({ description: 'Tên thẻ' }) label: string;
  @ApiProperty({ enum: TagCategory }) category: TagCategory;
  @ApiProperty({ description: 'Số khách đang gắn thẻ' }) usageCount: number;
  @ApiProperty({ nullable: true, type: String }) color: string | null;
}
