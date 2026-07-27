import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateAiConfigDto {
  @ApiPropertyOptional({
    description: 'The AI provider name',
    example: 'openai',
  })
  provider?: string;

  @ApiPropertyOptional({
    description: 'The default AI model',
    example: 'gpt-4',
  })
  model?: string;

  @ApiPropertyOptional({
    description: 'The API key for the provider',
    example: 'sk-...',
  })
  apiKey?: string;

  @ApiPropertyOptional({
    description: 'The API key for Must1C provider',
    example: '...',
  })
  must1cApiKey?: string;

  @ApiPropertyOptional({
    description: 'The model for Must1C provider',
    example: '...',
  })
  must1cModel?: string;

  @ApiPropertyOptional({
    description: 'The currently active platform',
    example: 'must1c',
  })
  activePlatform?: string;
}
