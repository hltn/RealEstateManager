import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  GoogleDriveToken,
  GoogleDriveTokenSchema,
} from './schemas/google-drive-token.schema';
import {
  MarketAnalysisHistory,
  MarketAnalysisHistorySchema,
} from '../news-fire-crawl-manager/schemas/market-analysis-history.schema';
import { GoogleDriveOAuthService } from './services/google-drive-oauth.service';
import { GoogleDriveExportService } from './services/google-drive-export.service';
import { GoogleDriveController } from './google-drive.controller';

/**
 * GoogleDriveExportModule — OAuth2 flow + Google Drive integration + Export.
 *
 * Providers:
 *   - GoogleDriveOAuthService: OAuth2 token management (auth/url, callback, status, disconnect)
 *   - GoogleDriveExportService: Export MarketAnalysisHistory as Google Doc
 *
 * Không @Global — import tường minh để lộ rõ dependency graph.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: GoogleDriveToken.name, schema: GoogleDriveTokenSchema },
      { name: MarketAnalysisHistory.name, schema: MarketAnalysisHistorySchema },
    ]),
  ],
  controllers: [GoogleDriveController],
  providers: [GoogleDriveOAuthService, GoogleDriveExportService],
  exports: [GoogleDriveOAuthService, GoogleDriveExportService],
})
export class GoogleDriveExportModule {}
