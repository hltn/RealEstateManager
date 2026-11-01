import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import type { JwtPayload } from '../../../common/decorators/current-user.decorator';
import { withTransaction } from '../../../shared/database/with-transaction.util';
import {
  CrmAuditAction,
  CrmAuditChange,
  CrmAuditEntityType,
} from '../audit-logs/crm-audit.constants';
import { CrmAuditLogService } from '../audit-logs/crm-audit-log.service';
import { CustomerAccessService } from './access/customer-access.service';
import { CRITERIA_KEYS } from './customer.constants';
import {
  customerNotFound,
  resolveClientSource,
  versionConflict,
} from './customer.errors';
import { toConsentResponse, toCriteriaResponse } from './customer.mapper';
import { CustomerRefsService } from './customer-refs.service';
import { CustomersRepository } from './customers.repository';
import {
  UpdateCriteriaDto,
  UpdateDataConsentDto,
} from './dtos/customer-request.dto';
import {
  CriteriaUpdateResponseDto,
  DataConsentResponseDto,
} from './dtos/customer-response.dto';
import { computeProgress, mergeCriteria } from './utils/customer-rules.util';

/** Tiêu chí/tiến độ (C4, C5) và đồng ý xử lý dữ liệu cá nhân (PUT data-consent). */
@Injectable()
export class CustomerCriteriaService {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    private readonly repo: CustomersRepository,
    private readonly access: CustomerAccessService,
    private readonly refs: CustomerRefsService,
    private readonly audit: CrmAuditLogService,
  ) {}

  /**
   * Cập nhật 1-4 tiêu chí; `progress` = số tiêu chí hoàn thành x 25 do server tính và ghi CÙNG lệnh update.
   * Gửi giá trị trùng giá trị hiện có là no-op (không tăng version, không audit).
   */
  async updateCriteria(
    jwt: JwtPayload,
    id: string,
    dto: UpdateCriteriaDto,
    clientType?: string,
  ): Promise<CriteriaUpdateResponseDto> {
    const ctx = await this.access.resolve(jwt);
    const { auditSource } = resolveClientSource(clientType);
    const { version, ...input } = dto;

    return withTransaction(this.connection, async (session) => {
      const before = await this.repo.findOne(ctx.scope, id, {
        session,
        projection: { criteria: 1, progress: 1, lastUpdatedAt: 1, __v: 1 },
      });
      if (!before) throw customerNotFound();
      if (before.__v !== version) throw versionConflict(before.__v);

      const now = new Date();
      const { next, changedKeys } = mergeCriteria(
        before.criteria,
        input,
        ctx.actor.userId,
        now,
      );
      const progress = computeProgress(next);

      if (changedKeys.length === 0) {
        const maps = await this.refs.resolve({
          userIds: CRITERIA_KEYS.map(
            (key) => before.criteria?.[key]?.updatedBy,
          ),
        });
        return {
          criteria: toCriteriaResponse(before, maps.users),
          progress: before.progress ?? 0,
          version: before.__v,
          lastUpdatedAt: before.lastUpdatedAt.toISOString(),
        };
      }

      const matched = await this.repo.updateOne(
        ctx.scope,
        id,
        { __v: version },
        {
          $set: {
            criteria: next,
            progress,
            lastUpdatedAt: now,
            lastUpdatedBy: ctx.actor.userId,
          },
          $inc: { __v: 1 },
        },
        { session },
      );
      if (!matched) {
        const current = await this.repo.findOne(ctx.scope, id, {
          session,
          projection: { __v: 1 },
        });
        if (!current) throw customerNotFound();
        throw versionConflict(current.__v);
      }

      const changes: CrmAuditChange[] = [];
      for (const key of changedKeys) {
        const was = before.criteria?.[key];
        const is = next[key];
        if ((was?.isDone ?? false) !== is.isDone) {
          changes.push({
            field: `criteria.${key}.isDone`,
            from: was?.isDone ?? false,
            to: is.isDone,
          });
        }
        if ((was?.description ?? '') !== is.description) {
          changes.push({
            field: `criteria.${key}.description`,
            from: was?.description ?? '',
            to: is.description,
          });
        }
      }
      if ((before.progress ?? 0) !== progress) {
        changes.push({
          field: 'progress',
          from: before.progress ?? 0,
          to: progress,
        });
      }
      await this.audit.record(
        {
          entityType: CrmAuditEntityType.CUSTOMER,
          entityId: id,
          customerId: id,
          action: CrmAuditAction.CRITERIA_UPDATED,
          actor: { sub: String(ctx.actor.userId) },
          changes,
          source: auditSource,
        },
        session,
      );

      const maps = await this.refs.resolve({
        userIds: [
          ctx.actor.userId,
          ...CRITERIA_KEYS.map((key) => next[key].updatedBy),
        ],
      });
      return {
        criteria: toCriteriaResponse({ criteria: next }, maps.users),
        progress,
        version: version + 1,
        lastUpdatedAt: now.toISOString(),
      };
    });
  }

  /** Ghi nhận/rút lại đồng ý xử lý dữ liệu cá nhân (không dùng khóa lạc quan; có audit). */
  async updateConsent(
    jwt: JwtPayload,
    id: string,
    dto: UpdateDataConsentDto,
    clientType?: string,
  ): Promise<DataConsentResponseDto> {
    const ctx = await this.access.resolve(jwt);
    const { auditSource } = resolveClientSource(clientType);

    return withTransaction(this.connection, async (session) => {
      const before = await this.repo.findOne(ctx.scope, id, {
        session,
        projection: { dataConsent: 1 },
      });
      if (!before) throw customerNotFound();

      const now = new Date();
      const dataConsent = {
        status: dto.status,
        method: dto.method ?? null,
        recordedBy: ctx.actor.userId,
        recordedAt: now,
        note: dto.note ?? null,
      };
      await this.repo.updateOne(
        ctx.scope,
        id,
        {},
        {
          $set: {
            dataConsent,
            lastUpdatedAt: now,
            lastUpdatedBy: ctx.actor.userId,
          },
          $inc: { __v: 1 },
        },
        { session },
      );
      await this.audit.record(
        {
          entityType: CrmAuditEntityType.CUSTOMER,
          entityId: id,
          customerId: id,
          action: CrmAuditAction.DATA_CONSENT_UPDATED,
          actor: { sub: String(ctx.actor.userId) },
          changes: [
            {
              field: 'dataConsent',
              from: {
                status: before.dataConsent?.status ?? null,
                method: before.dataConsent?.method ?? null,
              },
              to: { status: dataConsent.status, method: dataConsent.method },
            },
          ],
          source: auditSource,
        },
        session,
      );
      const maps = await this.refs.resolve({ userIds: [ctx.actor.userId] });
      return toConsentResponse({ dataConsent }, maps.users);
    });
  }
}
