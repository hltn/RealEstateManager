import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { ClientSession, Connection, Model, Types } from 'mongoose';
import { RefDto, UserRefDto } from '../../../common/dto/ref.dto';
import { BusinessException } from '../../../common/exceptions/business.exception';
import { ErrorCode } from '../../../common/exceptions/error-codes';
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

export interface RefMaps {
  statuses: Map<string, StatusRefDto>;
  sources: Map<string, string>;
  areas: Map<string, string>;
  projects: Map<string, string>;
  contactResults: Map<string, string>;
  /** Chỉ chứa thẻ CHƯA xóa mềm. */
  tags: Map<string, string>;
  users: Map<string, string>;
}

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
              .select('label')
              .lean()
              .exec()
          : [],
        areaIds.length
          ? this.areaModel
              .find({ _id: { $in: areaIds } })
              .select('name')
              .lean()
              .exec()
          : [],
        projectIds.length
          ? this.projectModel
              .find({ _id: { $in: projectIds } })
              .select('name')
              .lean()
              .exec()
          : [],
        contactResultIds.length
          ? this.catalogModel
              .find({ _id: { $in: contactResultIds } })
              .select('label')
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
              .select('displayName')
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
    };
  }
}

const toLabelMap = (
  rows: Array<[Types.ObjectId, string]>,
): Map<string, string> =>
  new Map(rows.map(([id, label]) => [String(id), label] as [string, string]));

/** Ref `{ id, label }` từ Map nhãn; thiếu nhãn (bản ghi đã bị xóa cứng) thì label rỗng. */
export const toRef = (
  id: Types.ObjectId | null | undefined,
  labels: Map<string, string>,
): RefDto | null =>
  id ? { id: String(id), label: labels.get(String(id)) ?? '' } : null;

export const toUserRef = (
  id: Types.ObjectId | null | undefined,
  users: Map<string, string>,
): UserRefDto | null =>
  id ? { id: String(id), displayName: users.get(String(id)) ?? '' } : null;
