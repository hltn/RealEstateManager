import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AiPrompt } from '../services/ai-prompt-config.service';

export class UpdateCronConfigDto {
  @ApiProperty({ description: 'Whether the cron job is active' })
  isActive: boolean;

  @ApiProperty({ description: 'Cron frequency string' })
  frequency: string;
}

export class BulkIdsDto {
  @ApiProperty({ description: 'Array of record IDs', type: [String] })
  ids: string[];
}

export class AnalyzeRawArticlesDto {
  @ApiProperty({ description: 'Array of raw articles to analyze', type: [Object] })
  articles: Record<string, any>[];
}

export class SaveArticlesDto {
  @ApiProperty({ description: 'Array of articles to save', type: [Object] })
  articles: Record<string, any>[];
}

export class TriggerManualAnalyzeDto {
  @ApiProperty({ description: 'Path to the file to analyze' })
  filePath: string;
}

export class TriggerManualCrawlDto {
  @ApiPropertyOptional({ description: 'Number of days to look back' })
  days?: number;

  @ApiPropertyOptional({ description: 'Start date in YYYY-MM-DD format' })
  startDate?: string;

  @ApiPropertyOptional({ description: 'End date in YYYY-MM-DD format' })
  endDate?: string;
}

export class AiPromptDto implements AiPrompt {
  @ApiProperty({ description: 'AI API Name' })
  api_ai_name: string;

  @ApiProperty({ description: 'AI API Path' })
  api_ai_path: string;

  @ApiProperty({ description: 'The prompt text' })
  prompt: string;
}
