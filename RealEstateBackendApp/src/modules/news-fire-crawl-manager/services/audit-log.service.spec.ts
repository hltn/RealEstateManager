import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { AuditLogService } from './audit-log.service';
import { AuditLog, AuditAction } from '../schemas/audit-log.schema';
import { RequestContextService } from '../../../common/services/request-context.service';

/**
 * Unit test cho AuditLogService — fire-and-forget audit trail.
 * Mock Mongoose Model + RequestContextService.
 */
describe('AuditLogService', () => {
  let service: AuditLogService;
  let mockAuditLogModel: any;
  let mockRequestContextService: any;

  beforeEach(async () => {
    mockAuditLogModel = { create: jest.fn() };
    mockRequestContextService = { getRequestId: jest.fn().mockReturnValue('req-123') };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuditLogService,
        { provide: getModelToken(AuditLog.name), useValue: mockAuditLogModel },
        {
          provide: RequestContextService,
          useValue: mockRequestContextService,
        },
      ],
    }).compile();

    service = module.get<AuditLogService>(AuditLogService);
  });

  afterEach(() => jest.clearAllMocks());

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('log', () => {
    it('should create audit log with metadata including requestId', async () => {
      mockAuditLogModel.create.mockResolvedValue({});

      await service.log(
        AuditAction.DELETE,
        'news_articles',
        ['id1', 'id2'],
        'admin',
        { count: 2 },
      );

      expect(mockAuditLogModel.create).toHaveBeenCalledWith({
        action: AuditAction.DELETE,
        collectionName: 'news_articles',
        documentIds: ['id1', 'id2'],
        actor: 'admin',
        metadata: { count: 2, requestId: 'req-123' },
      });
    });

    it('should default actor to "system" when not provided', async () => {
      mockAuditLogModel.create.mockResolvedValue({});

      await service.log(AuditAction.PUBLISH, 'news_articles', ['id1']);

      const callArgs = mockAuditLogModel.create.mock.calls[0][0];
      expect(callArgs.actor).toBe('system');
    });

    it('should default metadata to empty object when not provided', async () => {
      mockAuditLogModel.create.mockResolvedValue({});

      await service.log(AuditAction.BULK_DELETE, 'raw_articles', ['a']);

      const callArgs = mockAuditLogModel.create.mock.calls[0][0];
      expect(callArgs.metadata).toEqual({ requestId: 'req-123' });
    });

    it('should NOT re-throw when create fails (fire-and-forget)', async () => {
      mockAuditLogModel.create.mockRejectedValue(new Error('DB down'));

      await expect(
        service.log(AuditAction.DELETE, 'news_articles', ['x']),
      ).resolves.toBeUndefined();
    });
  });
});
