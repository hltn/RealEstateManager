import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class UpdateAiConfigDto {
  @ApiPropertyOptional({
    description: 'The AI provider name',
    example: 'openai',
  })
  @IsOptional()
  @IsString()
  provider?: string;

  @ApiPropertyOptional({
    description: 'The default AI model',
    example: 'gpt-4',
  })
  @IsOptional()
  @IsString()
  model?: string;

  @ApiPropertyOptional({
    description: 'The API key for the provider',
    example: 'sk-...',
  })
  @IsOptional()
  @IsString()
  apiKey?: string;

  @ApiPropertyOptional({
    description: 'The API key for Must1C provider',
    example: '...',
  })
  @IsOptional()
  @IsString()
  must1cApiKey?: string;

  @ApiPropertyOptional({
    description: 'The model for Must1C provider',
    example: '...',
  })
  @IsOptional()
  @IsString()
  must1cModel?: string;

  @ApiPropertyOptional({
    description: 'The currently active platform',
    example: 'must1c',
  })
  @IsOptional()
  @IsString()
  activePlatform?: string;
}
