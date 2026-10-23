import { Injectable } from '@nestjs/common';
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
} from '../customers/access/customer-access.service';
import {
  customerNotFound,
  resolveClientSource,
  versionConflict,
} from '../customers/customer.errors';
import { CustomerRefsService } from '../customers/customer-refs.service';
import { computeTeamIds } from '../customers/customer-team-sync.service';
import { CustomersRepository } from '../customers/customers.repository';
import { CareTeamEntry } from '../customers/schemas/customer.schema';
import { CareTeamAssigneesService } from './care-team-assignees.service';
import {
  careTeamLabels,
  careTeamUserIds,
  toCareTeamResponse,
} from './care-team.mapper';
import {
  canChangePrimary,
  canManageMembers,
  careTeamActionForbidden,
  CareTeamChange,
  findPrimary,
  planAddMembers,
  planChangePrimary,
  planRemoveMember,
  assertCareTeamInvariant,
} from './care-team.rules';
import {
  AddCareTeamMembersDto,
  CareTeamResponseDto,
  ChangePrimaryDto,
} from './dtos/care-team.dto';

const oid = (id: string): Types.ObjectId => new Types.ObjectId(id);

/** Một thay đổi nhóm chăm sóc: ai được làm, thay đổi ra sao, có giới hạn người được phân theo phạm vi người làm không. */
export interface CareTeamMutation {
  /** Ném 403 `CARE_TEAM_ACTION_FORBIDDEN` nếu người thực hiện không đủ quyền với nhóm hiện tại. */
  authorize: (careTeam: CareTeamEntry[]) => void;
  plan: (careTeam: CareTeamEntry[], now: Date) => CareTeamChange;
  restrictToActorScope: boolean;
  source: CrmAuditSource;
}

/**
 * Nhóm chăm sóc của khách (`/crm/customers/:id/care-team`, tài liệu 05 mục 2.5, 04 mục 6.3).
 * Mọi thay đổi chạy trong MỘT transaction cùng audit; giữ đồng bộ `careTeam`, `primaryAssigneeId` và `teamIds`
 * (cơ sở phạm vi Quản lý) trong cùng một lệnh update. Người bị gỡ mất quyền ngay (404 ở mọi endpoint con) vì phạm
 * vi tính từ `careTeam` hiện tại.
 */
@Injectable()
export class CareTeamService {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    private readonly repo: CustomersRepository,
    private readonly access: CustomerAccessService,
    private readonly refs: CustomerRefsService,
    private readonly assignees: CareTeamAssigneesService,
    private readonly audit: CrmAuditLogService,
  ) {}

  async get(jwt: JwtPayload, id: string): Promise<CareTeamResponseDto> {
    const ctx = await this.access.resolve(jwt);
    const customer = await this.repo.findOne(ctx.scope, id, {
      projection: { careTeam: 1 },
    });
    if (!customer) throw customerNotFound();
    const maps = await this.refs.resolve({
      userIds: careTeamUserIds(customer.careTeam ?? []),
    });
    return toCareTeamResponse(customer.careTeam ?? [], maps.users);
  }

  addMembers(
    jwt: JwtPayload,
    id: string,
    dto: AddCareTeamMembersDto,
    clientType?: string,
  ): Promise<CareTeamResponseDto> {
    return this.mutate(jwt, id, clientType, (ctx, source) => ({
      authorize: (careTeam) => {
        if (!canManageMembers(ctx.actor, careTeam)) {
          throw careTeamActionForbidden(
            'Chỉ Quản trị, Quản lý hoặc phụ trách chính được thêm thành viên',
          );
        }
      },
      plan: (careTeam, now) =>
        planAddMembers(
          careTeam,
          {
            userIds: dto.userIds.map(oid),
            primaryUserId: dto.primaryUserId
              ? oid(dto.primaryUserId)
              : undefined,
          },
          ctx.actor.userId,
          now,
        ),
      restrictToActorScope: true,
      source,
    }));
  }

  removeMember(
    jwt: JwtPayload,
    id: string,
    userId: string,
    newPrimaryUserId: string | undefined,
    clientType?: string,
  ): Promise<CareTeamResponseDto> {
    return this.mutate(jwt, id, clientType, (ctx, source) => ({
      authorize: (careTeam) => {
        if (!canManageMembers(ctx.actor, careTeam)) {
          throw careTeamActionForbidden(
            'Chỉ Quản trị, Quản lý hoặc phụ trách chính được gỡ thành viên',
          );
        }
        if (
          findPrimary(careTeam)?.userId.equals(oid(userId)) &&
          !canChangePrimary(ctx.actor)
        ) {
          throw careTeamActionForbidden(
            'Chỉ Quản trị hoặc Quản lý được gỡ phụ trách chính',
          );
        }
      },
      plan: (careTeam, now) =>
        planRemoveMember(
          careTeam,
          oid(userId),
          newPrimaryUserId ? oid(newPrimaryUserId) : undefined,
          ctx.actor.userId,
          now,
        ),
      restrictToActorScope: true,
      source,
    }));
  }

  changePrimary(
    jwt: JwtPayload,
    id: string,
    dto: ChangePrimaryDto,
    clientType?: string,
  ): Promise<CareTeamResponseDto> {
    return this.mutate(jwt, id, clientType, (ctx, source) => ({
      authorize: () => {
        if (!canChangePrimary(ctx.actor)) {
          throw careTeamActionForbidden(
            'Chỉ Quản trị hoặc Quản lý được đổi phụ trách chính',
          );
        }
      },
      plan: (careTeam, now) =>
        planChangePrimary(careTeam, oid(dto.userId), ctx.actor.userId, now),
      restrictToActorScope: true,
      source,
    }));
  }

  /** Mở transaction cho một thay đổi của một khách rồi dựng response `{ members, primary }`. */
  private async mutate(
    jwt: JwtPayload,
    id: string,
    clientType: string | undefined,
    build: (ctx: AccessContext, source: CrmAuditSource) => CareTeamMutation,
  ): Promise<CareTeamResponseDto> {
    const ctx = await this.access.resolve(jwt);
    const { auditSource } = resolveClientSource(clientType);
    const mutation = build(ctx, auditSource);
    return withTransaction(this.connection, (session) =>
      this.applyInSession(ctx, id, mutation, session),
    );
  }

  /**
   * Áp một thay đổi nhóm trong transaction có sẵn (dùng cho API đơn lẻ, duyệt đề nghị và phân hàng loạt).
   * Không có gì đổi thì không ghi, không tăng version, không audit.
   */
  async applyInSession(
    ctx: AccessContext,
    customerId: string,
    mutation: CareTeamMutation,
    session: ClientSession,
  ): Promise<CareTeamResponseDto> {
    const before = await this.repo.findOne(ctx.scope, customerId, {
      session,
      projection: { careTeam: 1, teamIds: 1, __v: 1 },
    });
    if (!before) throw customerNotFound();
    const currentTeam = before.careTeam ?? [];
    mutation.authorize(currentTeam);

    const now = new Date();
    const change = mutation.plan(currentTeam, now);
    const hasChange =
      change.addedUserIds.length > 0 ||
      change.removedUserIds.length > 0 ||
      change.primaryChanged;
    if (!hasChange) {
      const maps = await this.refs.resolve({
        userIds: careTeamUserIds(currentTeam),
      });
      return toCareTeamResponse(currentTeam, maps.users);
    }
    assertCareTeamInvariant(change.careTeam);

    // Người mới phải hợp lệ; tên nhóm của MỌI thành viên mới tính được `teamIds`.
    const memberIds = change.careTeam.map((member) => member.userId);
    const users = await this.assignees.load(memberIds, session);
    const primary = findPrimary(change.careTeam);
    // Người được nâng làm PRIMARY (kể cả thành viên đã có) cũng phải còn hợp lệ.
    const checkedUserIds = [...change.addedUserIds];
    if (
      change.primaryChanged &&
      primary &&
      !checkedUserIds.some((id) => id.equals(primary.userId))
    ) {
      checkedUserIds.push(primary.userId);
    }
    this.assignees.assertAssignable(
      ctx.actor,
      checkedUserIds,
      users,
      mutation.restrictToActorScope,
    );
    await this.assignees.lock(checkedUserIds, session);

    const teamIds = computeTeamIds(
      memberIds,
      new Map([...users].map(([key, user]) => [key, user.teamId])),
    );
    const matched = await this.repo.updateOne(
      ctx.scope,
      customerId,
      { __v: before.__v },
      {
        $set: {
          careTeam: change.careTeam,
          primaryAssigneeId: primary?.userId ?? null,
          teamIds,
          lastUpdatedAt: now,
          lastUpdatedBy: ctx.actor.userId,
        },
        $inc: { __v: 1 },
      },
      { session },
    );
    if (!matched) throw versionConflict(before.__v);

    const maps = await this.refs.resolve({
      userIds: [
        ...careTeamUserIds(currentTeam),
        ...careTeamUserIds(change.careTeam),
      ],
    });
    await this.recordAudit(
      ctx,
      customerId,
      currentTeam,
      change,
      maps.users,
      mutation.source,
      session,
    );
    return toCareTeamResponse(change.careTeam, maps.users);
  }

  private async recordAudit(
    ctx: AccessContext,
    customerId: string,
    before: CareTeamEntry[],
    change: CareTeamChange,
    users: Map<string, string>,
    source: CrmAuditSource,
    session: ClientSession,
  ): Promise<void> {
    const entry = (action: CrmAuditAction, changes: CrmAuditChange[]) =>
      this.audit.record(
        {
          entityType: CrmAuditEntityType.CUSTOMER,
          entityId: customerId,
          customerId,
          action,
          actor: { sub: String(ctx.actor.userId) },
          changes,
          source,
        },
        session,
      );
    const teamChange: CrmAuditChange = {
      field: 'careTeam',
      from: careTeamLabels(before, users),
      to: careTeamLabels(change.careTeam, users),
    };
    if (change.addedUserIds.length > 0) {
      await entry(CrmAuditAction.CARE_TEAM_MEMBER_ADDED, [teamChange]);
    }
    if (change.removedUserIds.length > 0) {
      await entry(CrmAuditAction.CARE_TEAM_MEMBER_REMOVED, [teamChange]);
    }
    if (change.primaryChanged) {
      const name = (team: CareTeamEntry[]) => {
        const primary = findPrimary(team);
        return primary
          ? (users.get(String(primary.userId)) ?? String(primary.userId))
          : null;
      };
      await entry(CrmAuditAction.PRIMARY_CHANGED, [
        {
          field: 'primaryAssignee',
          from: name(before),
          to: name(change.careTeam),
        },
      ]);
    }
  }
}
