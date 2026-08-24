import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

// ── WP Connection Config ─────────────────────────────

class WpCategoryMappingDto {
  @ApiProperty({ description: 'Internal category slug', example: 'ha-noi' })
  @IsString()
  @IsNotEmpty()
  slug: string;

  @ApiProperty({ description: 'WordPress category ID', example: 16 })
  @IsNumber()
  wpCategoryId: number;

  @ApiProperty({ description: 'WordPress category name', example: 'BĐS Hà Nội' })
  @IsString()
  @IsNotEmpty()
  wpCategoryName: string;
}

class WpTagMappingDto {
  @ApiProperty({ description: 'Tag name', example: 'chung cư' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ description: 'WordPress tag ID', example: 1 })
  @IsNumber()
  wpTagId: number;
}

export class UpdateWpConfigDto {
  @ApiPropertyOptional({ description: 'WordPress site URL', example: 'https://example.com' })
  @IsOptional()
  @IsString()
  siteUrl?: string;

  @ApiPropertyOptional({ description: 'WordPress username', example: 'admin' })
  @IsOptional()
  @IsString()
  username?: string;

  @ApiPropertyOptional({ description: 'WordPress Application Password' })
  @IsOptional()
  @IsString()
  appPassword?: string;

  @ApiPropertyOptional({ description: 'Default WordPress category ID', example: 15 })
  @IsOptional()
  @IsNumber()
  defaultCategoryId?: number;

  @ApiPropertyOptional({ description: 'Category mapping from local to WordPress', type: [WpCategoryMappingDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => WpCategoryMappingDto)
  categoryMapping?: WpCategoryMappingDto[];

  @ApiPropertyOptional({ description: 'Default WordPress tag IDs', example: [1, 2, 3] })
  @IsOptional()
  @IsArray()
  @IsNumber({}, { each: true })
  defaultTagIds?: number[];

  @ApiPropertyOptional({ description: 'Tag mapping', type: [WpTagMappingDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => WpTagMappingDto)
  tagMapping?: WpTagMappingDto[];
}

// ── AI Writing Config ────────────────────────────────

class AiWritingTopicDto {
  @ApiProperty({ description: 'Internal slug', example: 'ha-noi' })
  @IsString()
  @IsNotEmpty()
  slug: string;

  @ApiProperty({ description: 'Display name', example: 'BĐS Hà Nội' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ description: 'Topic context for AI', example: 'Thị trường bất động sản Hà Nội' })
  @IsString()
  @IsNotEmpty()
  description: string;
}

export class UpdateAiWritingConfigDto {
  @ApiPropertyOptional({ description: 'Prompt template with {{topic}}, {{category}} placeholders' })
  @IsOptional()
  @IsString()
  promptTemplate?: string;

  @ApiPropertyOptional({ description: 'AI model ID', example: 'google/gemini-2.5-flash' })
  @IsOptional()
  @IsString()
  model?: string;

  @ApiPropertyOptional({ description: 'AI provider', example: 'OpenRouter' })
  @IsOptional()
  @IsString()
  provider?: string;

  @ApiPropertyOptional({ description: 'Max output tokens', example: 4096 })
  @IsOptional()
  @IsNumber()
  maxTokens?: number;

  @ApiPropertyOptional({ description: 'Temperature 0.0-2.0', example: 0.7 })
  @IsOptional()
  @IsNumber()
  temperature?: number;

  @ApiPropertyOptional({ description: 'Topics for rotation', type: [AiWritingTopicDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AiWritingTopicDto)
  topics?: AiWritingTopicDto[];

  @ApiPropertyOptional({ description: 'Default articles per batch', example: 3 })
  @IsOptional()
  @IsNumber()
  articlesPerBatch?: number;
}

// ── AI Image Config ──────────────────────────────────

export class UpdateAiImageConfigDto {
  @ApiPropertyOptional({ description: 'Enable/disable image generation', example: true })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional({ description: 'Image prompt template with {{title}}, {{content_summary}} placeholders' })
  @IsOptional()
  @IsString()
  promptTemplate?: string;

  @ApiPropertyOptional({ description: 'Image generation model' })
  @IsOptional()
  @IsString()
  model?: string;

  @ApiPropertyOptional({ description: 'Image generation provider', example: 'OpenRouter' })
  @IsOptional()
  @IsString()
  provider?: string;

  @ApiPropertyOptional({ description: 'Image width', example: 1024 })
  @IsOptional()
  @IsNumber()
  width?: number;

  @ApiPropertyOptional({ description: 'Image height', example: 1024 })
  @IsOptional()
  @IsNumber()
  height?: number;

  @ApiPropertyOptional({ description: 'Image style', example: 'realistic' })
  @IsOptional()
  @IsString()
  style?: string;
}

// ── Cron Config ──────────────────────────────────────

export class UpdateKnowledgeCronConfigDto {
  @ApiPropertyOptional({ description: 'Enable/disable cron', example: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ description: 'Cron expression', example: '0 8 * * 1-5' })
  @IsOptional()
  @IsString()
  frequency?: string;

  @ApiPropertyOptional({ description: 'Natural language description', example: 'Chạy hàng ngày 8h sáng từ T2-T6' })
  @IsOptional()
  @IsString()
  nlDescription?: string;

  @ApiPropertyOptional({ description: 'AI-parsed cron expression' })
  @IsOptional()
  @IsString()
  parsedCron?: string;
}
