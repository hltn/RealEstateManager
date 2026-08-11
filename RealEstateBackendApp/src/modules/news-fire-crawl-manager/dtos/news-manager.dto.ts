import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
} from 'class-validator';
import { AiPrompt } from '../services/ai-prompt-config.service';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export class UpdateCronConfigDto {
  @ApiProperty({ description: 'Whether the cron job is active' })
  @IsBoolean()
  isActive: boolean;

  @ApiProperty({ description: 'Cron frequency string' })
  @IsString()
  frequency: string;
}

export class BulkIdsDto {
  @ApiProperty({ description: 'Array of record IDs', type: [String] })
  @IsArray()
  @IsString({ each: true })
  ids: string[];
}

export class AnalyzeRawArticlesDto {
  @ApiProperty({
    description: 'Array of raw articles to analyze',
    type: [Object],
  })
  @IsArray()
  articles: Record<string, any>[];
}

export class SaveArticlesDto {
  @ApiProperty({ description: 'Array of articles to save', type: [Object] })
  @IsArray()
  articles: Record<string, any>[];
}

export class TriggerManualAnalyzeDto {
  @ApiProperty({ description: 'Path to the file to analyze' })
  @IsString()
  filePath: string;
}

export class TriggerManualCrawlDto {
  @ApiPropertyOptional({ description: 'Number of days to look back' })
  @IsOptional()
  @IsNumber()
  days?: number;

  @ApiPropertyOptional({ description: 'Start date in YYYY-MM-DD format' })
  @IsOptional()
  @IsString()
  startDate?: string;

  @ApiPropertyOptional({ description: 'End date in YYYY-MM-DD format' })
  @IsOptional()
  @IsString()
  endDate?: string;
}

/**
 * Query cho GET raw-articles: phân trang dùng chung + các filter sẵn có
 * (search theo title/description, sort theo publishedAt, khoảng ngày).
 */
export class GetRawArticlesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Từ khóa tìm trong title/description' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({
    description: 'Thứ tự theo publishedAt',
    enum: ['newest', 'oldest'],
    default: 'newest',
  })
  @IsOptional()
  @IsIn(['newest', 'oldest'], { message: 'sort chỉ nhận newest hoặc oldest' })
  sort?: 'newest' | 'oldest';

  @ApiPropertyOptional({ description: 'Ngày bắt đầu, định dạng YYYY-MM-DD' })
  @IsOptional()
  @IsString()
  startDate?: string;

  @ApiPropertyOptional({ description: 'Ngày kết thúc, định dạng YYYY-MM-DD' })
  @IsOptional()
  @IsString()
  endDate?: string;
}

/** Query cho GET articles: phân trang dùng chung + filter theo 1 ngày cụ thể */
export class GetArticlesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Lọc theo ngày, định dạng YYYY-MM-DD' })
  @IsOptional()
  @IsString()
  date?: string;
}

export class AiPromptDto implements AiPrompt {
  @ApiProperty({ description: 'AI API Name' })
  @IsString()
  @IsNotEmpty()
  api_ai_name: string;

  @ApiProperty({ description: 'AI API Path' })
  @IsString()
  @IsNotEmpty()
  api_ai_path: string;

  @ApiProperty({ description: 'The prompt text' })
  @IsString()
  @IsNotEmpty()
  prompt: string;
}

export class TriggerMarketAnalysisWorkflowDto {
  @ApiPropertyOptional({
    description: 'Ngày phân tích (YYYY-MM-DD). Mặc định: hôm nay (UTC+7).',
    example: '2026-08-06',
  })
  @IsOptional()
  @IsString()
  date?: string;
}
