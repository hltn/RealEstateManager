import { Injectable, Logger } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { ClientSession, Connection, Types } from 'mongoose';
import type { JwtPayload } from '../../../common/decorators/current-user.decorator';
import { withTransaction } from '../../../shared/database/with-transaction.util';
import {
  CrmAuditAction,
  CrmAuditChange,
  CrmAuditEntityType,
  CrmAuditSource,
} from '../audit-logs/crm-audit.constants';
import { CrmAuditLogService } from '../audit-logs/crm-audit-log.service';
import {
  AccessContext,
  CustomerAccessService,
} from './access/customer-access.service';
import { AUTO_STATUS_SOURCE, CRITERIA_KEYS } from './customer.constants';
import {
  customerNotFound,
  resolveClientSource,
  versionConflict,
} from './customer.errors';
import { toConsentResponse, toCriteriaResponse } from './customer.mapper';
import { CustomerRefsService } from './customer-refs.service';
import { CustomerStatusChangeService } from './customer-status-change.service';
import { CustomersRepository } from './customers.repository';
import {
  UpdateCriteriaDto,
  UpdateDataConsentDto,
} from './dtos/customer-request.dto';
import {
  AutoStatusChangeDto,
  CriteriaUpdateResponseDto,
  DataConsentResponseDto,
} from './dtos/customer-response.dto';
import {
  computeProgress,
  crossesAutoStatusThreshold,
  decideAutoStatus,
  mergeCriteria,
} from './utils/customer-rules.util';

/** Tiêu chí/tiến độ (C4, C5) và đồng ý xử lý dữ liệu cá nhân (PUT data-consent). */
@Injectable()
export class CustomerCriteriaService {
  private readonly logger = new Logger(CustomerCriteriaService.name);

  constructor(
    @InjectConnection() private readonly connection: Connection,
    private readonly repo: CustomersRepository,
    private readonly access: CustomerAccessService,
    private readonly refs: CustomerRefsService,
    private readonly audit: CrmAuditLogService,
    private readonly statusChange: CustomerStatusChangeService,
  ) {}

  /**
   * Cập nhật 1-4 tiêu chí; `progress` = số tiêu chí hoàn thành x 25 do server tính và ghi CÙNG lệnh update.
   * Gửi giá trị trùng giá trị hiện có là no-op (không tăng version, không audit).
   * PT-023: khi tiến độ đổi, tự chuyển tình trạng (về đúng 3/4 từ mức khác, kể cả 100 -> 75 -> NET; xuống dưới
   * 3/4 -> INTERESTED nếu NET do cơ chế tự động đặt) CÙNG transaction; lỗi ở bước đổi tình trạng làm rollback cả tiêu chí.
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
        projection: {
          criteria: 1,
          progress: 1,
          lastUpdatedAt: 1,
          __v: 1,
          statusId: 1,
          statusAutoSource: 1,
        },
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

      const autoChange =
        (before.progress ?? 0) !== progress
          ? await this.applyAutoStatus(
              ctx,
              id,
              before,
              progress,
              version + 1,
              auditSource,
              session,
            )
          : null;

      const maps = await this.refs.resolve({
        userIds: [
          ctx.actor.userId,
          ...CRITERIA_KEYS.map((key) => next[key].updatedBy),
        ],
      });
      return {
        criteria: toCriteriaResponse({ criteria: next }, maps.users),
        progress,
        version: autoChange?.version ?? version + 1,
        lastUpdatedAt: autoChange?.lastUpdatedAt ?? now.toISOString(),
        ...(autoChange ? { autoStatusChange: autoChange.change } : {}),
      };
    });
  }

  /**
   * PT-023: quyết định + áp dụng tự chuyển tình trạng sau khi tiêu chí đã ghi (cùng `session`).
   * `criteriaVersion` là `__v` vừa `$inc` ở bước ghi tiêu chí nên khóa lạc quan vẫn chặt.
   * Trả `null` khi không cần đổi, hoặc tình trạng đích (NET/INTERESTED) thiếu/ngừng hoạt động
   * (lúc đó chỉ log cảnh báo, KHÔNG làm hỏng lệnh sửa tiêu chí).
   */
  private async applyAutoStatus(
    ctx: AccessContext,
    id: string,
    before: {
      progress?: number;
      statusId: Types.ObjectId;
      statusAutoSource?: string | null;
    },
    nextProgress: number,
    criteriaVersion: number,
    auditSource: CrmAuditSource,
    session: ClientSession,
  ): Promise<{
    change: AutoStatusChangeDto;
    version: number;
    lastUpdatedAt: string;
  } | null> {
    if (!crossesAutoStatusThreshold(before.progress ?? 0, nextProgress)) {
      return null;
    }
    const currentMap = await this.refs.resolve({
      statusIds: [before.statusId],
    });
    const current = currentMap.statuses.get(String(before.statusId));
    if (!current) return null;

    const target = decideAutoStatus({
      prevProgress: before.progress ?? 0,
      nextProgress,
      currentGroup: current.listGroup,
      currentCode: current.code,
      isAutoSet: !!before.statusAutoSource,
    });
    if (!target) return null;

    const targetId = await this.refs.findActiveStatusByCode(target, session);
    if (!targetId) {
      this.logger.warn(
        `Bỏ qua tự chuyển tình trạng khách ${id}: không có tình trạng "${target}" đang hoạt động`,
      );
      return null;
    }

    const result = await this.statusChange.applyChange(
      ctx,
      id,
      targetId,
      {
        version: criteriaVersion,
        autoSource: target === 'NET' ? AUTO_STATUS_SOURCE : undefined,
      },
      auditSource,
      session,
    );
    return {
      change: { from: current, to: result.status },
      version: result.version,
      lastUpdatedAt: result.lastUpdatedAt,
    };
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
