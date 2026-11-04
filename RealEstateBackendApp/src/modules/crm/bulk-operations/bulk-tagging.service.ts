import { HttpStatus, Injectable } from '@nestjs/common';
import { ClientSession, Types } from 'mongoose';
import { BusinessException } from '../../../common/exceptions/business.exception';
import { ErrorCode } from '../../../common/exceptions/error-codes';
import {
  CrmAuditAction,
  CrmAuditEntityType,
  CrmAuditSource,
} from '../audit-logs/crm-audit.constants';
import { CrmAuditLogService } from '../audit-logs/crm-audit-log.service';
import { AccessContext } from '../customers/access/customer-access.service';
import { customerNotFound } from '../customers/customer.errors';
import { CustomerRefsService } from '../customers/customer-refs.service';
import { CustomerTagsService } from '../customers/customer-tags.service';
import { CustomersRepository } from '../customers/customers.repository';
import { MAX_TAGS_PER_CUSTOMER } from '../tags/tag.constants';
import { diffTagIds } from '../tags/tag.rules';

export type BulkTagMode = 'ADD' | 'REMOVE';

/** Gắn / gỡ thẻ hàng loạt (`ADD_TAGS`, `REMOVE_TAGS`): xử lý MỘT khách trong transaction do `BulkOperationsService` mở. */
@Injectable()
export class BulkTaggingService {
  constructor(
    private readonly repo: CustomersRepository,
    private readonly refs: CustomerRefsService,
    private readonly tags: CustomerTagsService,
    private readonly audit: CrmAuditLogService,
  ) {}

  /** Kiểm thẻ gắn thêm còn tồn tại (400 cho cả lô); gỡ thẻ thì không cần (thẻ đã xóa vẫn gỡ được). */
  prepare(mode: BulkTagMode, tagIds: Types.ObjectId[]): Promise<void> {
    return mode === 'ADD'
      ? this.tags.assertAllActive(tagIds)
      : Promise.resolve();
  }

  /**
   * Phạm vi khách do `CustomerScope` bảo đảm (ngoài phạm vi => `CUSTOMER_NOT_FOUND`). Khách đã đúng trạng thái
   * (đã có thẻ khi thêm, chưa có thẻ khi gỡ) là thành công không ghi gì, nên gọi lại cùng lô là an toàn.
   */
  async applyToCustomer(
    ctx: AccessContext,
    customerId: string,
    mode: BulkTagMode,
    tagIds: Types.ObjectId[],
    source: CrmAuditSource,
    session: ClientSession,
  ): Promise<void> {
    const before = await this.repo.findOne(ctx.scope, customerId, {
      session,
      projection: { tagIds: 1 },
    });
    if (!before) throw customerNotFound();

    const current = before.tagIds ?? [];
    const requested = new Set(tagIds.map(String));
    const next =
      mode === 'ADD'
        ? [
            ...current,
            ...tagIds.filter(
              (id) => !current.some((existing) => existing.equals(id)),
            ),
          ]
        : current.filter((id) => !requested.has(String(id)));
    const delta = diffTagIds(current, next);
    if (delta.added.length === 0 && delta.removed.length === 0) return;

    if (next.length > MAX_TAGS_PER_CUSTOMER) {
      throw new BusinessException(
        ErrorCode.VALIDATION_FAILED,
        `Mỗi khách tối đa ${MAX_TAGS_PER_CUSTOMER} thẻ`,
        HttpStatus.BAD_REQUEST,
        { field: 'payload.tagIds' },
      );
    }
    await this.tags.applyDelta(delta, session);

    const matched = await this.repo.updateOne(
      ctx.scope,
      customerId,
      {},
      {
        $set: {
          tagIds: next,
          lastUpdatedAt: new Date(),
          lastUpdatedBy: ctx.actor.userId,
        },
        $inc: { __v: 1 },
      },
      { session },
    );
    // Khách vừa bị xóa/chuyển ra ngoài phạm vi giữa lúc đọc và lúc ghi: không ghi, không audit (transaction hoàn tác).
    if (!matched) throw customerNotFound();
    const { tags } = await this.refs.resolve({ tagIds: [...current, ...next] });
    const labels = (ids: Types.ObjectId[]) =>
      ids.map((id) => tags.get(String(id)) ?? String(id));
    await this.audit.record(
      {
        entityType: CrmAuditEntityType.CUSTOMER,
        entityId: customerId,
        customerId,
        action: CrmAuditAction.TAGS_UPDATED,
        actor: { sub: String(ctx.actor.userId) },
        changes: [{ field: 'tags', from: labels(current), to: labels(next) }],
        reason: 'Thao tác hàng loạt',
        source,
      },
      session,
    );
  }
}
