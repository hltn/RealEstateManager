import { IsOptional, IsString, Matches } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * DTO cho POST /google-drive/export/:historyId.
 * folderUrl là optional — nếu không truyền → tạo Google Doc ở root Drive.
 */
export class ExportAnalysisDto {
  @ApiPropertyOptional({
    description: 'Google Drive folder URL to move the exported document to',
    example: 'https://drive.google.com/drive/folders/abc123',
  })
  @IsOptional()
  @IsString()
  @Matches(
    /^https:\/\/drive\.google\.com\/drive\/(folders|u\/\d+\/folders)\/[a-zA-Z0-9_-]+$/,
    { message: 'Invalid Google Drive folder URL format' },
  )
  folderUrl?: string;
}

/**
 * DTO cho POST /google-drive/folder/validate.
 */
export class FolderValidateDto {
  @ApiPropertyOptional({
    description: 'Google Drive folder URL to validate',
    example: 'https://drive.google.com/drive/folders/abc123',
  })
  @IsString()
  @Matches(
    /^https:\/\/drive\.google\.com\/drive\/(folders|u\/\d+\/folders)\/[a-zA-Z0-9_-]+$/,
    { message: 'Invalid Google Drive folder URL format' },
  )
  folderUrl!: string;
}
