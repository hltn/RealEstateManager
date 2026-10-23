import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsMongoId,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { ToBoolean } from '../../../../common/decorators/to-boolean.decorator';
import { Trim } from '../../../../common/decorators/trim.decorator';
import { RefDto } from '../../../../common/dto/ref.dto';
import { CatalogPaginationQueryDto } from '../../catalogs/dtos/catalog-common.dto';
import {
  PROJECT_CODE_PATTERN,
  PROJECT_DESCRIPTION_MAX_LENGTH,
  PROJECT_NAME_MAX_LENGTH,
  PROJECT_TEXT_MAX_LENGTH,
  PROJECT_TYPES_MAX_COUNT,
  ProjectStatus,
} from '../project.rules';

const PRICE_OPTIONS = { allowNaN: false, allowInfinity: false } as const;
const CODE_MESSAGE =
  'Mã dự án chỉ gồm chữ không dấu, số, "-" hoặc "_", tối đa 20 ký tự';

/**
 * Thêm dự án (Quản trị). `code` bắt buộc, duy nhất không phân biệt hoa thường kể cả dự án đã xóa mềm.
 * `priceFrom <= priceTo` được kiểm ở service (cần so hai field, và với PATCH còn phải so với giá trị hiện có).
 */
export class CreateProjectDto {
  @ApiProperty({ example: "Q'Terra", maxLength: PROJECT_NAME_MAX_LENGTH })
  @Trim()
  @IsString()
  @MinLength(1)
  @MaxLength(PROJECT_NAME_MAX_LENGTH)
  name: string;

  @ApiProperty({
    example: 'QTERRA',
    pattern: PROJECT_CODE_PATTERN.source,
    description:
      'Chữ, số, "-", "_", tối đa 20 ký tự; duy nhất không phân biệt hoa thường',
  })
  @Trim()
  @Matches(PROJECT_CODE_PATTERN, { message: CODE_MESSAGE })
  code: string;

  @ApiPropertyOptional({
    maxLength: PROJECT_TEXT_MAX_LENGTH,
    example: 'STND Group',
  })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(PROJECT_TEXT_MAX_LENGTH)
  developer?: string | null;

  @ApiPropertyOptional({
    maxLength: PROJECT_TEXT_MAX_LENGTH,
    example: 'Thủ Đức, TP.HCM',
  })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(PROJECT_TEXT_MAX_LENGTH)
  location?: string | null;

  @ApiPropertyOptional({ type: String, description: 'Id khu vực (areas)' })
  @IsOptional()
  @IsMongoId()
  areaId?: string | null;

  @ApiPropertyOptional({
    type: [String],
    maxItems: PROJECT_TYPES_MAX_COUNT,
    example: ['Căn hộ', 'Shophouse'],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(PROJECT_TYPES_MAX_COUNT)
  @IsString({ each: true })
  @MaxLength(PROJECT_TEXT_MAX_LENGTH, { each: true })
  propertyTypes?: string[];

  @ApiPropertyOptional({
    type: Number,
    minimum: 0,
    description: 'Giá từ (VNĐ)',
  })
  @IsOptional()
  @IsNumber(PRICE_OPTIONS)
  @Min(0)
  priceFrom?: number | null;

  @ApiPropertyOptional({
    type: Number,
    minimum: 0,
    description: 'Giá đến (VNĐ), >= priceFrom',
  })
  @IsOptional()
  @IsNumber(PRICE_OPTIONS)
  @Min(0)
  priceTo?: number | null;

  @ApiPropertyOptional({ enum: ProjectStatus, default: ProjectStatus.UPCOMING })
  @IsOptional()
  @IsEnum(ProjectStatus)
  status?: ProjectStatus;

  @ApiPropertyOptional({ maxLength: PROJECT_DESCRIPTION_MAX_LENGTH })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(PROJECT_DESCRIPTION_MAX_LENGTH)
  description?: string | null;
}

/**
 * Sửa dự án: mọi field tùy chọn. `null` xóa giá trị của field không bắt buộc (developer, location, areaId,
 * giá, mô tả); với `name`/`code`/`status`/`isActive` service từ chối `null`.
 * `isActive=false` = ngừng hoạt động.
 */
export class UpdateProjectDto {
  @ApiPropertyOptional({ maxLength: PROJECT_NAME_MAX_LENGTH })
  @IsOptional()
  @Trim()
  @IsString()
  @MinLength(1)
  @MaxLength(PROJECT_NAME_MAX_LENGTH)
  name?: string;

  @ApiPropertyOptional({ pattern: PROJECT_CODE_PATTERN.source })
  @IsOptional()
  @Trim()
  @Matches(PROJECT_CODE_PATTERN, { message: CODE_MESSAGE })
  code?: string;

  @ApiPropertyOptional({
    maxLength: PROJECT_TEXT_MAX_LENGTH,
    nullable: true,
    type: String,
  })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(PROJECT_TEXT_MAX_LENGTH)
  developer?: string | null;

  @ApiPropertyOptional({
    maxLength: PROJECT_TEXT_MAX_LENGTH,
    nullable: true,
    type: String,
  })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(PROJECT_TEXT_MAX_LENGTH)
  location?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @IsMongoId()
  areaId?: string | null;

  @ApiPropertyOptional({ type: [String], maxItems: PROJECT_TYPES_MAX_COUNT })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(PROJECT_TYPES_MAX_COUNT)
  @IsString({ each: true })
  @MaxLength(PROJECT_TEXT_MAX_LENGTH, { each: true })
  propertyTypes?: string[];

  @ApiPropertyOptional({ type: Number, nullable: true, minimum: 0 })
  @IsOptional()
  @IsNumber(PRICE_OPTIONS)
  @Min(0)
  priceFrom?: number | null;

  @ApiPropertyOptional({ type: Number, nullable: true, minimum: 0 })
  @IsOptional()
  @IsNumber(PRICE_OPTIONS)
  @Min(0)
  priceTo?: number | null;

  @ApiPropertyOptional({ enum: ProjectStatus })
  @IsOptional()
  @IsEnum(ProjectStatus)
  status?: ProjectStatus;

  @ApiPropertyOptional({
    maxLength: PROJECT_DESCRIPTION_MAX_LENGTH,
    nullable: true,
    type: String,
  })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(PROJECT_DESCRIPTION_MAX_LENGTH)
  description?: string | null;

  @ApiPropertyOptional({
    description:
      'false = ngừng hoạt động (ẩn khỏi ô chọn mới, khách cũ giữ liên kết)',
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class ListProjectsQueryDto extends CatalogPaginationQueryDto {
  @ApiPropertyOptional({
    description: 'Tìm theo tên, mã, chủ đầu tư',
    maxLength: 100,
  })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(100)
  q?: string;

  @ApiPropertyOptional({ enum: ProjectStatus })
  @IsOptional()
  @IsEnum(ProjectStatus)
  status?: ProjectStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsMongoId()
  areaId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({
    description: 'Chỉ Quản trị: true = xem dự án đã xóa mềm',
  })
  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  isDeleted?: boolean;

  @ApiPropertyOptional({
    description: 'name | createdAt, tiền tố "-" = giảm dần (mặc định name)',
    example: '-createdAt',
  })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  sort?: string;
}

export class RestoreProjectDto {
  @ApiProperty({ description: 'Id dự án đã xóa mềm' })
  @IsMongoId()
  projectId: string;

  @ApiPropertyOptional({ maxLength: 300 })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(300)
  reason?: string;
}

export class ProjectResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
  @ApiProperty({ example: 'QTERRA' }) code: string;
  @ApiProperty({ nullable: true, type: String }) developer: string | null;
  @ApiProperty({ nullable: true, type: String }) location: string | null;
  @ApiProperty({ nullable: true, type: RefDto }) area: RefDto | null;
  @ApiProperty({ type: [String] }) propertyTypes: string[];
  @ApiProperty({ nullable: true, type: Number }) priceFrom: number | null;
  @ApiProperty({ nullable: true, type: Number }) priceTo: number | null;
  @ApiProperty({ enum: ProjectStatus }) status: ProjectStatus;
  @ApiProperty() isActive: boolean;
  @ApiProperty({ description: 'Số khách chưa xóa mềm đang quan tâm dự án' })
  customerCount: number;
  @ApiProperty({
    nullable: true,
    type: String,
    description: 'Có giá trị khi dự án đã xóa mềm',
  })
  deletedAt: string | null;
}

export class ProjectDetailResponseDto extends ProjectResponseDto {
  @ApiProperty({ nullable: true, type: String }) description: string | null;
}
