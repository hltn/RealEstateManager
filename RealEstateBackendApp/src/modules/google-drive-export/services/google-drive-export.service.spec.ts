/**
 * GoogleDriveExportService unit spec.
 *
 * Bao phủ:
 * - exportAnalysis: history not found → NotFoundException
 * - exportAnalysis: success path (create doc, batchUpdate, optional move)
 * - exportAnalysis: with folderUrl → parse folderId + validate + move
 * - exportAnalysis: invalid folder URL → BadRequestException
 * - exportAnalysis: folder inaccessible → BadRequestException
 * - validateFolder: valid folder → { valid, folderId, folderName }
 * - validateFolder: invalid URL → BadRequestException
 * - validateFolder: inaccessible folder → { valid: false }
 *
 * Mock: googleapis (docs.create, docs.batchUpdate, drive.files.update, drive.files.get),
 *       MarketAnalysisHistory model, GoogleDriveOAuthService.
 */

// ─── Mock googleapis ─────────────────────────────────────────────────────────

const mockDocsCreate = jest.fn();
const mockDocsBatchUpdate = jest.fn();
const mockDriveFilesUpdate = jest.fn();
const mockDriveFilesGet = jest.fn();

jest.mock('googleapis', () => ({
  google: {
    docs: jest.fn(() => ({
      documents: {
        create: mockDocsCreate,
        batchUpdate: mockDocsBatchUpdate,
      },
    })),
    drive: jest.fn(() => ({
      files: {
        update: mockDriveFilesUpdate,
        get: mockDriveFilesGet,
      },
    })),
  },
}));

import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { GoogleDriveExportService } from './google-drive-export.service';
import { GoogleDriveOAuthService } from './google-drive-oauth.service';
import { MarketAnalysisHistory } from '../../news-fire-crawl-manager/schemas/market-analysis-history.schema';

const USER_ID = '65e1f0a1b2c3d4e5f6a7b8c9';
const HISTORY_ID = '66a1b2c3d4e5f6a7b8c9d0e1';
const DOCUMENT_ID = 'google-doc-id-123';

const MOCK_HISTORY = {
  _id: HISTORY_ID,
  content: '# Title\n\nSome content with **bold**.',
  articleIds: ['art1', 'art2'],
};

function chainable(finalValue: unknown = undefined): any {
  const chain: any = {};
  const chainFn = () => chain;
  for (const m of ['select', 'lean', 'sort', 'skip', 'limit', 'populate']) {
    chain[m] = jest.fn(chainFn);
  }
  chain.exec = jest.fn(async () => finalValue);
  return chain;
}

describe('GoogleDriveExportService', () => {
  let service: GoogleDriveExportService;
  let historyModel: any;
  let oauthService: any;

  beforeEach(async () => {
    jest.clearAllMocks();

    historyModel = {
      findById: jest.fn(),
    };

    oauthService = {
      getOAuth2Client: jest.fn(),
    };

    // Default mock: create doc returns documentId.
    mockDocsCreate.mockResolvedValue({
      data: { documentId: DOCUMENT_ID },
    });
    mockDocsBatchUpdate.mockResolvedValue({ data: {} });
    mockDriveFilesUpdate.mockResolvedValue({ data: { id: DOCUMENT_ID } });
    mockDriveFilesGet.mockResolvedValue({
      data: {
        id: 'folder-id-abc',
        name: 'My Folder',
        mimeType: 'application/vnd.google-apps.folder',
      },
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GoogleDriveExportService,
        {
          provide: getModelToken(MarketAnalysisHistory.name),
          useValue: historyModel,
        },
        {
          provide: GoogleDriveOAuthService,
          useValue: oauthService,
        },
      ],
    }).compile();

    service = module.get<GoogleDriveExportService>(GoogleDriveExportService);
  });

  describe('exportAnalysis()', () => {
    it('throws NotFoundException when history not found', async () => {
      historyModel.findById.mockReturnValue(chainable(null));

      await expect(
        service.exportAnalysis(USER_ID, HISTORY_ID),
      ).rejects.toThrow(NotFoundException);
      await expect(
        service.exportAnalysis(USER_ID, HISTORY_ID),
      ).rejects.toThrow('Market analysis history not found');
    });

    it('calls getOAuth2Client to verify connection', async () => {
      historyModel.findById.mockReturnValue(chainable(MOCK_HISTORY));
      const mockClient = { setCredentials: jest.fn() };
      oauthService.getOAuth2Client.mockResolvedValue(mockClient);

      await service.exportAnalysis(USER_ID, HISTORY_ID);

      expect(oauthService.getOAuth2Client).toHaveBeenCalledWith(USER_ID);
    });

    it('creates Google Doc, executes batchUpdate, returns result', async () => {
      historyModel.findById.mockReturnValue(chainable(MOCK_HISTORY));
      const mockClient = {};
      oauthService.getOAuth2Client.mockResolvedValue(mockClient);

      const result = await service.exportAnalysis(USER_ID, HISTORY_ID);

      // Verify doc creation.
      expect(mockDocsCreate).toHaveBeenCalledWith({
        requestBody: { title: expect.stringContaining('Báo cáo phân tích thị trường') },
      });

      // Verify batchUpdate was called (content has tokens).
      expect(mockDocsBatchUpdate).toHaveBeenCalledWith({
        documentId: DOCUMENT_ID,
        requestBody: { requests: expect.any(Array) },
      });

      // Verify result shape.
      expect(result).toEqual({
        documentId: DOCUMENT_ID,
        documentUrl: `https://docs.google.com/document/d/${DOCUMENT_ID}/edit`,
        title: expect.stringContaining('Báo cáo phân tích thị trường'),
        folderUrl: undefined,
      });
    });

    it('skips batchUpdate when content is empty', async () => {
      historyModel.findById.mockReturnValue(
        chainable({ ...MOCK_HISTORY, content: '' }),
      );
      oauthService.getOAuth2Client.mockResolvedValue({});

      const result = await service.exportAnalysis(USER_ID, HISTORY_ID);

      expect(mockDocsBatchUpdate).not.toHaveBeenCalled();
      expect(result.documentId).toBe(DOCUMENT_ID);
    });

    it('moves doc to folder when folderUrl is provided', async () => {
      historyModel.findById.mockReturnValue(chainable(MOCK_HISTORY));
      oauthService.getOAuth2Client.mockResolvedValue({});

      const folderUrl = 'https://drive.google.com/drive/folders/folder-id-abc';
      const result = await service.exportAnalysis(
        USER_ID,
        HISTORY_ID,
        folderUrl,
      );

      // Verify folder validation was called.
      expect(mockDriveFilesGet).toHaveBeenCalledWith({
        fileId: 'folder-id-abc',
        fields: 'id, name, mimeType',
        supportsAllDrives: true,
      });

      // Verify file was moved.
      expect(mockDriveFilesUpdate).toHaveBeenCalledWith({
        fileId: DOCUMENT_ID,
        addParents: 'folder-id-abc',
        fields: 'id, parents',
      });

      expect(result.folderUrl).toBe(folderUrl);
    });

    it('throws BadRequestException for invalid folder URL', async () => {
      historyModel.findById.mockReturnValue(chainable(MOCK_HISTORY));
      oauthService.getOAuth2Client.mockResolvedValue({});

      await expect(
        service.exportAnalysis(USER_ID, HISTORY_ID, 'https://invalid-url.com'),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.exportAnalysis(USER_ID, HISTORY_ID, 'https://invalid-url.com'),
      ).rejects.toThrow('Invalid Google Drive folder URL format');
    });

    it('throws BadRequestException when folder is inaccessible', async () => {
      historyModel.findById.mockReturnValue(chainable(MOCK_HISTORY));
      oauthService.getOAuth2Client.mockResolvedValue({});
      mockDriveFilesGet.mockRejectedValue(new Error('Not found'));

      await expect(
        service.exportAnalysis(
          USER_ID,
          HISTORY_ID,
          'https://drive.google.com/drive/folders/abc123',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when folderId is not a folder', async () => {
      historyModel.findById.mockReturnValue(chainable(MOCK_HISTORY));
      oauthService.getOAuth2Client.mockResolvedValue({});
      mockDriveFilesGet.mockResolvedValue({
        data: {
          id: 'file-id',
          name: 'Not a folder',
          mimeType: 'application/pdf',
        },
      });

      await expect(
        service.exportAnalysis(
          USER_ID,
          HISTORY_ID,
          'https://drive.google.com/drive/folders/file-id',
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('validateFolder()', () => {
    it('returns valid=true for accessible folder', async () => {
      oauthService.getOAuth2Client.mockResolvedValue({});

      const result = await service.validateFolder(
        USER_ID,
        'https://drive.google.com/drive/folders/folder-id-abc',
      );

      expect(result).toEqual({
        valid: true,
        folderId: 'folder-id-abc',
        folderName: 'My Folder',
      });
    });

    it('throws BadRequestException for invalid URL', async () => {
      oauthService.getOAuth2Client.mockResolvedValue({});

      await expect(
        service.validateFolder(USER_ID, 'https://bad-url.com'),
      ).rejects.toThrow(BadRequestException);
    });

    it('returns valid=false when folder not found', async () => {
      oauthService.getOAuth2Client.mockResolvedValue({});
      mockDriveFilesGet.mockRejectedValue(new Error('Not found'));

      const result = await service.validateFolder(
        USER_ID,
        'https://drive.google.com/drive/folders/nonexistent',
      );

      expect(result.valid).toBe(false);
    });

    it('returns valid=false when target is not a folder', async () => {
      oauthService.getOAuth2Client.mockResolvedValue({});
      mockDriveFilesGet.mockResolvedValue({
        data: { id: 'file-id', name: 'Doc.pdf', mimeType: 'application/pdf' },
      });

      const result = await service.validateFolder(
        USER_ID,
        'https://drive.google.com/drive/folders/file-id',
      );

      expect(result.valid).toBe(false);
    });

    it('supports u/N/folders/ URL format', async () => {
      oauthService.getOAuth2Client.mockResolvedValue({});

      const result = await service.validateFolder(
        USER_ID,
        'https://drive.google.com/drive/u/0/folders/folder-id-abc',
      );

      expect(result.valid).toBe(true);
      expect(mockDriveFilesGet).toHaveBeenCalledWith(
        expect.objectContaining({ fileId: 'folder-id-abc' }),
      );
    });
  });
});
