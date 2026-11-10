import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { ClientSession, Connection, Model, Types } from 'mongoose';
import { CatalogRefDto, RefDto, UserRefDto } from '../../../common/dto/ref.dto';
import { UserRole } from '../../../common/enums/user-role.enum';
import { UserStatus } from '../../../common/enums/user-status.enum';
import { BusinessException } from '../../../common/exceptions/business.exception';
import { ErrorCode } from '../../../common/exceptions/error-codes';
import { highestRole, rolesOf } from '../../../common/utils/user-roles.util';
import { User, UserDocument } from '../../users/schemas/user.schema';
import { CatalogItemType } from '../catalogs/catalog.enums';
import { Area, AreaDocument } from '../catalogs/schemas/area.schema';
import {
  CatalogItem,
  CatalogItemDocument,
} from '../catalogs/schemas/catalog-item.schema';
import {
  CustomerStatus,
  CustomerStatusDocument,
} from '../catalogs/schemas/customer-status.schema';
import { Project, ProjectDocument } from '../projects/schemas/project.schema';
import { Tag, TagDocument } from '../tags/schemas/tag.schema';
import { StatusRefDto } from './dtos/customer-response.dto';

/** Các tham chiếu danh mục mà một thao tác muốn GÁN mới cho khách. */
export interface RefsToAssign {
  statusId?: Types.ObjectId | null;
  sourceId?: Types.ObjectId | null;
  areaId?: Types.ObjectId | null;
  projectIds?: Types.ObjectId[];
  /** Dự án gắn cho lịch hẹn (một dự án, tùy chọn). */
  appointmentProjectId?: Types.ObjectId | null;
  /** Kết quả liên hệ của nhật ký chăm sóc (M3). */
  contactResultId?: Types.ObjectId | null;
}

/** Id cần dịch ra nhãn để dựng response/audit. */
export interface RefIds {
  statusIds?: Array<Types.ObjectId | null | undefined>;
  sourceIds?: Array<Types.ObjectId | null | undefined>;
  areaIds?: Array<Types.ObjectId | null | undefined>;
  projectIds?: Array<Types.ObjectId | null | undefined>;
  contactResultIds?: Array<Types.ObjectId | null | undefined>;
  /** Thẻ (M4): thẻ đã xóa mềm không có nhãn, mapper bỏ qua. */
  tagIds?: Array<Types.ObjectId | null | undefined>;
  userIds?: Array<Types.ObjectId | null | undefined>;
}

/** Mã bất biến (`code`) theo id danh mục, để mapper/audit dựng `CatalogRefDto` khi bản ghi chưa lưu `…Code` (FR-40). */
export interface RefCodeMaps {
  sources: Map<string, string>;
  areas: Map<string, string>;
  /** `codeNormalized` (chữ HOA) của dự án. */
  projects: Map<string, string>;
  contactResults: Map<string, string>;
}

/** Trạng thái tài khoản của một người dùng đã dịch: khóa hay chưa (FR-18) và role cao nhất (cho `careTeam[].user.role`). */
export interface UserRefState {
  isLocked: boolean;
  role: UserRole | null;
}

export interface RefMaps {
  statuses: Map<string, StatusRefDto>;
  sources: Map<string, string>;
  areas: Map<string, string>;
  projects: Map<string, string>;
  contactResults: Map<string, string>;
  /** Mã theo id (cùng tập id với các Map nhãn ở trên); thiếu mã (danh mục bị xóa cứng) thì không có khóa. */
  codes: RefCodeMaps;
  /** Chỉ chứa thẻ CHƯA xóa mềm. */
  tags: Map<string, string>;
  users: Map<string, string>;
  /**
   * Trạng thái khóa + role theo id người dùng (cùng tập id với `users`). Tùy chọn để các bên dựng `RefMaps` thủ công
   * (test, mapper khác) không bị ép khai báo; thiếu thì `toUserRef` không gắn `isLocked`.
   */
  userStates?: Map<string, UserRefState>;
}

/** Loại danh mục có mã tham chiếu `code` (FR-40). */
export type CatalogRefKind =
  | 'status'
  | 'source'
  | 'area'
  | 'project'
  | 'contactResult';

/** Một bản ghi danh mục đã dịch: id, mã bất biến, nhãn (FR-40). */
export interface CatalogRef {
  id: Types.ObjectId;
  code: string;
  label: string;
}

/** Tùy chọn dịch: `activeOnly` chỉ lấy bản đang hoạt động, chưa xóa mềm (dùng khi GÁN MỚI). */
export interface ResolveOptions {
  activeOnly?: boolean;
  session?: ClientSession;
}

/** Đầu vào gán danh mục: `…Id` (cũ) và/hoặc `…Code` (mới); dạng danh sách cho trường nhiều giá trị. */
export interface RefAssignInput {
  ids?: Array<Types.ObjectId | null | undefined> | null;
  codes?: Array<string | null | undefined> | null;
}

/** Đầu vào một trường danh mục đơn trị: `undefined` = không gửi, `null` = xóa (FR-40). */
export interface SingleRefInput {
  id?: string | null;
  code?: string | null;
}

/** Đầu vào một trường danh mục nhiều giá trị: `undefined` = không gửi, `[]` = xóa hết (FR-40). */
export interface ListRefInput {
  ids?: string[];
  codes?: string[];
}

/** Bộ lọc "còn dùng được để gán mới"; trùng điều kiện của `lock`. */
const ACTIVE_FILTER = { isActive: true, deletedAt: null };

const uniqueCodes = (codes: Array<string | null | undefined> = []) => [
  ...new Set(codes.filter((code): code is string => !!code)),
];

/** Chuẩn hóa mã theo loại (mã dự án chữ HOA) RỒI mới khử trùng lặp, để `vin` và `VIN` chỉ tính một. */
export const normalizeCodes = (
  kind: CatalogRefKind,
  codes: Array<string | null | undefined>,
): string[] =>
  uniqueCodes(
    uniqueCodes(codes).map((code) =>
      kind === 'project' ? code.trim().toUpperCase() : code,
    ),
  );

const unique = (ids: Array<Types.ObjectId | null | undefined> = []) => [
  ...new Map(
    ids
      .filter((id): id is Types.ObjectId => !!id)
      .map((id) => [String(id), id]),
  ).values(),
];

/**
 * Tham chiếu danh mục của khách: (1) kiểm + "khóa ghi" các tham chiếu mới gán, (2) dịch id sang nhãn theo lô
 * (`$in` một lần mỗi loại, chống N+1).
 *
 * "Khóa ghi": xóa/ngừng một tình trạng, nguồn, khu vực, dự án đếm số khách đang dùng rồi mới ghi. Nếu việc gán
 * danh mục cho khách chỉ ĐỌC danh mục thì hai thao tác đồng thời cùng thành công (write-skew) và khách trỏ vào
 * danh mục đã xóa. Vì vậy mỗi lần GÁN MỚI, ta `$inc refLock` trên đúng các document danh mục đó TRONG transaction:
 * lệnh ghi này vừa kiểm "còn hoạt động" vừa xung đột ghi với thao tác xóa/ngừng (một bên bị retry và thấy trạng thái mới).
 */
@Injectable()
export class CustomerRefsService {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(CustomerStatus.name)
    private readonly statusModel: Model<CustomerStatusDocument>,
    @InjectModel(CatalogItem.name)
    private readonly catalogModel: Model<CatalogItemDocument>,
    @InjectModel(Area.name) private readonly areaModel: Model<AreaDocument>,
    @InjectModel(Project.name)
    private readonly projectModel: Model<ProjectDocument>,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    @InjectModel(Tag.name) private readonly tagModel: Model<TagDocument>,
  ) {}

  /** Tình trạng mặc định (isDefault, đang hoạt động) — dùng khi tạo khách không chọn tình trạng. */
  async findDefaultStatusId(session: ClientSession): Promise<Types.ObjectId> {
    const status = await this.statusModel
      .findOne({ isDefault: true, isActive: true, deletedAt: null })
      .select('_id')
      .session(session)
      .lean()
      .exec();
    if (!status) {
      throw new BusinessException(
        ErrorCode.VALIDATION_FAILED,
        'Chưa cấu hình tình trạng mặc định cho khách hàng',
        HttpStatus.BAD_REQUEST,
      );
    }
    return status._id;
  }

  /**
   * Tìm tình trạng đang hoạt động theo mã (PT-023: `NET`/`INTERESTED` cho cơ chế tự chuyển).
   * Trả `null` nếu không có/đã ngừng/đã xóa mềm để caller bỏ qua việc tự chuyển thay vì làm hỏng lệnh chính.
   */
  async findActiveStatusByCode(
    code: string,
    session: ClientSession,
  ): Promise<Types.ObjectId | null> {
    const status = await this.statusModel
      .findOne({ code, isActive: true, deletedAt: null })
      .select('_id')
      .session(session)
      .lean()
      .exec();
    return status?._id ?? null;
  }

  /** Kiểm các danh mục mới gán còn hoạt động và khóa ghi chúng; ném 400 nếu có cái không hợp lệ. */
  async lockAndAssert(
    refs: RefsToAssign,
    session: ClientSession,
  ): Promise<void> {
    await this.lock(
      'customer_statuses',
      'statusId',
      'Tình trạng',
      refs.statusId,
      session,
      {},
    );
    await this.lock(
      'catalog_items',
      'sourceId',
      'Nguồn khách',
      refs.sourceId,
      session,
      {
        type: CatalogItemType.LEAD_SOURCE,
      },
    );
    await this.lock('areas', 'areaId', 'Khu vực', refs.areaId, session, {});
    await this.lock(
      'catalog_items',
      'contactResultId',
      'Kết quả liên hệ',
      refs.contactResultId,
      session,
      { type: CatalogItemType.CONTACT_RESULT },
    );
    await this.lock(
      'projects',
      'interestedProjectIds',
      'Dự án',
      refs.projectIds,
      session,
      {},
    );
    await this.lock(
      'projects',
      'projectId',
      'Dự án',
      refs.appointmentProjectId,
      session,
      {},
    );
  }

  private async lock(
    collection: string,
    field: string,
    label: string,
    value: Types.ObjectId | Types.ObjectId[] | null | undefined,
    session: ClientSession,
    extraFilter: Record<string, unknown>,
  ): Promise<void> {
    const ids = unique(Array.isArray(value) ? value : [value]);
    if (ids.length === 0) return;
    const result = await this.connection
      .collection(collection)
      .updateMany(
        { _id: { $in: ids }, deletedAt: null, isActive: true, ...extraFilter },
        { $inc: { refLock: 1 } },
        { session },
      );
    if (result.matchedCount !== ids.length) {
      throw new BusinessException(
        ErrorCode.VALIDATION_FAILED,
        `${label} không tồn tại hoặc đã ngừng hoạt động`,
        HttpStatus.BAD_REQUEST,
        { field },
      );
    }
  }

  /**
   * Dịch `code` sang `{ id, code, label }` theo lô: đúng MỘT `$in` cho mỗi lần gọi (không N+1).
   * Mã dự án so theo `codeNormalized` (chữ HOA). Mã không có trong kết quả tức là không tồn tại
   * (hoặc không hoạt động nếu `activeOnly`).
   */
  resolveByCodes(
    kind: CatalogRefKind,
    codes: Array<string | null | undefined>,
    options: ResolveOptions = {},
  ): Promise<CatalogRef[]> {
    return this.fetchRefs(
      kind,
      normalizeCodes(kind, codes),
      CODE_FIELD[kind],
      options,
    );
  }

  /** Dịch id sang `{ id, code, label }` theo lô (một `$in`); bản ghi xóa mềm vẫn trả về trừ khi `activeOnly`. */
  resolveByIds(
    kind: CatalogRefKind,
    ids: Array<Types.ObjectId | null | undefined>,
    options: ResolveOptions = {},
  ): Promise<CatalogRef[]> {
    return this.fetchRefs(kind, unique(ids), '_id', options);
  }

  /**
   * Chuẩn hóa đầu vào GÁN MỚI về danh sách id đã dịch (để đưa vào `lockAndAssert`).
   * - Chỉ nhận bản đang hoạt động, chưa xóa mềm; thiếu/ngừng/đã xóa: 400 "không tồn tại hoặc đã ngừng hoạt động".
   * - Có cả `…Id` lẫn `…Code` mà không cùng tập bản ghi: 400 VALIDATION_FAILED.
   * Không có cả hai: trả mảng rỗng.
   */
  async resolveForAssign(
    kind: CatalogRefKind,
    input: RefAssignInput,
    field: string,
    session?: ClientSession,
    activeOnly = true,
  ): Promise<CatalogRef[]> {
    const ids = unique(input.ids ?? []);
    const codes = normalizeCodes(kind, input.codes ?? []);
    const options = { activeOnly, session };
    const none: CatalogRef[] = [];
    const [byId, byCode] = await Promise.all([
      ids.length ? this.resolveByIds(kind, ids, options) : none,
      codes.length ? this.resolveByCodes(kind, codes, options) : none,
    ]);
    if (byId.length !== ids.length || byCode.length !== codes.length) {
      throw new BusinessException(
        ErrorCode.VALIDATION_FAILED,
        `${KIND_LABEL[kind]} không tồn tại hoặc đã ngừng hoạt động`,
        HttpStatus.BAD_REQUEST,
        { field },
      );
    }
    if (ids.length && codes.length) {
      const idSet = new Set(byId.map((ref) => String(ref.id)));
      const sameSet =
        idSet.size === byCode.length &&
        byCode.every((ref) => idSet.has(String(ref.id)));
      if (!sameSet) throw mismatchError(kind, field);
    }
    return ids.length ? byId : byCode;
  }

  /**
   * Đầu vào request cho MỘT trường danh mục đơn trị (nguồn, khu vực, tình trạng...): `…Id` (cũ) và/hoặc `…Code` (mới).
   * - Không gửi cả hai (`undefined`): `provided = false`, caller giữ nguyên giá trị hiện có.
   * - `null` (xóa) hoặc không có giá trị: `provided = true`, `ref = null`.
   * - Một bên `null` một bên có giá trị, hoặc id và code không cùng bản ghi: 400 VALIDATION_FAILED.
   * `activeOnly = false` dùng cho SỬA: khách giữ liên kết với danh mục đã ngừng hoạt động, việc kiểm "còn hoạt động"
   * do `lockAndAssert` làm riêng cho giá trị mới gán.
   */
  async resolveSingleInput(
    kind: CatalogRefKind,
    input: SingleRefInput,
    field: string,
    session?: ClientSession,
    activeOnly = true,
  ): Promise<{ provided: boolean; ref: CatalogRef | null }> {
    const hasId = input.id !== undefined;
    const hasCode = input.code !== undefined;
    if (!hasId && !hasCode) return { provided: false, ref: null };
    if (hasId && hasCode && (input.id === null) !== (input.code === null)) {
      throw mismatchError(kind, field);
    }
    if (!input.id && !input.code) return { provided: true, ref: null };
    const [ref] = await this.resolveForAssign(
      kind,
      {
        ids: [input.id ? new Types.ObjectId(input.id) : null],
        codes: [input.code],
      },
      field,
      session,
      activeOnly,
    );
    return { provided: true, ref: ref ?? null };
  }

  /**
   * Như `resolveSingleInput` cho trường nhiều giá trị (dự án quan tâm). Kết quả theo ĐÚNG thứ tự đầu vào (id nếu có,
   * không thì code đã chuẩn hóa), đã khử trùng lặp. Một bên là mảng rỗng, bên kia có phần tử: 400.
   */
  async resolveListInput(
    kind: CatalogRefKind,
    input: ListRefInput,
    field: string,
    session?: ClientSession,
    activeOnly = true,
  ): Promise<{ provided: boolean; refs: CatalogRef[] }> {
    const hasIds = input.ids !== undefined;
    const hasCodes = input.codes !== undefined;
    if (!hasIds && !hasCodes) return { provided: false, refs: [] };
    const ids = unique((input.ids ?? []).map((id) => new Types.ObjectId(id)));
    const codes = normalizeCodes(kind, input.codes ?? []);
    if (hasIds && hasCodes && (ids.length === 0) !== (codes.length === 0)) {
      throw mismatchError(kind, field);
    }
    if (ids.length === 0 && codes.length === 0) {
      return { provided: true, refs: [] };
    }
    const resolved = await this.resolveForAssign(
      kind,
      { ids, codes },
      field,
      session,
      activeOnly,
    );
    const order = ids.length ? ids.map(String) : codes;
    const keyOf = (ref: CatalogRef) => (ids.length ? String(ref.id) : ref.code);
    const byKey = new Map(resolved.map((ref) => [keyOf(ref), ref]));
    return {
      provided: true,
      refs: order.flatMap((key) => {
        const ref = byKey.get(key);
        return ref ? [ref] : [];
      }),
    };
  }

  /** Tình trạng mặc định (isDefault, đang hoạt động) dạng `{ id, code, label }`: ghi kép khi tạo khách không chọn tình trạng. */
  async findDefaultStatusRef(session: ClientSession): Promise<CatalogRef> {
    const status = await this.statusModel
      .findOne({ isDefault: true, isActive: true, deletedAt: null })
      .select('code label')
      .session(session)
      .lean()
      .exec();
    if (!status) {
      throw new BusinessException(
        ErrorCode.VALIDATION_FAILED,
        'Chưa cấu hình tình trạng mặc định cho khách hàng',
        HttpStatus.BAD_REQUEST,
      );
    }
    return { id: status._id, code: status.code, label: status.label };
  }

  /** Như `resolveForAssign` cho trường một giá trị; không gửi gì thì trả `null`. */
  async resolveOneForAssign(
    kind: CatalogRefKind,
    input: { id?: Types.ObjectId | null; code?: string | null },
    field: string,
    session?: ClientSession,
  ): Promise<CatalogRef | null> {
    const [ref] = await this.resolveForAssign(
      kind,
      { ids: [input.id], codes: [input.code] },
      field,
      session,
    );
    return ref ?? null;
  }

  private async fetchRefs(
    kind: CatalogRefKind,
    values: Array<string | Types.ObjectId>,
    matchField: string,
    options: ResolveOptions,
  ): Promise<CatalogRef[]> {
    if (values.length === 0) return [];
    const filter = {
      [matchField]: { $in: values },
      ...(options.activeOnly ? ACTIVE_FILTER : {}),
      ...EXTRA_FILTER[kind],
    };
    const query = this.modelOf(kind)
      .find(filter)
      .select(`${CODE_FIELD[kind]} ${LABEL_FIELD[kind]}`)
      .lean();
    if (options.session) query.session(options.session);
    const rows = (await query.exec()) as Array<
      Record<string, string | Types.ObjectId | undefined>
    >;
    return rows.map((row) => ({
      id: row._id as Types.ObjectId,
      code: String(row[CODE_FIELD[kind]] ?? ''),
      label: String(row[LABEL_FIELD[kind]] ?? ''),
    }));
  }

  private modelOf(kind: CatalogRefKind): Model<any> {
    switch (kind) {
      case 'status':
        return this.statusModel;
      case 'area':
        return this.areaModel;
      case 'project':
        return this.projectModel;
      default:
        return this.catalogModel;
    }
  }

  /** Dịch id sang nhãn theo lô; bản ghi đã xóa mềm vẫn có nhãn (khách cũ giữ liên kết). */
  async resolve(ids: RefIds): Promise<RefMaps> {
    const statusIds = unique(ids.statusIds);
    const sourceIds = unique(ids.sourceIds);
    const areaIds = unique(ids.areaIds);
    const projectIds = unique(ids.projectIds);
    const contactResultIds = unique(ids.contactResultIds);
    const tagIds = unique(ids.tagIds);
    const userIds = unique(ids.userIds);

    const [statuses, sources, areas, projects, contactResults, tags, users] =
      await Promise.all([
        statusIds.length
          ? this.statusModel
              .find({ _id: { $in: statusIds } })
              .select('code label listGroup color')
              .lean()
              .exec()
          : [],
        sourceIds.length
          ? this.catalogModel
              .find({ _id: { $in: sourceIds } })
              .select('label code')
              .lean()
              .exec()
          : [],
        areaIds.length
          ? this.areaModel
              .find({ _id: { $in: areaIds } })
              .select('name code')
              .lean()
              .exec()
          : [],
        projectIds.length
          ? this.projectModel
              .find({ _id: { $in: projectIds } })
              .select('name codeNormalized')
              .lean()
              .exec()
          : [],
        contactResultIds.length
          ? this.catalogModel
              .find({ _id: { $in: contactResultIds } })
              .select('label code')
              .lean()
              .exec()
          : [],
        tagIds.length
          ? this.tagModel
              .find({ _id: { $in: tagIds }, deletedAt: null })
              .select('name')
              .lean()
              .exec()
          : [],
        userIds.length
          ? this.userModel
              .find({ _id: { $in: userIds } })
              .select('displayName status role roles')
              .lean()
              .exec()
          : [],
      ]);

    return {
      statuses: new Map<string, StatusRefDto>(
        statuses.map(
          (status) =>
            [
              String(status._id),
              {
                id: String(status._id),
                code: status.code,
                label: status.label,
                listGroup: status.listGroup,
                color: status.color ?? null,
              },
            ] as [string, StatusRefDto],
        ),
      ),
      sources: toLabelMap(
        sources.map(
          (item) => [item._id, item.label] as [Types.ObjectId, string],
        ),
      ),
      areas: toLabelMap(
        areas.map((item) => [item._id, item.name] as [Types.ObjectId, string]),
      ),
      projects: toLabelMap(
        projects.map(
          (item) => [item._id, item.name] as [Types.ObjectId, string],
        ),
      ),
      contactResults: toLabelMap(
        contactResults.map(
          (item) => [item._id, item.label] as [Types.ObjectId, string],
        ),
      ),
      tags: toLabelMap(
        tags.map((item) => [item._id, item.name] as [Types.ObjectId, string]),
      ),
      users: toLabelMap(
        users.map(
          (item) => [item._id, item.displayName] as [Types.ObjectId, string],
        ),
      ),
      userStates: new Map<string, UserRefState>(
        users.map((item): [string, UserRefState] => [
          String(item._id),
          {
            isLocked: item.status === UserStatus.BLOCKED,
            role: highestRole(rolesOf(item as Pick<User, 'role' | 'roles'>)),
          },
        ]),
      ),
      codes: {
        sources: toCodeMap(sources),
        areas: toCodeMap(areas),
        projects: toCodeMap(projects, 'codeNormalized'),
        contactResults: toCodeMap(contactResults),
      },
    };
  }
}

const CODE_FIELD: Record<CatalogRefKind, string> = {
  status: 'code',
  source: 'code',
  area: 'code',
  project: 'codeNormalized',
  contactResult: 'code',
};

const LABEL_FIELD: Record<CatalogRefKind, string> = {
  status: 'label',
  source: 'label',
  area: 'name',
  project: 'name',
  contactResult: 'label',
};

const EXTRA_FILTER: Record<CatalogRefKind, Record<string, unknown>> = {
  status: {},
  source: { type: CatalogItemType.LEAD_SOURCE },
  area: {},
  project: {},
  contactResult: { type: CatalogItemType.CONTACT_RESULT },
};

const KIND_LABEL: Record<CatalogRefKind, string> = {
  status: 'Tình trạng',
  source: 'Nguồn khách',
  area: 'Khu vực',
  project: 'Dự án',
  contactResult: 'Kết quả liên hệ',
};

/** 400: request gửi cả `…Id` lẫn `…Code` nhưng không cùng một bản ghi (hoặc một bên rỗng một bên có giá trị). */
const mismatchError = (
  kind: CatalogRefKind,
  field: string,
): BusinessException =>
  new BusinessException(
    ErrorCode.VALIDATION_FAILED,
    `${KIND_LABEL[kind]}: id và code không cùng một bản ghi`,
    HttpStatus.BAD_REQUEST,
    { field },
  );

const toLabelMap = (
  rows: Array<[Types.ObjectId, string]>,
): Map<string, string> =>
  new Map(rows.map(([id, label]) => [String(id), label] as [string, string]));

/** Map id -> mã; bản ghi thiếu mã (dữ liệu cũ chưa điền) không có khóa để caller rơi về mã đã lưu. */
const toCodeMap = (
  rows: Array<{ _id: Types.ObjectId }>,
  field = 'code',
): Map<string, string> =>
  new Map(
    rows.flatMap((row) => {
      const code = (row as unknown as Record<string, unknown>)[field];
      return typeof code === 'string' && code
        ? [[String(row._id), code] as [string, string]]
        : [];
    }),
  );

/** Ref `{ id, label }` từ Map nhãn; thiếu nhãn (bản ghi đã bị xóa cứng) thì label rỗng. */
export const toRef = (
  id: Types.ObjectId | null | undefined,
  labels: Map<string, string>,
): RefDto | null =>
  id ? { id: String(id), label: labels.get(String(id)) ?? '' } : null;

/**
 * `{ id, code, label }` (FR-40). `code` dịch từ id (nguồn sự thật: id vẫn do mọi phiên bản ghi); không dịch được
 * (danh mục bị xóa cứng) thì rơi về mã đã lưu trên bản ghi, cuối cùng là chuỗi rỗng, không lỗi.
 */
export const toCatalogRef = (
  id: Types.ObjectId | null | undefined,
  labels: Map<string, string>,
  codes: Map<string, string>,
  storedCode?: string | null,
): CatalogRefDto | null =>
  id
    ? {
        id: String(id),
        code: codes.get(String(id)) ?? storedCode ?? '',
        label: labels.get(String(id)) ?? '',
      }
    : null;

/**
 * `UserRef` từ id. Truyền `states` (từ `RefMaps.userStates`) thì gắn thêm `isLocked` cho người có trong map (FR-18);
 * không truyền (mọi nơi chỉ cần id + tên) thì giữ nguyên hợp đồng cũ, không có `isLocked`.
 */
export const toUserRef = (
  id: Types.ObjectId | null | undefined,
  users: Map<string, string>,
  states?: Map<string, UserRefState>,
): UserRefDto | null => {
  if (!id) return null;
  const key = String(id);
  const ref: UserRefDto = { id: key, displayName: users.get(key) ?? '' };
  const state = states?.get(key);
  if (state) ref.isLocked = state.isLocked;
  return ref;
};
