import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import type { JwtPayload } from '../../../common/decorators/current-user.decorator';
import { BusinessException } from '../../../common/exceptions/business.exception';
import { ErrorCode } from '../../../common/exceptions/error-codes';
import { PaginationMetaDto } from '../../../common/dto/paginated-response.dto';
import {
  buildPaginationMeta,
  normalizePagination,
} from '../../../common/utils/pagination.util';
import {
  endOfDayUtc,
  startOfDayUtc,
} from '../../../common/utils/timezone.util';
import { CrmAuditAction } from '../audit-logs/crm-audit.constants';
import {
  CrmAuditLog,
  CrmAuditLogDocument,
} from '../audit-logs/schemas/crm-audit-log.schema';
import { ListGroup } from '../catalogs/catalog.enums';
import { Area, AreaDocument } from '../catalogs/schemas/area.schema';
import {
  CustomerStatus,
  CustomerStatusDocument,
} from '../catalogs/schemas/customer-status.schema';
import { CrmAbuseMonitorService } from '../common/security/crm-abuse-monitor.service';
import { CrmRateLimitService } from '../common/security/crm-rate-limit.service';
import { parseSort } from '../common/utils/sort-parser.util';
import {
  refArrayInCondition,
  refInCondition,
} from '../common/utils/ref-codes-condition.util';
import { statusInRefsCondition } from '../common/utils/status-group-codes.util';
import { buildPersonaFilterConditions } from '../persona/persona.rules';
import { CustomerAccessService } from './access/customer-access.service';
import {
  collectRefIds,
  LIST_PROJECTION,
  toDeletedListItem,
  toListItem,
} from './customer.mapper';
import {
  CatalogRef,
  CatalogRefKind,
  CustomerRefsService,
  normalizeCodes,
} from './customer-refs.service';
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
/** Kết quả chuẩn hóa một bộ lọc danh mục; `codeRefs` có sẵn khi đã dịch mã (gửi cả id lẫn code). */
interface ResolvedFilterRef {
  ids?: Types.ObjectId[];
  codes?: string[];
  codeRefs?: CatalogRef[];
}

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
    @InjectModel(CrmAuditLog.name)
    private readonly auditModel: Model<CrmAuditLogDocument>,
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

  /**
   * Số khách mỗi tab (cùng bộ lọc trừ `listGroup`): 1 aggregation `$group` theo `statusCode` (FR-40).
   * Nhóm kèm `statusId` để khách chưa có `statusCode` (dữ liệu cũ, trước khi lệnh bù chạy) vẫn được đếm đúng
   * bằng cách dịch id sang mã trong bộ nhớ, nên tổng không bao giờ thiếu khách.
   */
  async counts(
    jwt: JwtPayload,
    query: CustomerFilterQueryDto,
  ): Promise<CustomerListCountsDto> {
    const ctx = await this.access.resolve(jwt);
    await this.guardSearch(jwt, query.q);
    const filter = await this.buildFilter(query);

    const [rows, statuses] = await Promise.all([
      this.repo.aggregate<{
        _id: { code?: string | null; id: Types.ObjectId };
        count: number;
      }>(ctx.scope, filter, [
        {
          $group: {
            _id: { code: '$statusCode', id: '$statusId' },
            count: { $sum: 1 },
          },
        },
      ]),
      this.statusModel.find({}).select('code listGroup').lean().exec(),
    ]);
    const statusById = new Map(
      statuses.map((status) => [String(status._id), status]),
    );
    const statusByCode = new Map(
      statuses.map((status) => [status.code, status]),
    );
    const counts: CustomerListCountsDto = {
      ALL: 0,
      NOT_CONTACTED: 0,
      INTERESTED: 0,
      NET: 0,
      DROPPED: 0,
      byStatus: [],
    };
    // Gộp theo mã (một tình trạng có thể có hàng đã điền mã và hàng chưa điền).
    const byCode = new Map<string, { statusId: string; count: number }>();
    for (const row of rows) {
      counts.ALL += row.count;
      const status =
        (row._id.code ? statusByCode.get(row._id.code) : undefined) ??
        statusById.get(String(row._id.id));
      const group: ListGroup | undefined = status?.listGroup;
      if (group) counts[group] += row.count;
      const code = row._id.code ?? status?.code;
      if (!code) continue;
      const entry = byCode.get(code) ?? {
        statusId: String(status?._id ?? row._id.id),
        count: 0,
      };
      entry.count += row.count;
      byCode.set(code, entry);
    }
    counts.byStatus = [...byCode].map(([statusCode, entry]) => ({
      ...entry,
      statusCode,
    }));
    return counts;
  }

  /** Khách đã xóa mềm (chỉ Quản trị — phạm vi `{}`), mới xóa trước. */
  async listDeleted(
    jwt: JwtPayload,
    query: ListDeletedCustomersQueryDto,
  ): Promise<{ data: DeletedCustomerListItemDto[]; meta: PaginationMetaDto }> {
    const ctx = await this.access.resolve(jwt);
    await this.guardSearch(jwt, query.q);
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
    const [refMaps, reasons] = await Promise.all([
      this.refs.resolve(collectRefIds(docs)),
      this.findDeleteReasons(docs.map((doc) => doc._id)),
    ]);
    return {
      data: docs.map((doc) =>
        toDeletedListItem(doc, refMaps, reasons.get(String(doc._id)) ?? null),
      ),
      meta: buildPaginationMeta(total, page, limit),
    };
  }

  /**
   * Lý do xóa mềm của một trang khách (một truy vấn `$in` theo `customerId`, không N+1): lấy từ audit `CUSTOMER_DELETED`
   * MỚI NHẤT của từng khách (khách xóa, khôi phục rồi xóa lại thì lấy lần sau cùng). Khách đã ẩn danh hóa bị xóa
   * `reason` khỏi audit nên không có kết quả (trả `null`).
   */
  private async findDeleteReasons(
    customerIds: Types.ObjectId[],
  ): Promise<Map<string, string>> {
    if (customerIds.length === 0) return new Map();
    const rows = await this.auditModel
      .find({
        customerId: { $in: customerIds },
        action: CrmAuditAction.CUSTOMER_DELETED,
      })
      .sort({ createdAt: -1 })
      .select('customerId reason')
      .lean()
      .exec();
    const reasons = new Map<string, string>();
    for (const row of rows) {
      const key = String(row.customerId);
      if (row.reason && !reasons.has(key)) reasons.set(key, row.reason);
    }
    return reasons;
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

    const statusCondition = await this.statusCondition(query, listGroup);
    if (statusCondition) conditions.push(statusCondition);

    const sourceFilter = await this.refFilter(
      'source',
      { ids: query.sourceIds, codes: query.sourceCodes },
      { idField: 'sourceId', codeField: 'sourceCode', param: 'sourceCodes' },
    );
    if (sourceFilter) conditions.push(sourceFilter);
    const projectFilter = await this.refFilter(
      'project',
      { ids: query.projectIds, codes: query.projectCodes },
      {
        idField: 'interestedProjectIds',
        codeField: 'interestedProjectCodes',
        param: 'projectCodes',
      },
    );
    if (projectFilter) conditions.push(projectFilter);
    const areaFilter = await this.areaCondition(query);
    if (areaFilter) conditions.push(areaFilter);
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

  /**
   * `listGroup` (tab) + `statusCodes` => `statusCode $in` (giao của hai tập); tab ALL không lọc (FR-40). Kèm nhánh
   * `statusId` cho khách chưa backfill `statusCode` (Architecture Q3) để khách đó không biến mất khỏi tab.
   * `statusIds` (cũ, PWA cũ) giữ nguyên đường cũ: lọc theo `statusId` (giao với tab nếu có).
   */
  private async statusCondition(
    query: CustomerFilterQueryDto,
    listGroup: string | undefined,
  ): Promise<Record<string, unknown> | null> {
    const picked = await this.resolveFilterRef(
      'status',
      { ids: query.statusIds, codes: query.statusCodes },
      'statusCodes',
    );
    const inTab = !!listGroup && listGroup !== 'ALL';

    if (picked.ids) {
      let ids = picked.ids;
      if (inTab) {
        const inGroup = await this.statusModel
          .find({ listGroup })
          .select('_id')
          .lean()
          .exec();
        const groupIds = new Set(inGroup.map((status) => String(status._id)));
        ids = ids.filter((id) => groupIds.has(String(id)));
      }
      return ids.length > 0 ? { statusId: { $in: ids } } : NO_MATCH;
    }

    let codes: string[] | null = picked.codes ?? null;
    if (codes === null && !inTab) return null;
    // Tình trạng của tab, hoặc tình trạng theo `statusCodes`: lấy cả id để khách chưa backfill `statusCode` vẫn khớp.
    const candidates = await this.statusModel
      .find(inTab ? { listGroup } : { code: { $in: codes ?? [] } })
      .select('code')
      .lean()
      .exec();
    if (inTab) {
      const groupCodes = candidates.map((status) => status.code);
      codes = codes
        ? codes.filter((code) => groupCodes.includes(code))
        : groupCodes;
    }
    const picks = codes ?? [];
    if (picks.length === 0) return NO_MATCH;
    return statusInRefsCondition({
      codes: picks,
      ids: candidates
        .filter((status) => picks.includes(status.code))
        .map((status) => status._id),
    });
  }

  /**
   * Lọc nguồn/dự án: `…Codes` lọc theo `code` KÈM nhánh id song song cho khách chưa backfill `…Code` (FR-40,
   * Architecture 5.1.8a); `…Ids` (cũ) lọc thuần theo id. `ids` của nhánh id lấy từ đúng MỘT lần `resolveByCodes`
   * (không N+1). Nguồn là trường đơn (`refInCondition`); dự án quan tâm là mảng (`refArrayInCondition`).
   */
  private async refFilter(
    kind: CatalogRefKind,
    input: { ids?: string[]; codes?: string[] },
    fields: { idField: string; codeField: string; param: string },
  ): Promise<Record<string, unknown> | null> {
    const picked = await this.resolveFilterRef(kind, input, fields.param);
    if (picked.codes) {
      // Dùng lại kết quả dịch của `resolveFilterRef` nếu có (gửi cả id lẫn code), nếu không thì dịch đúng một lần.
      const refs =
        picked.codeRefs ?? (await this.refs.resolveByCodes(kind, picked.codes));
      const condition =
        kind === 'project' ? refArrayInCondition : refInCondition;
      return condition(fields, {
        codes: picked.codes,
        ids: refs.map((ref) => ref.id),
      });
    }
    if (picked.ids) return { [fields.idField]: { $in: picked.ids } };
    return null;
  }

  /**
   * Chuẩn hóa một bộ lọc danh mục: chỉ `codes` -> mã (mã dự án chuẩn hóa chữ HOA); chỉ `ids` -> id (đường cũ);
   * có cả hai: phải cùng một tập bản ghi (nếu không 400) rồi dùng mã. Không có gì -> `{}`.
   * Mã không tồn tại vẫn nằm trong bộ lọc (không khớp khách nào), không báo lỗi.
   */
  private async resolveFilterRef(
    kind: CatalogRefKind,
    input: { ids?: string[]; codes?: string[] },
    param: string,
  ): Promise<ResolvedFilterRef> {
    const codes = input.codes ?? [];
    const ids = input.ids ?? [];
    let codeRefs: CatalogRef[] | undefined;
    if (codes.length === 0) {
      return ids.length > 0 ? { ids: toObjectIds(ids) } : {};
    }
    if (ids.length > 0) {
      const [byCode, byId] = await Promise.all([
        this.refs.resolveByCodes(kind, codes),
        this.refs.resolveByIds(kind, toObjectIds(ids)),
      ]);
      const idSet = new Set(byId.map((ref) => String(ref.id)));
      const sameSet =
        idSet.size === byCode.length &&
        idSet.size === new Set(ids).size &&
        byCode.every((ref) => idSet.has(String(ref.id)));
      if (!sameSet) {
        throw new BusinessException(
          ErrorCode.VALIDATION_FAILED,
          'Bộ lọc id và code không cùng một tập bản ghi',
          HttpStatus.BAD_REQUEST,
          { field: param },
        );
      }
      codeRefs = byCode;
    }
    return { codes: normalizeCodes(kind, codes), codeRefs };
  }

  /**
   * `areaCodes`/`areaIds` gồm cả khu vực con (qua `ancestorIds`). `areaCodes`: nhánh mã dùng `areaCode` của cả cây,
   * nhánh id dùng `areaId` của chính các khu vực đã mở rộng (khách chưa backfill `areaCode`; khu vực con chưa có
   * `code` chỉ còn nhánh id).
   */
  private async areaCondition(
    query: CustomerFilterQueryDto,
  ): Promise<Record<string, unknown> | null> {
    const picked = await this.resolveFilterRef(
      'area',
      { ids: query.areaIds, codes: query.areaCodes },
      'areaCodes',
    );
    if (picked.ids) {
      const areas = await this.expandAreas(picked.ids);
      return { areaId: { $in: areas.map((area) => area._id) } };
    }
    if (!picked.codes) return null;
    const roots =
      picked.codeRefs ?? (await this.refs.resolveByCodes('area', picked.codes));
    const areas = await this.expandAreas(roots.map((ref) => ref.id));
    return refInCondition(
      { codeField: 'areaCode', idField: 'areaId' },
      {
        codes: areas.flatMap((area) => (area.code ? [area.code] : [])),
        ids: areas.map((area) => area._id),
      },
    );
  }

  private expandAreas(
    roots: Types.ObjectId[],
  ): Promise<Array<{ _id: Types.ObjectId; code?: string }>> {
    return this.areaModel
      .find({ $or: [{ _id: { $in: roots } }, { ancestorIds: { $in: roots } }] })
      .select('_id code')
      .lean()
      .exec();
  }
}
