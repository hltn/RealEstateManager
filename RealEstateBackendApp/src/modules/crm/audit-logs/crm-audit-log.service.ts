import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import type { JwtPayload } from '../../../common/decorators/current-user.decorator';
import { requestContextStorage } from '../../../common/services/request-context.service';
import { User, UserDocument } from '../../users/schemas/user.schema';
import {
  CrmAuditAction,
  CrmAuditChange,
  CrmAuditEntityType,
  CrmAuditSource,
} from './crm-audit.constants';
import {
  CrmAuditLog,
  CrmAuditLogDocument,
} from './schemas/crm-audit-log.schema';

export interface CrmAuditEntry {
  entityType: CrmAuditEntityType;
  entityId: string | Types.ObjectId;
  /** Phân loại con (vd `LEAD_SOURCE`), để biết `entityId` thuộc collection nào khi entityType chung. */
  entitySubtype?: string;
  action: CrmAuditAction;
  /**
   * Người thực hiện (payload JWT). Chỉ `sub` được tin; tên và vai trò ghi vào audit lấy từ DB tại thời điểm
   * thao tác (role trong JWT chỉ là bản chụp lúc cấp token, có thể đã cũ).
   */
  actor: Pick<JwtPayload, 'sub'>;
  /** Khách liên quan (M2 trở đi) — để tra lịch sử theo khách. */
  customerId?: string | Types.ObjectId | null;
  changes?: CrmAuditChange[];
  reason?: string | null;
  source?: CrmAuditSource;
}

const UNKNOWN_ACTOR_NAME = 'Không xác định';
const UNKNOWN_ACTOR_ROLE = 'UNKNOWN';

/**
 * Ghi nhật ký audit CRM. Bắt buộc truyền `session`: bản ghi audit phải nằm TRONG CÙNG transaction
 * với thay đổi nghiệp vụ (tài liệu 04 mục 3.7) — nghiệp vụ rollback thì audit cũng rollback.
 *
 * `actorName` là ảnh chụp tên hiển thị tại thời điểm thao tác (đổi tên sau này không làm lệch lịch sử).
 * `requestId` lấy từ AsyncLocalStorage (X-Request-ID) để truy vết xuyên log.
 */
@Injectable()
export class CrmAuditLogService {
  constructor(
    @InjectModel(CrmAuditLog.name)
    private readonly auditModel: Model<CrmAuditLogDocument>,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
  ) {}

  async record(entry: CrmAuditEntry, session: ClientSession): Promise<void> {
    const actorId = new Types.ObjectId(entry.actor.sub);
    const actor = await this.userModel
      .findById(actorId)
      .select('displayName role')
      .session(session)
      .lean()
      .exec();

    await this.auditModel.create(
      [
        {
          entityType: entry.entityType,
          entityId: new Types.ObjectId(String(entry.entityId)),
          entitySubtype: entry.entitySubtype ?? null,
          customerId: entry.customerId
            ? new Types.ObjectId(String(entry.customerId))
            : null,
          action: entry.action,
          actorId,
          actorName: actor?.displayName ?? UNKNOWN_ACTOR_NAME,
          actorRole: actor?.role ?? UNKNOWN_ACTOR_ROLE,
          changes: entry.changes ?? [],
          reason: entry.reason ?? null,
          source: entry.source ?? 'WEB',
          requestId: requestContextStorage.getStore()?.requestId ?? 'unknown',
          ip: requestContextStorage.getStore()?.ip ?? null,
          userAgent: requestContextStorage.getStore()?.userAgent ?? null,
        },
      ],
      { session },
    );
  }
}
