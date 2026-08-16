import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { KnowledgeArticleState } from '../types/knowledge-article-state';

// ── List Query ───────────────────────────────────────

export class GetKnowledgeArticlesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description: 'Filter by pipeline state',
    enum: KnowledgeArticleState,
  })
  @IsOptional()
  @IsEnum(KnowledgeArticleState)
  status?: KnowledgeArticleState;

  @ApiPropertyOptional({ description: 'Filter by category slug', example: 'ha-noi' })
  @IsOptional()
  @IsString()
  category?: string;

  @ApiPropertyOptional({ description: 'Search in title' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ description: 'Sort order', enum: ['newest', 'oldest'], default: 'newest' })
  @IsOptional()
  @IsIn(['newest', 'oldest'])
  sort?: 'newest' | 'oldest' = 'newest';
}

// ── Bulk Operations ──────────────────────────────────

export class BulkIdsDto {
  @ApiProperty({ description: 'Array of article IDs', type: [String] })
  @IsArray()
  @IsString({ each: true })
  ids: string[];
}

// ── Pipeline ─────────────────────────────────────────

export class RunPipelineDto {
  @ApiPropertyOptional({ description: 'Specific category to generate for' })
  @IsOptional()
  @IsString()
  category?: string;

  @ApiPropertyOptional({ description: 'Number of articles to generate', example: 3, default: 3 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10)
  articleCount?: number = 3;
}

export class GetPipelineLogsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Filter by pipeline status' })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({ description: 'Filter by category slug' })
  @IsOptional()
  @IsString()
  category?: string;
}
