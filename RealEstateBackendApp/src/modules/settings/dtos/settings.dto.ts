import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Matches } from 'class-validator';
import { Transform } from 'class-transformer';

/**
 * Regex chống env injection: value không được chứa ký tự xuống dòng (\r, \n).
 * Khi `updateAiConfig` ghi `process.env[key]=value` + `KEY=value` vào file .env,
 * newline trong value có thể chèn thêm biến môi trường độc hại.
 */
const NO_NEWLINE_REGEX = /^[^\r\n]*$/;
const NO_NEWLINE_MSG =
  'giá trị không được chứa ký tự xuống dòng (chống env injection)';

/** Chỉ trim khi value là string, tránh ném TypeError với non-string input. */
const trimIfString = () =>
  Transform(({ value }) => (typeof value === 'string' ? value.trim() : value));

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
  @Matches(NO_NEWLINE_REGEX, { message: NO_NEWLINE_MSG })
  @trimIfString()
  apiKey?: string;

  @ApiPropertyOptional({
    description: 'The API key for Must1C provider',
    example: '...',
  })
  @IsOptional()
  @IsString()
  @Matches(NO_NEWLINE_REGEX, { message: NO_NEWLINE_MSG })
  @trimIfString()
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
