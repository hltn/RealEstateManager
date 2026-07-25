import { IsArray, IsString, IsNotEmpty, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AnalyzeRawArticlesDto {
  @ApiProperty({ description: 'List of raw articles to analyze', type: [Object] })
  @IsArray()
  articles: any[];
}

export class AnalyzeMarketTrendsDto {
  @ApiProperty({ description: 'List of article IDs', type: [String] })
  @IsArray()
  @IsString({ each: true })
  ids: string[];
}

export class SaveArticlesDto {
  @ApiProperty({ description: 'List of articles to save', type: [Object] })
  @IsArray()
  articles: any[];
}

export class BulkActionDto {
  @ApiProperty({ description: 'List of article IDs', type: [String] })
  @IsArray()
  @IsString({ each: true })
  ids: string[];
}
