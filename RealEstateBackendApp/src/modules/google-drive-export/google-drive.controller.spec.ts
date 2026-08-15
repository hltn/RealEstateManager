/**
 * GoogleDriveController unit spec.
 *
 * Bao phủ:
 * - getAuthUrl: JwtAuthGuard → return { url }
 * - handleCallback: @Public() → validateOAuthState → exchangeCode → redirect frontend
 * - getStatus: JwtAuthGuard → return { connected, email, connectedAt }
 * - disconnect: JwtAuthGuard → revokeAndDelete → return message
 * - exportAnalysis: JwtAuthGuard + Roles(ADMIN, EDITOR) → export as Google Doc → { message, data }
 * - validateFolder: JwtAuthGuard → validate folder access
 *
 * Mock: GoogleDriveOAuthService, GoogleDriveExportService, ConfigService.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { UnauthorizedException } from '@nestjs/common';
import { GoogleDriveController } from './google-drive.controller';
import { GoogleDriveOAuthService } from './services/google-drive-oauth.service';
import { GoogleDriveExportService } from './services/google-drive-export.service';

describe('GoogleDriveController', () => {
  let controller: GoogleDriveController;
  let oauthService: any;
  let exportService: any;
  let configService: any;

  const MOCK_USER = {
    sub: '65e1f0a1b2c3d4e5f6a7b8c9',
    email: 'user@test.com',
    role: 'EDITOR',
  };

  const SIGNED_STATE = `${MOCK_USER.sub}:abc123nonce:validsignature`;

  beforeEach(async () => {
    jest.clearAllMocks();

    oauthService = {
      generateAuthUrl: jest.fn(),
      validateOAuthState: jest.fn(),
      exchangeCode: jest.fn(),
      getTokenInfo: jest.fn(),
      revokeAndDelete: jest.fn(),
    };
    exportService = {
      exportAnalysis: jest.fn(),
      validateFolder: jest.fn(),
    };
    configService = {
      get: jest.fn((key: string) => {
        if (key === 'FRONTEND_URL') return 'http://localhost:5173';
        return '';
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [GoogleDriveController],
      providers: [
        { provide: GoogleDriveOAuthService, useValue: oauthService },
        { provide: GoogleDriveExportService, useValue: exportService },
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    controller = module.get<GoogleDriveController>(GoogleDriveController);
  });

  describe('getAuthUrl', () => {
    it('returns OAuth2 URL for the authenticated user', () => {
      const expectedUrl =
        'https://accounts.google.com/o/oauth2/v2/auth?...';
      oauthService.generateAuthUrl.mockReturnValue(expectedUrl);

      const result = controller.getAuthUrl(MOCK_USER as any);

      expect(result).toEqual({ url: expectedUrl });
      expect(oauthService.generateAuthUrl).toHaveBeenCalledWith(
        MOCK_USER.sub,
      );
    });
  });

  describe('handleCallback', () => {
    const mockReply = {
      redirect: jest.fn(),
    };
    beforeEach(() => {
      mockReply.redirect.mockClear();
    });

    it('validates signed state, exchanges code, saves token, redirects to frontend with gdrive=connected', async () => {
      oauthService.validateOAuthState.mockReturnValue(MOCK_USER.sub);
      oauthService.exchangeCode.mockResolvedValue({
        userId: MOCK_USER.sub,
        email: 'user@gmail.com',
      });

      await controller.handleCallback(
        'auth-code-123',
        SIGNED_STATE,
        mockReply as any,
      );

      expect(oauthService.validateOAuthState).toHaveBeenCalledWith(
        SIGNED_STATE,
      );
      expect(oauthService.exchangeCode).toHaveBeenCalledWith(
        'auth-code-123',
        MOCK_USER.sub,
      );
      // Fastify redirect(url) — single arg.
      expect(mockReply.redirect).toHaveBeenCalledWith(
        'http://localhost:5173/market-analysis-workflow?gdrive=connected',
      );
    });

    it('redirects with error when code is missing', async () => {
      await controller.handleCallback(
        '',
        SIGNED_STATE,
        mockReply as any,
      );

      expect(mockReply.redirect).toHaveBeenCalledWith(
        expect.stringContaining('gdrive=error'),
      );
    });

    it('redirects with error when state validation fails (CSRF)', async () => {
      oauthService.validateOAuthState.mockImplementation(() => {
        throw new UnauthorizedException('Invalid state parameter (CSRF detected)');
      });

      await controller.handleCallback(
        'auth-code-123',
        'bad-state',
        mockReply as any,
      );

      expect(mockReply.redirect).toHaveBeenCalledWith(
        expect.stringContaining('gdrive=error'),
      );
    });

    it('redirects with error message on exchange failure', async () => {
      oauthService.validateOAuthState.mockReturnValue(MOCK_USER.sub);
      oauthService.exchangeCode.mockRejectedValue(
        new UnauthorizedException('Invalid code'),
      );

      await controller.handleCallback(
        'bad-code',
        SIGNED_STATE,
        mockReply as any,
      );

      expect(mockReply.redirect).toHaveBeenCalledWith(
        expect.stringContaining('gdrive=error'),
      );
    });
  });

  describe('getStatus', () => {
    it('returns connection status from OAuth service', async () => {
      const statusInfo = {
        connected: true,
        email: 'user@gmail.com',
        connectedAt: new Date('2026-08-15T10:00:00.000Z'),
      };
      oauthService.getTokenInfo.mockResolvedValue(statusInfo);

      const result = await controller.getStatus(MOCK_USER as any);

      expect(result).toEqual(statusInfo);
      expect(oauthService.getTokenInfo).toHaveBeenCalledWith(MOCK_USER.sub);
    });

    it('returns connected=false when not connected', async () => {
      oauthService.getTokenInfo.mockResolvedValue({ connected: false });

      const result = await controller.getStatus(MOCK_USER as any);

      expect(result).toEqual({ connected: false });
    });
  });

  describe('disconnect', () => {
    it('revokes and deletes token, returns success message', async () => {
      oauthService.revokeAndDelete.mockResolvedValue(undefined);

      const result = await controller.disconnect(MOCK_USER as any);

      expect(result).toEqual({
        message: 'Google Drive disconnected successfully',
      });
      expect(oauthService.revokeAndDelete).toHaveBeenCalledWith(
        MOCK_USER.sub,
      );
    });

    it('propagates UnauthorizedException when not connected', async () => {
      oauthService.revokeAndDelete.mockRejectedValue(
        new UnauthorizedException('Google Drive not connected.'),
      );

      await expect(controller.disconnect(MOCK_USER as any)).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('exportAnalysis', () => {
    it('delegates to exportService and wraps result in { message, data }', async () => {
      const exportResult = {
        documentId: 'doc-123',
        documentUrl: 'https://docs.google.com/document/d/doc-123/edit',
        title: 'Báo cáo phân tích thị trường - 15/08/2026',
        folderUrl: 'https://drive.google.com/drive/folders/abc',
      };
      exportService.exportAnalysis.mockResolvedValue(exportResult);

      const result = await controller.exportAnalysis(
        MOCK_USER as any,
        'history-123',
        { folderUrl: 'https://drive.google.com/drive/folders/abc' },
      );

      expect(exportService.exportAnalysis).toHaveBeenCalledWith(
        MOCK_USER.sub,
        'history-123',
        'https://drive.google.com/drive/folders/abc',
      );
      // M-01 fix: response wrapped in { message, data }
      expect(result).toEqual({
        message: 'Export successful',
        data: exportResult,
      });
    });

    it('passes undefined folderUrl when dto.folderUrl is absent', async () => {
      exportService.exportAnalysis.mockResolvedValue({
        documentId: 'doc-456',
        documentUrl: 'https://docs.google.com/document/d/doc-456/edit',
        title: 'Báo cáo',
      });

      const result = await controller.exportAnalysis(
        MOCK_USER as any,
        'history-456',
        {},
      );

      expect(exportService.exportAnalysis).toHaveBeenCalledWith(
        MOCK_USER.sub,
        'history-456',
        undefined,
      );
      // Verify wrapper format
      expect(result).toEqual({
        message: 'Export successful',
        data: {
          documentId: 'doc-456',
          documentUrl: 'https://docs.google.com/document/d/doc-456/edit',
          title: 'Báo cáo',
        },
      });
    });

    it('propagates errors from export service', async () => {
      exportService.exportAnalysis.mockRejectedValue(
        new UnauthorizedException('Google Drive not connected.'),
      );

      await expect(
        controller.exportAnalysis(MOCK_USER as any, 'history-789', {}),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('validateFolder', () => {
    it('delegates to exportService.validateFolder', async () => {
      const validationResult = {
        valid: true,
        folderId: 'folder-abc',
        folderName: 'My Reports',
      };
      exportService.validateFolder.mockResolvedValue(validationResult);

      const result = await controller.validateFolder(MOCK_USER as any, {
        folderUrl: 'https://drive.google.com/drive/folders/folder-abc',
      });

      expect(exportService.validateFolder).toHaveBeenCalledWith(
        MOCK_USER.sub,
        'https://drive.google.com/drive/folders/folder-abc',
      );
      expect(result).toEqual(validationResult);
    });

    it('returns valid=false for inaccessible folder', async () => {
      exportService.validateFolder.mockResolvedValue({
        valid: false,
        folderId: 'no-access',
        folderName: '',
      });

      const result = await controller.validateFolder(MOCK_USER as any, {
        folderUrl: 'https://drive.google.com/drive/folders/no-access',
      });

      expect(result.valid).toBe(false);
    });
  });
});
