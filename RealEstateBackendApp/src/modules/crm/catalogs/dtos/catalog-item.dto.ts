import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
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
import { CATALOG_CODE_PATTERN } from '../catalog.enums';
import { CatalogPaginationQueryDto } from './catalog-common.dto';

const MAX_ORDER = 10_000;

/** Tạo nguồn khách: `{ code*, label*, order? }` (tài liệu 05 mục 2.8). */
export class CreateLeadSourceDto {
  @ApiProperty({
    example: 'FACEBOOK_ADS',
    description: 'Mã bất biến: chữ HOA, số, "_"',
  })
  @Trim()
  @Matches(CATALOG_CODE_PATTERN, {
    message: 'code gồm chữ HOA, số, "_", bắt đầu bằng chữ, tối đa 30 ký tự',
  })
  code: string;

  @ApiProperty({ example: 'Facebook Ads', maxLength: 100 })
  @Trim()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  label: string;

  @ApiPropertyOptional({ minimum: 0, maximum: MAX_ORDER })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(MAX_ORDER)
  order?: number;
}

/**
 * Sửa nguồn khách: `{ label?, order?, isActive? }` — không đổi `code`.
 * Mọi field vắng mặt thì giữ nguyên; `null` bị từ chối 400 (không ghi null vào DB).
 */
export class UpdateLeadSourceDto {
  @ApiPropertyOptional({ maxLength: 100 })
  @OptionalNotNull()
  @Trim()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  label?: string;

  @ApiPropertyOptional({ minimum: 0, maximum: MAX_ORDER })
  @OptionalNotNull()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(MAX_ORDER)
  order?: number;

  @ApiPropertyOptional()
  @OptionalNotNull()
  @IsBoolean()
  isActive?: boolean;
}

export class ListLeadSourcesQueryDto extends CatalogPaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ description: 'Tìm theo nhãn hoặc mã', maxLength: 100 })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(100)
  q?: string;
}

export class LeadSourceResponseDto {
  @ApiProperty() id: string;
  @ApiProperty({ example: 'Facebook Ads' }) label: string;
  @ApiProperty({ example: 'FACEBOOK_ADS' }) code: string;
  @ApiProperty() order: number;
  @ApiProperty() isActive: boolean;
}

// ---------------------------------------------------------------------------
// Kết quả liên hệ (CONTACT_RESULT)
// ---------------------------------------------------------------------------

const MAX_FOLLOW_UP_DAYS = 365;

/** Tạo kết quả liên hệ: `{ code*, label*, suggestedFollowUpDays?, suggestionText?, order? }`. */
export class CreateContactResultDto extends CreateLeadSourceDto {
  @ApiPropertyOptional({
    nullable: true,
    description: 'Số ngày gợi ý hẹn lại; bỏ trống hoặc null = không gợi ý',
    minimum: 0,
    maximum: MAX_FOLLOW_UP_DAYS,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(MAX_FOLLOW_UP_DAYS)
  suggestedFollowUpDays?: number | null;

  @ApiPropertyOptional({ maxLength: 300 })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(300)
  suggestionText?: string;
}

/** Sửa kết quả liên hệ: các field của POST trừ `code`, thêm `isActive`. */
export class UpdateContactResultDto extends UpdateLeadSourceDto {
  @ApiPropertyOptional({
    nullable: true,
    description: 'Số ngày gợi ý hẹn lại; null = bỏ gợi ý',
    minimum: 0,
    maximum: MAX_FOLLOW_UP_DAYS,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(MAX_FOLLOW_UP_DAYS)
  suggestedFollowUpDays?: number | null;

  @ApiPropertyOptional({ maxLength: 300 })
  @OptionalNotNull()
  @Trim()
  @IsString()
  @MaxLength(300)
  suggestionText?: string;
}

export class ListContactResultsQueryDto extends CatalogPaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  isActive?: boolean;
}

export class ContactResultResponseDto extends LeadSourceResponseDto {
  @ApiProperty({ nullable: true, type: Number }) suggestedFollowUpDays:
    | number
    | null;
  @ApiProperty() suggestionText: string;
}
