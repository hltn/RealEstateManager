import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { google, docs_v1 as DocsV1 } from 'googleapis';
import {
  MarketAnalysisHistory,
  MarketAnalysisHistoryDocument,
} from '../../news-fire-crawl-manager/schemas/market-analysis-history.schema';
import { GoogleDriveOAuthService } from './google-drive-oauth.service';
import { MarkdownToGoogleDocsConverter } from './markdown-to-docs.converter';

/**
 * Export result returned after successful Google Doc creation.
 */
export interface ExportResult {
  documentId: string;
  documentUrl: string;
  title: string;
  folderUrl?: string;
}

/**
 * Folder validation result.
 */
export interface FolderValidation {
  valid: boolean;
  folderId: string;
  folderName: string;
}

/**
 * GoogleDriveExportService — export MarketAnalysisHistory as Google Doc.
 *
 * Flow:
 *   1. Load history by ID (404 if missing)
 *   2. Get OAuth2Client from OAuthService (401 if not connected)
 *   3. Create Google Doc with auto-generated title
 *   4. Convert markdown content → Docs API requests
 *   5. Execute batchUpdate to populate content
 *   6. Optionally move to target folder
 *   7. Return { documentId, documentUrl, title, folderUrl }
 */
@Injectable()
export class GoogleDriveExportService {
  private readonly logger = new Logger(GoogleDriveExportService.name);

  constructor(
    @InjectModel(MarketAnalysisHistory.name)
    private readonly historyModel: Model<MarketAnalysisHistoryDocument>,
    private readonly oauthService: GoogleDriveOAuthService,
  ) {}

  /**
   * Export a MarketAnalysisHistory record as a Google Doc.
   *
   * @param userId - Authenticated user's ID (from JWT payload.sub)
   * @param historyId - MarketAnalysisHistory document ID
   * @param folderUrl - Optional Google Drive folder URL to move the doc into
   * @returns ExportResult with documentId, URL, title, and folderUrl
   * @throws NotFoundException if history not found
   * @throws UnauthorizedException if Google Drive not connected
   * @throws BadRequestException if folder URL is invalid or inaccessible
   */
  async exportAnalysis(
    userId: string,
    historyId: string,
    folderUrl?: string,
  ): Promise<ExportResult> {
    // 1. Load history record.
    const history = await this.historyModel.findById(historyId).lean().exec();
    if (!history) {
      throw new NotFoundException(
        `Market analysis history not found: ${historyId}`,
      );
    }

    // 2. Get OAuth2Client (throws UnauthorizedException if not connected).
    const oauth2Client = await this.oauthService.getOAuth2Client(userId);

    // 3. Parse optional folder URL.
    let folderId: string | null = null;
    if (folderUrl) {
      folderId = this.parseFolderId(folderUrl);
      if (!folderId) {
        throw new BadRequestException(
          'Invalid Google Drive folder URL format',
        );
      }

      // Validate folder access.
      const folderInfo = await this.validateFolderAccess(
        oauth2Client,
        folderId,
      );
      if (!folderInfo.valid) {
        throw new BadRequestException(
          `Cannot access folder: ${folderId}. Check permissions.`,
        );
      }
    }

    // 4. Generate document title.
    const title = this.generateTitle();

    // 5. Create Google Doc.
    const docsClient = google.docs({ version: 'v1', auth: oauth2Client as any });
    const driveClient = google.drive({ version: 'v3', auth: oauth2Client as any });

    const createResponse = await docsClient.documents.create({
      requestBody: { title },
    });

    const documentId = createResponse.data.documentId ?? '';
    if (!documentId) {
      throw new BadRequestException('Failed to create Google Doc: no documentId returned');
    }
    this.logger.log(`Created Google Doc: ${documentId}`);

    // 6. Convert markdown → Docs API requests.
    const requests = MarkdownToGoogleDocsConverter.convert(history.content);

    // 7. Execute batchUpdate (only if there's content to insert).
    if (requests.length > 0) {
      await docsClient.documents.batchUpdate({
        documentId,
        requestBody: { requests: requests as DocsV1.Schema$Request[] },
      });
      this.logger.log(
        `BatchUpdate completed: ${requests.length} requests for doc ${documentId}`,
      );
    }

    // 8. Move to folder if specified.
    if (folderId) {
      await driveClient.files.update({
        fileId: documentId,
        addParents: folderId,
        fields: 'id, parents',
      });
      this.logger.log(`Moved doc ${documentId} to folder ${folderId}`);
    }

    // 9. Build result.
    const documentUrl = `https://docs.google.com/document/d/${documentId}/edit`;

    return {
      documentId,
      documentUrl,
      title,
      folderUrl: folderUrl ?? undefined,
    };
  }

  /**
   * Validate that a Google Drive folder URL points to an accessible folder.
   *
   * @param userId - Authenticated user's ID
   * @param folderUrl - Full Google Drive folder URL
   * @returns FolderValidation with valid flag, folderId, and folderName
   * @throws BadRequestException if URL format is invalid
   */
  async validateFolder(
    userId: string,
    folderUrl: string,
  ): Promise<FolderValidation> {
    const folderId = this.parseFolderId(folderUrl);
    if (!folderId) {
      throw new BadRequestException(
        'Invalid Google Drive folder URL format',
      );
    }

    const oauth2Client = await this.oauthService.getOAuth2Client(userId);
    return this.validateFolderAccess(oauth2Client, folderId);
  }

  // ─── Private helpers ─────────────────────────────────────────────────────

  /**
   * Extract folder ID from Google Drive folder URL.
   * Supports formats:
   *   - https://drive.google.com/drive/folders/{folderId}
   *   - https://drive.google.com/drive/u/0/folders/{folderId}
   *
   * @returns folderId string or null if URL doesn't match
   */
  private parseFolderId(folderUrl: string): string | null {
    const match = folderUrl.match(
      /\/drive\/(?:u\/\d+\/)?folders\/([a-zA-Z0-9_-]+)/,
    );
    return match?.[1] ?? null;
  }

  /**
   * Validate folder access via Drive API.
   * Fetches file metadata — 404/403 means inaccessible.
   */
  private async validateFolderAccess(
    oauth2Client: any,
    folderId: string,
  ): Promise<FolderValidation> {
    try {
      const driveClient = google.drive({ version: 'v3', auth: oauth2Client as any });
      const response = await driveClient.files.get({
        fileId: folderId,
        fields: 'id, name, mimeType',
        supportsAllDrives: true,
      });

      const isFolder = response.data.mimeType === 'application/vnd.google-apps.folder';
      if (!isFolder) {
        return { valid: false, folderId, folderName: '' };
      }

      return {
        valid: true,
        folderId: response.data.id!,
        folderName: response.data.name ?? '',
      };
    } catch (err: any) {
      this.logger.warn(
        `Folder validation failed for ${folderId}: ${err.message}`,
      );
      return { valid: false, folderId, folderName: '' };
    }
  }

  /**
   * Generate document title with current date in Vietnamese format.
   * Example: "Báo cáo phân tích thị trường - 15/08/2026"
   */
  private generateTitle(): string {
    const now = new Date();
    const day = String(now.getDate()).padStart(2, '0');
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const year = now.getFullYear();
    return `Báo cáo phân tích thị trường - ${day}/${month}/${year}`;
  }
}
