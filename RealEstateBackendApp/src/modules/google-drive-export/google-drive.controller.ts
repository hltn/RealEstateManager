import {
  Controller,
  Delete,
  Get,
  Post,
  Body,
  Param,
  Query,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiOperation, ApiTags, ApiParam } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import type { FastifyReply } from 'fastify';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { JwtPayload } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../common/enums/user-role.enum';
import { GoogleDriveOAuthService } from './services/google-drive-oauth.service';
import { GoogleDriveExportService } from './services/google-drive-export.service';
import { ExportAnalysisDto, FolderValidateDto } from './dtos/google-drive.dto';

/**
 * GoogleDriveController — OAuth + Export + Folder endpoints.
 *
 * Routes:
 *   GET    /google-drive/auth/url       → JwtAuthGuard → return { url }
 *   GET    /google-drive/auth/callback  → @Public()    → exchangeCode → redirect frontend
 *   GET    /google-drive/status         → JwtAuthGuard → return { connected, email, connectedAt }
 *   DELETE /google-drive/disconnect     → JwtAuthGuard → revokeAndDelete
 *   POST   /google-drive/export/:historyId  → JwtAuthGuard + Roles(ADMIN, EDITOR) → export as Google Doc
 *   POST   /google-drive/folder/validate    → JwtAuthGuard → validate folder access
 */
@ApiTags('Google Drive')
@Controller('google-drive')
export class GoogleDriveController {
  constructor(
    private readonly oauthService: GoogleDriveOAuthService,
    private readonly exportService: GoogleDriveExportService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * GET /google-drive/auth/url
   * Trả OAuth2 URL để frontend redirect user sang Google consent screen.
   */
  @Get('auth/url')
  @ApiOperation({ summary: 'Get Google Drive OAuth2 authorization URL' })
  getAuthUrl(@CurrentUser() user: JwtPayload): { url: string } {
    const url = this.oauthService.generateAuthUrl(user.sub);
    return { url };
  }

  /**
   * GET /google-drive/auth/callback
   * Google redirect về đây sau khi user đồng ý.
   * exchange code → lưu token → redirect về frontend.
   *
   * KHÔNG dùng JwtAuthGuard — Google redirect không gửi JWT.
   */
  @Get('auth/callback')
  @Public()
  @ApiOperation({ summary: 'Google OAuth2 callback (Google redirects here)' })
  async handleCallback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Res({ passthrough: false }) reply: FastifyReply,
  ): Promise<void> {
    const frontendUrl =
      this.configService.get<string>('FRONTEND_URL') ||
      'http://localhost:5173';

    try {
      if (!code) {
        throw new UnauthorizedException('Missing authorization code');
      }

      // Validate signed state parameter — extract userId from HMAC-signed state.
      const userId = this.oauthService.validateOAuthState(state);

      await this.oauthService.exchangeCode(code, userId);

      // Redirect về frontend với query gdrive=connected.
      reply.redirect(
        `${frontendUrl}/market-analysis-workflow?gdrive=connected`,
      );
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'OAuth callback failed';
      reply.redirect(
        `${frontendUrl}/market-analysis-workflow?gdrive=error&message=${encodeURIComponent(message)}`,
      );
    }
  }

  /**
   * GET /google-drive/status
   * Kiểm tra user đã kết nối Google Drive chưa.
   */
  @Get('status')
  @ApiOperation({ summary: 'Check Google Drive connection status' })
  async getStatus(@CurrentUser() user: JwtPayload) {
    return this.oauthService.getTokenInfo(user.sub);
  }

  /**
   * DELETE /google-drive/disconnect
   * Ngắt kết nối Google Drive — revoke trên Google + xóa DB.
   */
  @Delete('disconnect')
  @ApiOperation({ summary: 'Disconnect Google Drive (revoke + delete token)' })
  async disconnect(@CurrentUser() user: JwtPayload) {
    await this.oauthService.revokeAndDelete(user.sub);
    return { message: 'Google Drive disconnected successfully' };
  }

  // ─── Export endpoints ─────────────────────────────────────────────────────

  /**
   * POST /google-drive/export/:historyId
   * Export MarketAnalysisHistory content as a Google Doc.
   *
   * Flow:
   *   1. Load history by ID
   *   2. Create Google Doc with title "Báo cáo phân tích thị trường - {date}"
   *   3. Convert markdown → Docs API requests
   *   4. BatchUpdate to populate content
   *   5. Optionally move to target folder
   *   6. Return { documentId, documentUrl, title, folderUrl }
   */
  @Post('export/:historyId')
  @Roles(UserRole.ADMIN, UserRole.EDITOR)
  @ApiOperation({
    summary: 'Export market analysis as Google Doc',
    description:
      'Export a MarketAnalysisHistory record as a formatted Google Doc. ' +
      'Optionally provide a folderUrl to move the document into a specific folder.',
  })
  @ApiParam({
    name: 'historyId',
    description: 'MarketAnalysisHistory document ID',
  })
  async exportAnalysis(
    @CurrentUser() user: JwtPayload,
    @Param('historyId') historyId: string,
    @Body() dto: ExportAnalysisDto,
  ) {
    const result = await this.exportService.exportAnalysis(
      user.sub,
      historyId,
      dto.folderUrl,
    );
    return {
      message: 'Export successful',
      data: result,
    };
  }

  /**
   * POST /google-drive/folder/validate
   * Validate that a Google Drive folder URL is accessible by the user.
   */
  @Post('folder/validate')
  @ApiOperation({
    summary: 'Validate Google Drive folder access',
    description:
      'Check if the authenticated user can access the specified Google Drive folder.',
  })
  async validateFolder(
    @CurrentUser() user: JwtPayload,
    @Body() dto: FolderValidateDto,
  ) {
    return this.exportService.validateFolder(user.sub, dto.folderUrl);
  }
}
