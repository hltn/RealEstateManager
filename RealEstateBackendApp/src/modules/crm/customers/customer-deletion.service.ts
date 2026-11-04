import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { ClientSession, Connection } from 'mongoose';
import type { JwtPayload } from '../../../common/decorators/current-user.decorator';
import { withTransaction } from '../../../shared/database/with-transaction.util';
import {
  CrmAuditAction,
  CrmAuditEntityType,
  CrmAuditSource,
} from '../audit-logs/crm-audit.constants';
import { CrmAuditLogService } from '../audit-logs/crm-audit-log.service';
import { ListGroup } from '../catalogs/catalog.enums';
import { RemindersWriterService } from '../reminders/reminders-writer.service';
import {
  AccessContext,
  CustomerAccessService,
} from './access/customer-access.service';
import { assertCanDeleteCustomer } from './access/customer-delete-policy';
import { customerNotFound, resolveClientSource } from './customer.errors';
import { CustomerRefsService } from './customer-refs.service';
import { CustomersRepository } from './customers.repository';

/**
 * Xóa MỀM khách (tài liệu 09 mục 7). Hai đường vào dùng chung `applyDelete` nên không thể lệch quy tắc:
 * xóa đơn (`DELETE /crm/customers/:id`) và xóa hàng loạt (`type = DELETE`, mỗi khách một transaction).
 * Quyền xóa nằm ở MỘT hàm duy nhất `assertCanDeleteCustomer` (`customer-delete-policy.ts`).
 * Khôi phục và ẩn danh hóa ở `CustomerLifecycleService`; xóa vĩnh viễn ở `CustomerPurgeService`.
 */
@Injectable()
export class CustomerDeletionService {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    private readonly repo: CustomersRepository,
    private readonly access: CustomerAccessService,
    private readonly refs: CustomerRefsService,
    private readonly audit: CrmAuditLogService,
    private readonly reminders: RemindersWriterService,
  ) {}

  /** Xóa đơn: ADMIN/MANAGER giữ hành vi cũ về tình trạng (không đòi "Bỏ"); STAFF chỉ khi khách thuộc nhóm "Bỏ". */
  async softDelete(
    jwt: JwtPayload,
    id: string,
    reason: string,
    clientType?: string,
  ): Promise<void> {
    const ctx = await this.access.resolve(jwt);
    const { auditSource } = resolveClientSource(clientType);
    await withTransaction(this.connection, (session) =>
      this.applyDelete(ctx, id, reason, auditSource, session, {
        requireDropped: false,
      }),
    );
  }

  /**
   * Xóa mềm MỘT khách trong transaction có sẵn: phạm vi xem (ngoài phạm vi = 404, không lộ sự tồn tại) -> quyền xóa
   * (403/409) -> đánh dấu `deletedAt/deletedBy` -> hủy nhắc chưa gửi -> audit `CUSTOMER_DELETED`.
   * SĐT vẫn bị giữ chỗ (unique index không đổi); khôi phục sẽ dựng lại nhắc cho lịch còn hiệu lực.
   */
  async applyDelete(
    ctx: AccessContext,
    id: string,
    reason: string,
    auditSource: CrmAuditSource,
    session: ClientSession,
    options: { requireDropped: boolean },
  ): Promise<void> {
    const customer = await this.repo.findOne(ctx.scope, id, {
      session,
      projection: { statusId: 1, teamIds: 1, careTeam: 1 },
    });
    if (!customer) throw customerNotFound();
    const maps = await this.refs.resolve({ statusIds: [customer.statusId] });
    const isDropped =
      maps.statuses.get(String(customer.statusId))?.listGroup ===
      ListGroup.DROPPED;
    assertCanDeleteCustomer(ctx.actor, customer, {
      isDropped,
      requireDropped: options.requireDropped,
    });

    const now = new Date();
    await this.repo.updateOne(
      ctx.scope,
      id,
      {},
      {
        $set: {
          deletedAt: now,
          deletedBy: ctx.actor.userId,
          lastUpdatedAt: now,
          lastUpdatedBy: ctx.actor.userId,
        },
        $inc: { __v: 1 },
      },
      { session },
    );
    await this.reminders.cancelForCustomer(customer._id, now, session);
    await this.audit.record(
      {
        entityType: CrmAuditEntityType.CUSTOMER,
        entityId: id,
        customerId: id,
        action: CrmAuditAction.CUSTOMER_DELETED,
        actor: { sub: String(ctx.actor.userId) },
        reason,
        source: auditSource,
      },
      session,
    );
  }
}
