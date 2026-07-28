import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { RequestContextService } from '../../../common/services/request-context.service';
import { AuditAction, AuditLog } from '../schemas/audit-log.schema';

/**
 * Service ghi audit trail cho các thao tác rủi ro cao.
 * Thiết kế fire-and-forget: lỗi ghi log KHÔNG được lan ra ngoài
 * để tránh làm hỏng operation chính đã thành công.
 */
@Injectable()
export class AuditLogService {
  private readonly logger = new Logger(AuditLogService.name);

  constructor(
    @InjectModel(AuditLog.name)
    private readonly auditLogModel: Model<AuditLog>,
    private readonly requestContextService: RequestContextService,
  ) {}

  /**
   * Ghi một bản ghi audit log.
   * @param action       Loại hành động: 'DELETE' | 'BULK_DELETE' | 'PUBLISH' | 'BULK_PUBLISH'
   * @param collectionName  Collection bị tác động: 'raw_articles' | 'news_articles'
   * @param documentIds  Danh sách ID tài liệu bị ảnh hưởng
   * @param actor        Người thực hiện (mặc định 'system' khi chưa có auth)
   * @param metadata     Dữ liệu bổ sung tuỳ ngữ cảnh (wpPostId, count, v.v.)
   */
  async log(
    action: AuditAction,
    collectionName: string,
    documentIds: string[],
    actor: string = 'system',
    metadata: Record<string, unknown> = {},
  ): Promise<void> {
    const requestId = this.requestContextService.getRequestId();

    try {
      await this.auditLogModel.create({
        action,
        collectionName,
        documentIds,
        actor,
        metadata: {
          ...metadata,
          requestId,
        },
      });
    } catch (error: any) {
      // Fire-and-forget: chỉ log lỗi, không re-throw để operation chính không bị ảnh hưởng
      this.logger.error(
        `Ghi audit log thất bại — requestId=${requestId}, action=${action}, collection=${collectionName}, ids=[${documentIds.join(', ')}]`,
        error.stack,
      );
    }
  }
}
