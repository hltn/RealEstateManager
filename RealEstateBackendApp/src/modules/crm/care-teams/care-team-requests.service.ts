import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { ClientSession, Connection, Model, Types } from 'mongoose';
import type { JwtPayload } from '../../../common/decorators/current-user.decorator';
import { PaginationMetaDto } from '../../../common/dto/paginated-response.dto';
import { UserRole } from '../../../common/enums/user-role.enum';
import { BusinessException } from '../../../common/exceptions/business.exception';
import { ErrorCode } from '../../../common/exceptions/error-codes';
import { isDuplicateKeyError } from '../../../common/utils/mongo-error.util';
import {
  buildPaginationMeta,
  normalizePagination,
} from '../../../common/utils/pagination.util';
import { withTransaction } from '../../../shared/database/with-transaction.util';
import {
  CrmAuditAction,
  CrmAuditEntityType,
  CrmAuditSource,
} from '../audit-logs/crm-audit.constants';
import { CrmAuditLogService } from '../audit-logs/crm-audit-log.service';
import { CrmRateLimitService } from '../common/security/crm-rate-limit.service';
import {
  AccessContext,
  CustomerAccessService,
} from '../customers/access/customer-access.service';
import { CareRole } from '../customers/customer.constants';
import {
  customerNotFound,
  resolveClientSource,
} from '../customers/customer.errors';
import {
  CustomerRefsService,
  toUserRef,
} from '../customers/customer-refs.service';
import { CustomersRepository } from '../customers/customers.repository';
import {
  CareTeamRequestBox,
  CareTeamRequestStatus,
} from './care-team.constants';
import { Team, TeamDocument } from '../../teams/schemas/team.schema';
import {
  NotificationPriority,
  NotificationType,
} from '../../notifications/notification.constants';
import { NotificationsService } from '../../notifications/notifications.service';
import { CareTeamService } from './care-team.service';
import { careTeamActionForbidden, planAddMembers } from './care-team.rules';
import {
  CareTeamRequestItemDto,
  CreateCareTeamRequestDto,
  CreateCareTeamRequestResponseDto,
  ListCareTeamRequestsQueryDto,
  ResolveCareTeamRequestDto,
} from './dtos/care-team.dto';
import {
  CareTeamRequest,
  CareTeamRequestDocument,
} from './schemas/care-team-request.schema';

type RequestRow = CareTeamRequest & { _id: Types.ObjectId };

/** Tên collection `customers` cho `$lookup` (schema khách khai báo cùng tên). */
const CUSTOMERS_COLLECTION = 'customers';

const resourceNotFound = (): BusinessException =>
  new BusinessException(
    ErrorCode.RESOURCE_NOT_FOUND,
    'Không tìm thấy đề nghị',
    HttpStatus.NOT_FOUND,
  );

/**
 * Đề nghị tham gia nhóm chăm sóc một khách đã có (X2, tài liệu 05 mục 2.5).
 * - Gửi: Quản lý/Nhân viên, `customerRef` lấy từ `phone-lookups`; mỗi người chỉ 1 đề nghị PENDING cho 1 khách
 *   (unique index một phần, E11000 => 409 `JOIN_REQUEST_EXISTS`).
 * - Duyệt/từ chối: Quản trị, Quản lý (trong phạm vi), phụ trách chính; không tự duyệt đề nghị của chính mình.
 *   Duyệt = thêm MEMBER trong CÙNG transaction với việc chốt trạng thái.
 * - Hủy: chỉ người gửi.
 * Thông báo đến người duyệt thuộc M5 (hộp thông báo trong app).
 */
@Injectable()
export class CareTeamRequestsService {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(CareTeamRequest.name)
    private readonly requestModel: Model<CareTeamRequestDocument>,
    private readonly repo: CustomersRepository,
    private readonly access: CustomerAccessService,
    private readonly refs: CustomerRefsService,
    private readonly careTeam: CareTeamService,
    private readonly rateLimit: CrmRateLimitService,
    private readonly audit: CrmAuditLogService,
    private readonly notifications: NotificationsService,
    @InjectModel(Team.name) private readonly teamModel: Model<TeamDocument>,
  ) {}

  async create(
    jwt: JwtPayload,
    dto: CreateCareTeamRequestDto,
    clientType?: string,
  ): Promise<CreateCareTeamRequestResponseDto> {
    await this.rateLimit.consume(jwt.sub, 'JOIN_REQUEST');
    const ctx = await this.access.resolve(jwt);
    const { auditSource } = resolveClientSource(clientType);
    const customerId = new Types.ObjectId(dto.customerRef);

    try {
      return await withTransaction(this.connection, async (session) => {
        const customer = await this.repo.findByIdForJoinRequest(
          customerId,
          session,
        );
        if (!customer || customer.deletedAt || customer.anonymizedAt) {
          throw customerNotFound();
        }
        if (
          (customer.careTeam ?? []).some((member) =>
            member.userId.equals(ctx.actor.userId),
          )
        ) {
          throw new BusinessException(
            ErrorCode.ALREADY_IN_CARE_TEAM,
            'Bạn đã nằm trong nhóm chăm sóc của khách này',
            HttpStatus.CONFLICT,
          );
        }
        const [created] = await this.requestModel.create(
          [
            {
              customerId,
              requesterId: ctx.actor.userId,
              message: dto.message ?? null,
            },
          ],
          { session },
        );
        await this.audit.record(
          {
            entityType: CrmAuditEntityType.CARE_TEAM_REQUEST,
            entityId: created._id,
            customerId,
            action: CrmAuditAction.JOIN_REQUEST_CREATED,
            actor: { sub: String(ctx.actor.userId) },
            source: auditSource,
          },
          session,
        );
        await this.notifyReviewers(
          ctx,
          customer,
          customerId,
          created._id,
          session,
        );
        return {
          id: String(created._id),
          status: CareTeamRequestStatus.PENDING as const,
          createdAt: created.createdAt.toISOString(),
        };
      });
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        throw new BusinessException(
          ErrorCode.JOIN_REQUEST_EXISTS,
          'Bạn đã gửi đề nghị tham gia cho khách này và đang chờ duyệt',
          HttpStatus.CONFLICT,
        );
      }
      throw error;
    }
  }

  async list(
    jwt: JwtPayload,
    query: ListCareTeamRequestsQueryDto,
  ): Promise<{ data: CareTeamRequestItemDto[]; meta: PaginationMetaDto }> {
    const ctx = await this.access.resolve(jwt);
    const { page, limit, skip } = normalizePagination(query.page, query.limit);
    const statusFilter = query.status ? { status: query.status } : {};

    const { rows, total, customerNames } =
      query.box === CareTeamRequestBox.MINE
        ? await this.listMine(ctx, statusFilter, skip, limit)
        : await this.listToReview(ctx, statusFilter, skip, limit);

    const maps = await this.refs.resolve({
      userIds: rows.flatMap((row) => [row.requesterId, row.resolvedBy]),
    });
    return {
      data: rows.map((row) =>
        this.toItem(row, maps.users, customerNames.get(String(row.customerId))),
      ),
      meta: buildPaginationMeta(total, page, limit),
    };
  }

  async resolve(
    jwt: JwtPayload,
    id: string,
    dto: ResolveCareTeamRequestDto,
    clientType?: string,
  ): Promise<CareTeamRequestItemDto> {
    const ctx = await this.access.resolve(jwt);
    const { auditSource } = resolveClientSource(clientType);
    const isCancel = dto.status === CareTeamRequestStatus.CANCELED;

    const { row, customerName } = await withTransaction(
      this.connection,
      async (session) => {
        const found = await this.requestModel
          .findById(id)
          .session(session)
          .lean()
          .exec();
        if (!found) throw resourceNotFound();
        const request = found as RequestRow;
        const isRequester = request.requesterId.equals(ctx.actor.userId);

        let customerName: string | undefined;
        if (isCancel) {
          // Hủy: chỉ người gửi; người khác không được biết đề nghị này tồn tại.
          if (!isRequester) throw resourceNotFound();
        } else {
          const customer = await this.repo.findOne(
            ctx.scope,
            request.customerId,
            { session, projection: { fullName: 1, careTeam: 1 } },
          );
          // Ngoài phạm vi của người duyệt => như không tồn tại.
          if (!customer) throw resourceNotFound();
          if (isRequester || !this.canReview(ctx, customer.careTeam)) {
            throw careTeamActionForbidden(
              'Chỉ Quản trị, Quản lý hoặc phụ trách chính (không phải người gửi) được duyệt đề nghị',
            );
          }
          customerName = customer.fullName;
        }

        const now = new Date();
        const claimed = await this.requestModel
          .findOneAndUpdate(
            { _id: request._id, status: CareTeamRequestStatus.PENDING },
            {
              $set: {
                status: dto.status,
                resolvedBy: ctx.actor.userId,
                resolvedAt: now,
                resolutionNote: dto.resolutionNote ?? null,
              },
            },
            { session, returnDocument: 'after' },
          )
          .lean()
          .exec();
        if (!claimed) {
          throw new BusinessException(
            ErrorCode.JOIN_REQUEST_RESOLVED,
            'Đề nghị này đã được xử lý trước đó',
            HttpStatus.CONFLICT,
          );
        }

        if (dto.status === CareTeamRequestStatus.APPROVED) {
          await this.addRequesterToTeam(ctx, request, auditSource, session);
        }
        await this.audit.record(
          {
            entityType: CrmAuditEntityType.CARE_TEAM_REQUEST,
            entityId: request._id,
            customerId: request.customerId,
            action: CrmAuditAction.JOIN_REQUEST_RESOLVED,
            actor: { sub: String(ctx.actor.userId) },
            changes: [
              {
                field: 'status',
                from: CareTeamRequestStatus.PENDING,
                to: dto.status,
              },
            ],
            reason: dto.resolutionNote ?? null,
            source: auditSource,
          },
          session,
        );
        if (!isCancel) {
          await this.notifyRequester(request, dto.status, session);
        }
        return { row: claimed, customerName };
      },
    );

    const maps = await this.refs.resolve({
      userIds: [row.requesterId, row.resolvedBy],
    });
    return this.toItem(row, maps.users, customerName);
  }

  /**
   * Báo người có quyền duyệt: phụ trách chính của khách và Quản lý của các nhóm chứa khách (trừ người gửi). Nội dung
   * KHÔNG nêu tên khách (người gửi chưa được xem khách này).
   */
  private async notifyReviewers(
    ctx: AccessContext,
    customer: {
      careTeam?: Array<{ userId: Types.ObjectId; role: CareRole }>;
      teamIds?: Types.ObjectId[];
    },
    customerId: Types.ObjectId,
    requestId: Types.ObjectId,
    session: ClientSession,
  ): Promise<void> {
    const primary = (customer.careTeam ?? []).find(
      (member) => member.role === CareRole.PRIMARY,
    );
    const teams = await this.teamModel
      .find({ _id: { $in: customer.teamIds ?? [] }, deletedAt: null })
      .select('managerIds')
      .session(session)
      .lean()
      .exec();
    const reviewers = new Map<string, Types.ObjectId>();
    for (const userId of [
      ...(primary ? [primary.userId] : []),
      ...teams.flatMap((team) => team.managerIds),
    ]) {
      if (!userId.equals(ctx.actor.userId))
        reviewers.set(String(userId), userId);
    }
    await this.notifications.createMany(
      [...reviewers.values()].map((userId) => ({
        userId,
        type: NotificationType.CARE_TEAM_JOIN_REQUESTED,
        title: 'Có đề nghị tham gia chăm sóc khách',
        body: `${ctx.actor.displayName} đề nghị tham gia nhóm chăm sóc một khách bạn quản lý`,
        priority: NotificationPriority.NORMAL,
        data: {
          customerId,
          requestId,
          deepLink: '/crm/care-team-requests',
        },
      })),
      session,
    );
  }

  /** Báo người gửi kết quả duyệt/từ chối (cùng transaction). Chỉ khi được duyệt mới dẫn tới trang khách. */
  private async notifyRequester(
    request: RequestRow,
    status: CareTeamRequestStatus,
    session: ClientSession,
  ): Promise<void> {
    const approved = status === CareTeamRequestStatus.APPROVED;
    await this.notifications.createMany(
      [
        {
          userId: request.requesterId,
          type: NotificationType.CARE_TEAM_JOIN_RESOLVED,
          title: approved
            ? 'Đề nghị tham gia được duyệt'
            : 'Đề nghị tham gia bị từ chối',
          body: approved
            ? 'Bạn đã được thêm vào nhóm chăm sóc khách theo đề nghị của mình'
            : 'Đề nghị tham gia nhóm chăm sóc của bạn đã bị từ chối',
          data: {
            ...(approved && { customerId: request.customerId }),
            requestId: request._id,
            deepLink: approved
              ? `/crm/customers/${String(request.customerId)}`
              : '/crm/care-team-requests',
          },
        },
      ],
      session,
    );
  }

  /** Duyệt = thêm người gửi làm MEMBER (nhóm đang rỗng thì người đó là PRIMARY); đã có trong nhóm thì không thêm lại. */
  private async addRequesterToTeam(
    ctx: AccessContext,
    request: RequestRow,
    source: CrmAuditSource,
    session: ClientSession,
  ): Promise<void> {
    await this.careTeam.applyInSession(
      ctx,
      String(request.customerId),
      {
        // Quyền duyệt đã kiểm ở `resolve`; người gửi đã chủ động xin tham gia nên không giới hạn theo nhóm người duyệt.
        authorize: () => undefined,
        plan: (current, now) =>
          planAddMembers(
            current,
            {
              userIds: [request.requesterId],
              primaryUserId:
                current.length === 0 ? request.requesterId : undefined,
            },
            ctx.actor.userId,
            now,
            { skipExisting: true },
          ),
        restrictToActorScope: false,
        source,
      },
      session,
    );
  }

  /** Người duyệt: Quản trị, Quản lý (khách trong phạm vi) hoặc phụ trách chính. */
  private canReview(
    ctx: AccessContext,
    careTeam: { userId: Types.ObjectId; role: CareRole }[] | undefined,
  ): boolean {
    if (
      ctx.actor.role === UserRole.ADMIN ||
      ctx.actor.role === UserRole.MANAGER
    ) {
      return true;
    }
    return (careTeam ?? []).some(
      (member) =>
        member.role === CareRole.PRIMARY &&
        member.userId.equals(ctx.actor.userId),
    );
  }

  private async listMine(
    ctx: AccessContext,
    statusFilter: Record<string, unknown>,
    skip: number,
    limit: number,
  ) {
    const filter = { requesterId: ctx.actor.userId, ...statusFilter };
    const [rows, total] = await Promise.all([
      this.requestModel
        .find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .skip(skip)
        .limit(limit)
        .lean()
        .exec(),
      this.requestModel.countDocuments(filter).exec(),
    ]);
    return {
      rows: rows as RequestRow[],
      total,
      // Người gửi chưa thấy khách nên không trả tên khách ở hộp "mình gửi".
      customerNames: new Map<string, string>(),
    };
  }

  /**
   * Hộp "cần duyệt": đề nghị của khách nằm trong phạm vi người duyệt (và, với Nhân viên, mình là phụ trách chính).
   * Một lần `$lookup` (kèm bộ lọc phạm vi dựng từ `CustomersRepository.buildFilter`) thay vì lấy danh sách id khách.
   */
  private async listToReview(
    ctx: AccessContext,
    statusFilter: Record<string, unknown>,
    skip: number,
    limit: number,
  ) {
    const reviewerFilter =
      ctx.actor.role === UserRole.STAFF
        ? {
            careTeam: {
              $elemMatch: { userId: ctx.actor.userId, role: CareRole.PRIMARY },
            },
          }
        : {};
    const customerFilter = this.repo.buildFilter(ctx.scope, reviewerFilter);

    const [result] = await this.requestModel
      .aggregate<{
        rows: Array<RequestRow & { customer: Array<{ fullName: string }> }>;
        total: Array<{ count: number }>;
      }>([
        { $match: statusFilter },
        {
          $lookup: {
            from: CUSTOMERS_COLLECTION,
            let: { customerId: '$customerId' },
            pipeline: [
              { $match: { $expr: { $eq: ['$_id', '$$customerId'] } } },
              { $match: customerFilter },
              { $project: { fullName: 1 } },
            ],
            as: 'customer',
          },
        },
        { $match: { 'customer.0': { $exists: true } } },
        { $sort: { createdAt: -1, _id: -1 } },
        {
          $facet: {
            rows: [{ $skip: skip }, { $limit: limit }],
            total: [{ $count: 'count' }],
          },
        },
      ])
      .exec();
    return {
      rows: result.rows,
      total: result.total[0]?.count ?? 0,
      customerNames: new Map(
        result.rows.map((row) => [
          String(row.customerId),
          row.customer[0].fullName,
        ]),
      ),
    };
  }

  private toItem(
    row: RequestRow,
    users: Map<string, string>,
    customerName?: string,
  ): CareTeamRequestItemDto {
    return {
      id: String(row._id),
      customer: {
        id: String(row.customerId),
        ...(customerName === undefined ? {} : { fullName: customerName }),
      },
      requester: toUserRef(row.requesterId, users)!,
      message: row.message ?? null,
      status: row.status,
      createdAt: row.createdAt.toISOString(),
      resolvedBy: toUserRef(row.resolvedBy, users),
      resolvedAt: row.resolvedAt ? row.resolvedAt.toISOString() : null,
      resolutionNote: row.resolutionNote ?? null,
    };
  }
}
