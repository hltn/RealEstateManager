import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import type { JwtPayload } from '../../../common/decorators/current-user.decorator';
import { PaginationMetaDto } from '../../../common/dto/paginated-response.dto';
import {
  buildPaginationMeta,
  normalizePagination,
} from '../../../common/utils/pagination.util';
import {
  endOfDayUtc,
  startOfDayUtc,
} from '../../../common/utils/timezone.util';
import { ListGroup } from '../catalogs/catalog.enums';
import { Area, AreaDocument } from '../catalogs/schemas/area.schema';
import {
  CustomerStatus,
  CustomerStatusDocument,
} from '../catalogs/schemas/customer-status.schema';
import { CrmAbuseMonitorService } from '../common/security/crm-abuse-monitor.service';
import { CrmRateLimitService } from '../common/security/crm-rate-limit.service';
import { parseSort } from '../common/utils/sort-parser.util';
import { buildPersonaFilterConditions } from '../persona/persona.rules';
import { CustomerAccessService } from './access/customer-access.service';
import {
  collectRefIds,
  LIST_PROJECTION,
  toDeletedListItem,
  toListItem,
} from './customer.mapper';
import { CustomerRefsService } from './customer-refs.service';
import { CustomersRepository, DeletedMode } from './customers.repository';
import {
  CustomerFilterQueryDto,
  ListCustomersQueryDto,
  ListDeletedCustomersQueryDto,
} from './dtos/customer-query.dto';
import {
  CustomerListCountsDto,
  CustomerListItemDto,
  DeletedCustomerListItemDto,
} from './dtos/customer-response.dto';
import {
  buildKeywordCondition,
  parseKeyword,
} from './utils/customer-search.util';

const SORTABLE_FIELDS = [
  'lastUpdatedAt',
  'fullName',
  'progress',
  'createdAt',
  'nextAppointmentAt',
  'lastCareLogAt',
  'personaCompleteness',
] as const;
const VIETNAMESE_COLLATION = { locale: 'vi' } as const;
const NO_MATCH = { _id: { $in: [] as Types.ObjectId[] } };

const toObjectIds = (ids: string[] | undefined): Types.ObjectId[] =>
  (ids ?? []).map((id) => new Types.ObjectId(id));

/** Danh sách khách + `list-counts` (tài liệu 05 mục 2.3, 04 mục 7.1). Mọi truy vấn đi qua `CustomerScope`. */
@Injectable()
export class CustomerListService {
  constructor(
    @InjectModel(CustomerStatus.name)
    private readonly statusModel: Model<CustomerStatusDocument>,
    @InjectModel(Area.name) private readonly areaModel: Model<AreaDocument>,
    private readonly repo: CustomersRepository,
    private readonly access: CustomerAccessService,
    private readonly refs: CustomerRefsService,
    private readonly rateLimit: CrmRateLimitService,
    private readonly abuse: CrmAbuseMonitorService,
  ) {}

  async list(
    jwt: JwtPayload,
    query: ListCustomersQueryDto,
  ): Promise<{ data: CustomerListItemDto[]; meta: PaginationMetaDto }> {
    const ctx = await this.access.resolve(jwt);
    await this.guardSearch(jwt, query.q);
    const { page, limit, skip } = normalizePagination(query.page, query.limit);
    const sort = parseSort(query.sort, SORTABLE_FIELDS, {
      field: 'lastUpdatedAt',
      direction: -1,
    });

    const filter = await this.buildFilter(query, query.listGroup);
    const [docs, total] = await Promise.all([
      this.repo.find(ctx.scope, filter, {
        projection: LIST_PROJECTION,
        sort: { [sort.field]: sort.direction, _id: sort.direction },
        skip,
        limit,
        collation: sort.field === 'fullName' ? VIETNAMESE_COLLATION : undefined,
      }),
      this.repo.count(ctx.scope, filter),
    ]);
    const refMaps = await this.refs.resolve(collectRefIds(docs));
    return {
      data: docs.map((doc) => toListItem(doc, refMaps)),
      meta: buildPaginationMeta(total, page, limit),
    };
  }

  /** Số khách mỗi tab (cùng bộ lọc trừ `listGroup`): 1 aggregation `$group` theo `statusId`. */
  async counts(
    jwt: JwtPayload,
    query: CustomerFilterQueryDto,
  ): Promise<CustomerListCountsDto> {
    const ctx = await this.access.resolve(jwt);
    await this.guardSearch(jwt, query.q);
    const filter = await this.buildFilter(query);

    const [rows, statuses] = await Promise.all([
      this.repo.aggregate<{ _id: Types.ObjectId; count: number }>(
        ctx.scope,
        filter,
        [{ $group: { _id: '$statusId', count: { $sum: 1 } } }],
      ),
      this.statusModel.find({}).select('listGroup').lean().exec(),
    ]);
    const groupOf = new Map(
      statuses.map((status) => [String(status._id), status.listGroup]),
    );
    const counts: CustomerListCountsDto = {
      ALL: 0,
      NOT_CONTACTED: 0,
      INTERESTED: 0,
      NET: 0,
      DROPPED: 0,
      byStatus: [],
    };
    for (const row of rows) {
      counts.ALL += row.count;
      const group: ListGroup | undefined = groupOf.get(String(row._id));
      if (group) counts[group] += row.count;
      counts.byStatus.push({ statusId: String(row._id), count: row.count });
    }
    return counts;
  }

  /** Khách đã xóa mềm (chỉ Quản trị — phạm vi `{}`), mới xóa trước. */
  async listDeleted(
    jwt: JwtPayload,
    query: ListDeletedCustomersQueryDto,
  ): Promise<{ data: DeletedCustomerListItemDto[]; meta: PaginationMetaDto }> {
    const ctx = await this.access.resolve(jwt);
    const { page, limit, skip } = normalizePagination(query.page, query.limit);
    const conditions: Record<string, unknown>[] = [];
    if (query.q) {
      conditions.push(buildKeywordCondition(parseKeyword(query.q)));
    }
    if (query.deletedFrom || query.deletedTo) {
      conditions.push({
        deletedAt: {
          ...(query.deletedFrom && { $gte: startOfDayUtc(query.deletedFrom) }),
          ...(query.deletedTo && { $lte: endOfDayUtc(query.deletedTo) }),
        },
      });
    }
    const filter = conditions.length > 0 ? { $and: conditions } : {};
    const mode: DeletedMode = 'only';
    const [docs, total] = await Promise.all([
      this.repo.find(ctx.scope, filter, {
        deleted: mode,
        projection: LIST_PROJECTION,
        sort: { deletedAt: -1, _id: -1 },
        skip,
        limit,
      }),
      this.repo.count(ctx.scope, filter, mode),
    ]);
    const refMaps = await this.refs.resolve(collectRefIds(docs));
    return {
      data: docs.map((doc) => toDeletedListItem(doc, refMaps)),
      meta: buildPaginationMeta(total, page, limit),
    };
  }

  /** Tìm kiếm có từ khóa: rate limit riêng (30/phút/người) + theo dõi dò số khi từ khóa toàn chữ số. */
  private async guardSearch(
    jwt: JwtPayload,
    q: string | undefined,
  ): Promise<void> {
    if (!q) return;
    const keyword = parseKeyword(q);
    // Cùng từ khóa trong vài giây (list + list-counts, đổi trang) chỉ tốn 1 lượt.
    await this.rateLimit.consumeDeduped(
      jwt.sub,
      'CUSTOMER_SEARCH',
      `${keyword.kind}:${keyword.kind === 'phone' ? keyword.digits : keyword.text}`,
    );
    if (keyword.kind === 'phone') {
      await this.abuse.trackPhoneSearch(jwt.sub, keyword.digits);
    }
  }

  /**
   * Dựng điều kiện lọc (chưa gồm phạm vi/xóa mềm — repository gộp). Thẻ: khách gắn bất kỳ thẻ nào trong `tagIds`;
   * chân dung: `occupation` + `personaFilters` (xem `buildPersonaFilterConditions`).
   * `areaIds` gồm cả khu vực con (qua `ancestorIds`).
   */
  private async buildFilter(
    query: CustomerFilterQueryDto,
    listGroup?: string,
  ): Promise<Record<string, unknown>> {
    const conditions: Record<string, unknown>[] = [];

    const statusCondition = await this.statusCondition(
      query.statusIds,
      listGroup,
    );
    if (statusCondition) conditions.push(statusCondition);

    if (query.sourceIds?.length) {
      conditions.push({ sourceId: { $in: toObjectIds(query.sourceIds) } });
    }
    if (query.projectIds?.length) {
      conditions.push({
        interestedProjectIds: { $in: toObjectIds(query.projectIds) },
      });
    }
    if (query.areaIds?.length) {
      conditions.push({
        areaId: { $in: await this.expandAreas(query.areaIds) },
      });
    }
    if (query.tagIds?.length) {
      conditions.push({ tagIds: { $in: toObjectIds(query.tagIds) } });
    }
    conditions.push(
      ...buildPersonaFilterConditions({
        occupation: query.occupation,
        personaFilters: query.personaFilters,
      }),
    );
    if (query.assigneeIds?.length) {
      conditions.push({
        'careTeam.userId': { $in: toObjectIds(query.assigneeIds) },
      });
    }
    if (query.primaryAssigneeIds?.length) {
      conditions.push({
        primaryAssigneeId: { $in: toObjectIds(query.primaryAssigneeIds) },
      });
    }
    if (query.teamIds?.length) {
      conditions.push({ teamIds: { $in: toObjectIds(query.teamIds) } });
    }
    if (query.progress?.length) {
      conditions.push({ progress: { $in: query.progress.map(Number) } });
    }
    if (query.progressMin !== undefined || query.progressMax !== undefined) {
      conditions.push({
        progress: {
          ...(query.progressMin !== undefined && { $gte: query.progressMin }),
          ...(query.progressMax !== undefined && { $lte: query.progressMax }),
        },
      });
    }
    if (query.updatedFrom || query.updatedTo) {
      conditions.push({
        lastUpdatedAt: {
          ...(query.updatedFrom && { $gte: startOfDayUtc(query.updatedFrom) }),
          ...(query.updatedTo && { $lte: endOfDayUtc(query.updatedTo) }),
        },
      });
    }
    if (query.lastCareFrom || query.lastCareTo) {
      conditions.push({
        lastCareLogAt: {
          ...(query.lastCareFrom && {
            $gte: startOfDayUtc(query.lastCareFrom),
          }),
          ...(query.lastCareTo && { $lte: endOfDayUtc(query.lastCareTo) }),
        },
      });
    }
    if (query.hasNationalId !== undefined) {
      conditions.push({ hasNationalId: query.hasNationalId });
    }
    if (query.q) {
      conditions.push(buildKeywordCondition(parseKeyword(query.q)));
    }
    return conditions.length > 0 ? { $and: conditions } : {};
  }

  /** `listGroup` (tab) + `statusIds` => `statusId $in` (giao của hai tập); tab ALL không lọc. */
  private async statusCondition(
    statusIds: string[] | undefined,
    listGroup: string | undefined,
  ): Promise<Record<string, unknown> | null> {
    let ids: Types.ObjectId[] | null = statusIds?.length
      ? toObjectIds(statusIds)
      : null;
    if (listGroup && listGroup !== 'ALL') {
      const inGroup = await this.statusModel
        .find({ listGroup })
        .select('_id')
        .lean()
        .exec();
      const groupIds = new Set(inGroup.map((status) => String(status._id)));
      ids = ids
        ? ids.filter((id) => groupIds.has(String(id)))
        : inGroup.map((status) => status._id);
    }
    if (ids === null) return null;
    return ids.length > 0 ? { statusId: { $in: ids } } : NO_MATCH;
  }

  private async expandAreas(areaIds: string[]): Promise<Types.ObjectId[]> {
    const roots = toObjectIds(areaIds);
    const areas = await this.areaModel
      .find({ $or: [{ _id: { $in: roots } }, { ancestorIds: { $in: roots } }] })
      .select('_id')
      .lean()
      .exec();
    return areas.map((area) => area._id);
  }
}
