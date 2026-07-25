import { IsString, IsNotEmpty, IsOptional, IsBoolean, IsObject } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateNewsSourceDto {
  @ApiProperty({ description: 'The name of the news source' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ description: 'The base URL of the news source' })
  @IsString()
  @IsNotEmpty()
  url: string;

  @ApiProperty({ description: 'The RSS Feed URL of the news source', required: false })
  @IsString()
  @IsOptional()
  rssUrl?: string;

  @ApiProperty({ description: 'Crawl configuration mapping', required: false })
  @IsObject()
  @IsOptional()
  crawlConfig?: Record<string, any>;

  @ApiProperty({ description: 'Is the source active?', required: false })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}

export class UpdateNewsSourceDto {
  @ApiProperty({ description: 'The name of the news source', required: false })
  @IsString()
  @IsOptional()
  name?: string;

  @ApiProperty({ description: 'The base URL of the news source', required: false })
  @IsString()
  @IsOptional()
  url?: string;

  @ApiProperty({ description: 'The RSS Feed URL of the news source', required: false })
  @IsString()
  @IsOptional()
  rssUrl?: string;

  @ApiProperty({ description: 'Crawl configuration mapping', required: false })
  @IsObject()
  @IsOptional()
  crawlConfig?: Record<string, any>;

  @ApiProperty({ description: 'Is the source active?', required: false })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
