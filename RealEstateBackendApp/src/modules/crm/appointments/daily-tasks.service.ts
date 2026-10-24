import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, PipelineStage, Types } from 'mongoose';
import type { JwtPayload } from '../../../common/decorators/current-user.decorator';
import { PaginationMetaDto } from '../../../common/dto/paginated-response.dto';
import { UserRole } from '../../../common/enums/user-role.enum';
import {
  buildPaginationMeta,
  normalizePagination,
} from '../../../common/utils/pagination.util';
import {
  addDaysToDateKey,
  diffDateKeys,
  vnDateKey,
} from '../../../common/utils/timezone.util';
import { ListGroup } from '../catalogs/catalog.enums';
import {
  CustomerStatus,
  CustomerStatusDocument,
} from '../catalogs/schemas/customer-status.schema';
import { CareLog, CareLogDocument } from '../care-logs/schemas/care-log.schema';
import { CrmSettingsService } from '../crm-settings/crm-settings.service';
import {
  AccessContext,
  CustomerAccessService,
} from '../customers/access/customer-access.service';
import { insufficientRole } from '../customers/customer.errors';
import { toRef, toUserRef } from '../customers/customer-refs.service';
import { CustomerRefsService } from '../customers/customer-refs.service';
import { CustomersRepository } from '../customers/customers.repository';
import {
  PersonaField,
  PersonaFieldDocument,
} from '../persona/schemas/persona-field.schema';
import {
  occasionFallsOn,
  staleAnchorDate,
} from '../reminders/reminder-planner';
import {
  APPOINTMENT_TYPE_LABELS,
  AppointmentStatus,
  AppointmentType,
} from './appointment.constants';
import { customerScopeStages } from './customer-scope-stages.util';
import {
  DailyTaskResponseDto,
  DailyTaskScope,
  DailyTaskSummaryDto,
  ListDailyTasksQueryDto,
  DailyTaskSummaryQueryDto,
} from './dtos/daily-task.dto';
import {
  buildTaskWindow,
  classifyDueAt,
  compareTasks,
  DailyTaskGroup,
  DailyTaskKind,
  DEFAULT_UPCOMING_DAYS,
  occasionDueAt,
  TimeWindow,
  toExcerpt,
  windowToQuery,
} from './daily-task.rules';
import { Appointment, AppointmentDocument } from './schemas/appointment.schema';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
/** Trần số khách quét cho nguồn "dịp đặc biệt" (ngày có quá nhiều dịp thì chỉ lấy phần đầu, an toàn bộ nhớ). */
const OCCASION_CUSTOMER_CAP = 2000;
const CUSTOMER_TASK_PROJECTION =
  'fullName statusId interestedProjectIds primaryAssigneeId';

/** Một việc chưa dựng response (chỉ có id tham chiếu), đủ để sắp xếp và phân trang giữa các nguồn. */
interface TaskCandidate {
  id: string;
  kind: DailyTaskKind;
  dueAt: Date;
  customerId: Types.ObjectId;
  title: string;
  suggestion: string;
  appointmentId?: Types.ObjectId;
  careLogId?: Types.ObjectId;
  assigneeId: Types.ObjectId | null;
}

interface SourceResult {
  /** Tổng số việc của nguồn trong khoảng thời gian (để tính `meta.total`). */
  total: number;
  /** Chỉ `limit` việc đầu theo thứ tự `compareTasks` (đủ để ghép trang chính xác giữa các nguồn). */
  items: TaskCandidate[];
}

interface SourceQuery {
  ctx: AccessContext;
  mine: boolean;
  window: TimeWindow;
  group: DailyTaskGroup | undefined;
  now: Date;
  upcomingDays: number;
  limit: number;
}

const EMPTY: SourceResult = { total: 0, items: [] };

/** Phần field của khách mà các nguồn việc cần (chọn bằng projection, không có SĐT/CCCD). */
type CustomerLeanForTask = {
  _id: Types.ObjectId;
  fullName: string;
  statusId: Types.ObjectId;
  interestedProjectIds?: Types.ObjectId[];
  primaryAssigneeId?: Types.ObjectId | null;
  lastCareLogAt?: Date | null;
  createdAt?: Date;
};

/**
 * "Việc hôm nay" (`/crm/daily-tasks`, tài liệu 05 mục 2.9): TÍNH từ dữ liệu thật, không lưu việc. Bốn nguồn:
 * lịch hẹn SCHEDULED; bước tiếp theo (`nextAction.dueAt`) của nhật ký MỚI NHẤT của khách (chưa có lịch hẹn kèm);
 * dịp đặc biệt trong cửa sổ `occasionLeadDays`; khách lâu chưa chăm sóc (Chưa tiếp cận/Có quan tâm).
 * Mọi nguồn lọc theo `CustomerScope` của người gọi. `scope=mine` (mặc định) chỉ việc của mình; `team` chỉ Quản trị/Quản lý.
 *
 * Phân trang chính xác giữa các nguồn bằng ghép k đường: mỗi nguồn trả `skip + limit` việc đầu đã sắp, ghép lại sắp
 * một lần rồi cắt trang — tổng số việc luôn là tổng đếm của từng nguồn.
 */
@Injectable()
export class DailyTasksService {
  constructor(
    @InjectModel(Appointment.name)
    private readonly appointmentModel: Model<AppointmentDocument>,
    @InjectModel(CareLog.name)
    private readonly careLogModel: Model<CareLogDocument>,
    @InjectModel(CustomerStatus.name)
    private readonly statusModel: Model<CustomerStatusDocument>,
    @InjectModel(PersonaField.name)
    private readonly personaFieldModel: Model<PersonaFieldDocument>,
    private readonly access: CustomerAccessService,
    private readonly repo: CustomersRepository,
    private readonly refs: CustomerRefsService,
    private readonly settings: CrmSettingsService,
  ) {}

  async list(
    jwt: JwtPayload,
    query: ListDailyTasksQueryDto,
  ): Promise<{ data: DailyTaskResponseDto[]; meta: PaginationMetaDto }> {
    const ctx = await this.access.resolve(jwt);
    const mine = this.resolveMine(ctx, query.scope);
    const { page, limit, skip } = normalizePagination(query.page, query.limit);
    const now = new Date();
    const upcomingDays = query.upcomingDays ?? DEFAULT_UPCOMING_DAYS;
    const kinds = new Set(query.kinds ?? Object.values(DailyTaskKind));

    const sources = await this.runSources(
      ctx,
      kinds,
      mine,
      query.group,
      now,
      upcomingDays,
      skip + limit,
    );
    const total = sources.reduce((sum, source) => sum + source.total, 0);
    const pageItems = sources
      .flatMap((source) => source.items)
      .sort(compareTasks)
      .slice(skip, skip + limit);
    return {
      data: await this.toResponses(ctx, pageItems, now, upcomingDays),
      meta: buildPaginationMeta(total, page, limit),
    };
  }

  async summary(
    jwt: JwtPayload,
    query: DailyTaskSummaryQueryDto,
  ): Promise<DailyTaskSummaryDto> {
    const ctx = await this.access.resolve(jwt);
    const mine = this.resolveMine(ctx, query.scope);
    const now = new Date();
    const upcomingDays = query.upcomingDays ?? DEFAULT_UPCOMING_DAYS;
    const kinds = new Set(Object.values(DailyTaskKind));
    const count = async (group: DailyTaskGroup): Promise<number> =>
      (
        await this.runSources(ctx, kinds, mine, group, now, upcomingDays, 1)
      ).reduce((sum, source) => sum + source.total, 0);
    const [overdue, today, upcoming] = await Promise.all([
      count(DailyTaskGroup.OVERDUE),
      count(DailyTaskGroup.TODAY),
      count(DailyTaskGroup.UPCOMING),
    ]);
    return { overdue, today, upcoming };
  }

  // --------------------------------------------------------------------------------------------

  /** `scope=team` chỉ Quản trị/Quản lý (Nhân viên => 403); mặc định `mine`. */
  private resolveMine(ctx: AccessContext, scope?: DailyTaskScope): boolean {
    if (scope !== 'team') return true;
    if (
      ctx.actor.role !== UserRole.ADMIN &&
      ctx.actor.role !== UserRole.MANAGER
    ) {
      throw insufficientRole();
    }
    return false;
  }

  private async runSources(
    ctx: AccessContext,
    kinds: Set<DailyTaskKind>,
    mine: boolean,
    group: DailyTaskGroup | undefined,
    now: Date,
    upcomingDays: number,
    limit: number,
  ): Promise<SourceResult[]> {
    const params: SourceQuery = {
      ctx,
      mine,
      window: buildTaskWindow(group, now, upcomingDays),
      group,
      now,
      upcomingDays,
      limit,
    };
    const settings = await this.settings.get();
    return Promise.all([
      kinds.has(DailyTaskKind.APPOINTMENT)
        ? this.appointmentSource(params)
        : EMPTY,
      kinds.has(DailyTaskKind.FOLLOW_UP) ? this.followUpSource(params) : EMPTY,
      kinds.has(DailyTaskKind.OCCASION)
        ? this.occasionSource(params, settings.occasionLeadDays)
        : EMPTY,
      kinds.has(DailyTaskKind.STALE_CUSTOMER)
        ? this.staleSource(params, settings.staleCustomerDays)
        : EMPTY,
    ]);
  }

  /** Lịch hẹn SCHEDULED trong khoảng; `mine` = mình là người thực hiện hoặc phụ trách chính của khách. */
  private async appointmentSource(params: SourceQuery): Promise<SourceResult> {
    const { ctx, mine, window, limit } = params;
    const pipeline: PipelineStage[] = [
      {
        $match: {
          status: AppointmentStatus.SCHEDULED,
          deletedAt: null,
          startAt: windowToQuery(window),
        },
      },
      ...customerScopeStages(this.repo, ctx, { primaryAssigneeId: 1 }),
      ...(mine
        ? [
            {
              $match: {
                $or: [
                  { assigneeId: ctx.actor.userId },
                  { 'customer.0.primaryAssigneeId': ctx.actor.userId },
                ],
              },
            },
          ]
        : []),
      { $sort: { startAt: 1, _id: 1 } },
      {
        $facet: {
          rows: [{ $limit: limit }],
          total: [{ $count: 'count' }],
        },
      },
    ];
    const [result] = await this.appointmentModel
      .aggregate<{
        rows: Array<{
          _id: Types.ObjectId;
          customerId: Types.ObjectId;
          type: AppointmentType;
          title: string;
          note: string;
          startAt: Date;
          assigneeId: Types.ObjectId;
        }>;
        total: Array<{ count: number }>;
      }>(pipeline)
      .exec();
    return {
      total: result.total[0]?.count ?? 0,
      items: result.rows.map((row) => ({
        id: `APPOINTMENT:${String(row._id)}`,
        kind: DailyTaskKind.APPOINTMENT,
        dueAt: row.startAt,
        customerId: row.customerId,
        title: row.title || APPOINTMENT_TYPE_LABELS[row.type],
        suggestion: row.note,
        appointmentId: row._id,
        assigneeId: row.assigneeId,
      })),
    };
  }

  /**
   * Bước tiếp theo của nhật ký MỚI NHẤT của khách (`occurredAt` = `lastCareLogAt` của khách: có nhật ký mới hơn là
   * đã chăm sóc xong việc này), chưa có lịch hẹn đi kèm. `mine` = mình là người ghi nhật ký hoặc phụ trách chính.
   */
  private async followUpSource(params: SourceQuery): Promise<SourceResult> {
    const { ctx, mine, window, limit } = params;
    const pipeline: PipelineStage[] = [
      {
        $match: {
          deletedAt: null,
          'nextAction.dueAt': windowToQuery(window),
          'nextAction.appointmentId': null,
        },
      },
      ...customerScopeStages(this.repo, ctx, {
        primaryAssigneeId: 1,
        lastCareLogAt: 1,
      }),
      {
        $match: {
          $expr: {
            $eq: [
              '$occurredAt',
              { $arrayElemAt: ['$customer.lastCareLogAt', 0] },
            ],
          },
        },
      },
      ...(mine
        ? [
            {
              $match: {
                $or: [
                  { authorId: ctx.actor.userId },
                  { 'customer.0.primaryAssigneeId': ctx.actor.userId },
                ],
              },
            },
          ]
        : []),
      { $sort: { 'nextAction.dueAt': 1, _id: 1 } },
      {
        $facet: {
          rows: [{ $limit: limit }],
          total: [{ $count: 'count' }],
        },
      },
    ];
    const [result] = await this.careLogModel
      .aggregate<{
        rows: Array<{
          _id: Types.ObjectId;
          customerId: Types.ObjectId;
          authorId: Types.ObjectId;
          nextAction: { suggestion: string | null; dueAt: Date };
        }>;
        total: Array<{ count: number }>;
      }>(pipeline)
      .exec();
    return {
      total: result.total[0]?.count ?? 0,
      items: result.rows.map((row) => ({
        id: `FOLLOW_UP:${String(row._id)}`,
        kind: DailyTaskKind.FOLLOW_UP,
        dueAt: row.nextAction.dueAt,
        customerId: row.customerId,
        title: row.nextAction.suggestion || 'Chăm sóc tiếp theo',
        suggestion: row.nextAction.suggestion ?? '',
        careLogId: row._id,
        assigneeId: row.authorId,
      })),
    };
  }

  /**
   * Dịp đặc biệt từ hôm nay đến hết `max(occasionLeadDays)` ngày (không vượt cửa sổ Sắp tới), bỏ khách đã rơi vào
   * nhóm "Rớt". `mine` = mình nằm trong nhóm chăm sóc. Việc nằm ở nhóm Hôm nay (đúng ngày) hoặc Sắp tới.
   */
  private async occasionSource(
    params: SourceQuery,
    leadDays: readonly number[],
  ): Promise<SourceResult> {
    const { ctx, mine, group, now, upcomingDays } = params;
    if (group === DailyTaskGroup.OVERDUE) return EMPTY;

    const todayKey = vnDateKey(now);
    const lead = Math.min(Math.max(0, ...leadDays), upcomingDays);
    const dateKeys = Array.from({ length: lead + 1 }, (_, offset) =>
      addDaysToDateKey(todayKey, offset),
    ).filter((dateKey) => {
      const dayGroup = classifyDueAt(occasionDueAt(dateKey), now, upcomingDays);
      return group === undefined ? dayGroup !== null : dayGroup === group;
    });
    if (dateKeys.length === 0) return EMPTY;

    const droppedStatusIds = await this.statusIdsOf([ListGroup.DROPPED]);
    const monthDays = dateKeys.flatMap((dateKey) => {
      const [, month, day] = dateKey.split('-').map(Number);
      // 29/02 của người sinh năm nhuận được nhắc vào 28/02 ở năm không nhuận.
      return month === 2 && day === 28
        ? [
            [2, 28],
            [2, 29],
          ]
        : [[month, day]];
    });
    const customers = (await this.repo.find(
      ctx.scope,
      {
        $or: monthDays.map(([month, day]) => ({
          occasions: { $elemMatch: { month, day } },
        })),
        statusId: { $nin: droppedStatusIds },
        ...(mine && { 'careTeam.userId': ctx.actor.userId }),
      },
      {
        projection: 'fullName statusId primaryAssigneeId occasions',
        limit: OCCASION_CUSTOMER_CAP,
      },
    )) as Array<
      CustomerLeanForTask & {
        occasions?: Array<{ fieldKey: string; month: number; day: number }>;
      }
    >;
    if (customers.length === 0) return EMPTY;

    const labels = await this.occasionLabels(
      customers.flatMap((customer) =>
        (customer.occasions ?? []).map((occasion) => occasion.fieldKey),
      ),
    );
    const items: TaskCandidate[] = customers.flatMap((customer) =>
      (customer.occasions ?? []).flatMap((occasion) =>
        dateKeys
          .filter((dateKey) => occasionFallsOn(occasion, dateKey))
          .map((dateKey): TaskCandidate => {
            const label = labels.get(occasion.fieldKey) ?? 'Dịp đặc biệt';
            const daysUntil = diffDateKeys(todayKey, dateKey);
            return {
              id: `OCCASION:${String(customer._id)}:${occasion.fieldKey}:${dateKey}`,
              kind: DailyTaskKind.OCCASION,
              dueAt: occasionDueAt(dateKey),
              customerId: customer._id,
              title:
                daysUntil === 0
                  ? `${label} hôm nay`
                  : daysUntil === 1
                    ? `${label} ngày mai`
                    : `${label} sau ${daysUntil} ngày`,
              suggestion: `Gửi lời chúc ${label.toLowerCase()} tới khách`,
              assigneeId: customer.primaryAssigneeId ?? null,
            };
          }),
      ),
    );
    return {
      total: items.length,
      items: items.sort(compareTasks).slice(0, params.limit),
    };
  }

  /**
   * Khách Chưa tiếp cận/Có quan tâm quá `staleCustomerDays` ngày chưa có nhật ký (tính từ nhật ký mới nhất, hoặc từ
   * lúc tạo khách nếu chưa có nhật ký). Luôn thuộc nhóm "Hôm nay" (việc tồn đọng, không có hạn). `mine` = phụ trách chính.
   */
  private async staleSource(
    params: SourceQuery,
    staleDays: number,
  ): Promise<SourceResult> {
    const { ctx, mine, group, now, limit } = params;
    if (group !== undefined && group !== DailyTaskGroup.TODAY) return EMPTY;

    const staleStatusIds = await this.statusIdsOf([
      ListGroup.NOT_CONTACTED,
      ListGroup.INTERESTED,
    ]);
    const cutoff = new Date(now.getTime() - staleDays * MS_PER_DAY);
    const filter = {
      statusId: { $in: staleStatusIds },
      'careTeam.0': { $exists: true },
      $or: [
        { lastCareLogAt: { $lt: cutoff } },
        { lastCareLogAt: null, createdAt: { $lt: cutoff } },
      ],
      ...(mine && { primaryAssigneeId: ctx.actor.userId }),
    };
    const [total, customers] = await Promise.all([
      this.repo.count(ctx.scope, filter),
      this.repo.find(ctx.scope, filter, {
        projection:
          'fullName statusId primaryAssigneeId lastCareLogAt createdAt',
        sort: { _id: 1 },
        limit,
      }) as Promise<CustomerLeanForTask[]>,
    ]);
    return {
      total,
      items: customers.map((customer) => {
        const anchor = staleAnchorDate(
          customer.lastCareLogAt,
          customer.createdAt ?? now,
        );
        const idleDays = diffDateKeys(anchor, vnDateKey(now));
        return {
          id: `STALE_CUSTOMER:${String(customer._id)}`,
          kind: DailyTaskKind.STALE_CUSTOMER,
          dueAt: now,
          customerId: customer._id,
          title: customer.lastCareLogAt
            ? `${idleDays} ngày chưa chăm sóc`
            : `Chưa có nhật ký chăm sóc sau ${idleDays} ngày`,
          suggestion: 'Liên hệ lại để cập nhật nhu cầu của khách',
          assigneeId: customer.primaryAssigneeId ?? null,
        };
      }),
    };
  }

  private async statusIdsOf(groups: ListGroup[]): Promise<Types.ObjectId[]> {
    const statuses = await this.statusModel
      .find({ listGroup: { $in: groups } })
      .select('_id')
      .lean()
      .exec();
    return statuses.map((status) => status._id);
  }

  private async occasionLabels(keys: string[]): Promise<Map<string, string>> {
    const fields = await this.personaFieldModel
      .find({ key: { $in: [...new Set(keys)] } })
      .select('key label occasionLabel')
      .lean()
      .exec();
    return new Map(
      fields.map((field) => [field.key, field.occasionLabel ?? field.label]),
    );
  }

  /** Dựng response cho các việc của một trang: khách, nhật ký gần nhất và tên người theo lô (không N+1). */
  private async toResponses(
    ctx: AccessContext,
    items: TaskCandidate[],
    now: Date,
    upcomingDays: number,
  ): Promise<DailyTaskResponseDto[]> {
    if (items.length === 0) return [];
    const customerIds = [
      ...new Set(items.map((item) => String(item.customerId))),
    ].map((id) => new Types.ObjectId(id));
    const customers = (await this.repo.find(
      ctx.scope,
      { _id: { $in: customerIds } },
      { projection: CUSTOMER_TASK_PROJECTION },
    )) as CustomerLeanForTask[];
    const customerById = new Map(
      customers.map((customer) => [String(customer._id), customer]),
    );
    const lastLogs = await this.latestCareLogs(customerIds);
    const maps = await this.refs.resolve({
      statusIds: customers.map((customer) => customer.statusId),
      projectIds: customers.flatMap(
        (customer) => customer.interestedProjectIds ?? [],
      ),
      userIds: items.map((item) => item.assigneeId),
    });

    return items.flatMap((item) => {
      const customer = customerById.get(String(item.customerId));
      const group = classifyDueAt(item.dueAt, now, upcomingDays);
      // Khách vừa ra khỏi phạm vi giữa hai truy vấn: bỏ việc thay vì lộ dữ liệu.
      if (!customer || !group) return [];
      const log = lastLogs.get(String(customer._id));
      return [
        {
          id: item.id,
          kind: item.kind,
          dueAt: item.dueAt.toISOString(),
          group,
          customer: {
            id: String(customer._id),
            fullName: customer.fullName,
            status: maps.statuses.get(String(customer.statusId)) ?? {
              id: String(customer.statusId),
              code: '',
              label: '',
              listGroup: undefined as never,
              color: null,
            },
            projects: (customer.interestedProjectIds ?? []).map(
              (projectId) => toRef(projectId, maps.projects)!,
            ),
          },
          title: item.title,
          lastCareLog: log
            ? {
                occurredAt: log.occurredAt.toISOString(),
                excerpt: toExcerpt(log.content),
              }
            : null,
          suggestion: item.suggestion,
          ...(item.appointmentId && {
            appointmentId: String(item.appointmentId),
          }),
          ...(item.careLogId && { careLogId: String(item.careLogId) }),
          assignee: toUserRef(item.assigneeId, maps.users),
          isPrimary:
            !!customer.primaryAssigneeId &&
            customer.primaryAssigneeId.equals(ctx.actor.userId),
        },
      ];
    });
  }

  /** Nhật ký mới nhất của mỗi khách trong lô (một aggregation). */
  private async latestCareLogs(
    customerIds: Types.ObjectId[],
  ): Promise<Map<string, { occurredAt: Date; content: string }>> {
    const rows = await this.careLogModel
      .aggregate<{ _id: Types.ObjectId; occurredAt: Date; content: string }>([
        { $match: { customerId: { $in: customerIds }, deletedAt: null } },
        { $sort: { occurredAt: -1, _id: -1 } },
        {
          $group: {
            _id: '$customerId',
            occurredAt: { $first: '$occurredAt' },
            content: { $first: '$content' },
          },
        },
      ])
      .exec();
    return new Map(rows.map((row) => [String(row._id), row]));
  }
}
