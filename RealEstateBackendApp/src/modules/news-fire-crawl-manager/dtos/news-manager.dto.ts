import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsNumber, IsOptional, IsString } from 'class-validator';
import { AiPrompt } from '../services/ai-prompt-config.service';

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
  @ApiProperty({ description: 'Array of raw articles to analyze', type: [Object] })
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

export class AiPromptDto implements AiPrompt {
  @ApiProperty({ description: 'AI API Name' })
  @IsString()
  api_ai_name: string;

  @ApiProperty({ description: 'AI API Path' })
  @IsString()
  api_ai_path: string;

  @ApiProperty({ description: 'The prompt text' })
  @IsString()
  prompt: string;
}
