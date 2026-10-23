import { HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import {
  ClientSession,
  Connection,
  isValidObjectId,
  Model,
  Types,
} from 'mongoose';
import type { JwtPayload } from '../../../common/decorators/current-user.decorator';
import { PaginationMetaDto } from '../../../common/dto/paginated-response.dto';
import { BusinessException } from '../../../common/exceptions/business.exception';
import { ErrorCode } from '../../../common/exceptions/error-codes';
import { isDuplicateKeyError } from '../../../common/utils/mongo-error.util';
import {
  buildPaginationMeta,
  normalizePagination,
} from '../../../common/utils/pagination.util';
import { escapeRegex } from '../../../common/utils/regex.util';
import { withTransaction } from '../../../shared/database/with-transaction.util';
import { diffFields } from '../audit-logs/audit-diff.util';
import {
  CrmAuditAction,
  CrmAuditEntityType,
} from '../audit-logs/crm-audit.constants';
import { CrmAuditLogService } from '../audit-logs/crm-audit-log.service';
import { CrmUsageService } from '../common/crm-usage.service';
import { normalizeVietnamese } from '../common/utils/vietnamese-text.util';
import {
  AREA_ROOT_FILTER,
  AreaResponseDto,
  CreateAreaDto,
  ListAreasQueryDto,
  UpdateAreaDto,
} from './dtos/area.dto';
import { Area, AreaDocument } from './schemas/area.schema';

const AUDIT_SUBTYPE = 'AREA';
const AUDIT_FIELDS = [
  'name',
  'type',
  'parentId',
  'adminCode',
  'isLegacy',
  'order',
  'isActive',
] as const;
const VIETNAMESE_COLLATION = { locale: 'vi' } as const;

type AreaLean = Area & { _id: Types.ObjectId };

const validationError = (message: string, details?: Record<string, unknown>) =>
  new BusinessException(
    ErrorCode.VALIDATION_FAILED,
    message,
    HttpStatus.BAD_REQUEST,
    details,
  );

/**
 * Tính lại `ancestorIds` cho một hậu duệ khi khu vực `movedId` đổi cha:
 * giữ phần đường đi từ `movedId` trở xuống, thay phần tổ tiên phía trên bằng `newAncestors`.
 * Hàm thuần để kiểm thử riêng.
 */
export const rebaseAncestors = (
  descendantAncestors: Types.ObjectId[],
  movedId: Types.ObjectId,
  newAncestors: Types.ObjectId[],
): Types.ObjectId[] => {
  const index = descendantAncestors.findIndex((id) => id.equals(movedId));
  return [...newAncestors, ...descendantAncestors.slice(index)];
};

/** Cây khu vực (`/crm/areas`): thêm/sửa/chuyển cha/xóa mềm, giữ nhất quán `ancestorIds`. */
@Injectable()
export class AreasService {
  constructor(
    @InjectModel(Area.name) private readonly areaModel: Model<AreaDocument>,
    @InjectConnection() private readonly connection: Connection,
    private readonly usage: CrmUsageService,
    private readonly audit: CrmAuditLogService,
  ) {}

  async list(
    query: ListAreasQueryDto,
  ): Promise<{ data: AreaResponseDto[]; meta: PaginationMetaDto }> {
    const { page, limit, skip } = normalizePagination(query.page, query.limit);
    const filter: Record<string, unknown> = { deletedAt: null };
    if (query.parentId !== undefined) {
      if (query.parentId === AREA_ROOT_FILTER) filter.parentId = null;
      else if (isValidObjectId(query.parentId)) {
        filter.parentId = new Types.ObjectId(query.parentId);
      } else {
        throw validationError('parentId không hợp lệ');
      }
    }
    if (query.type) filter.type = query.type;
    if (query.isActive !== undefined) filter.isActive = query.isActive;
    if (query.includeLegacy !== true) filter.isLegacy = false;
    if (query.q) {
      filter.nameNormalized = new RegExp(
        escapeRegex(normalizeVietnamese(query.q)),
      );
    }

    const [docs, total] = await Promise.all([
      this.areaModel
        .find(filter)
        .collation(VIETNAMESE_COLLATION)
        .sort({ order: 1, name: 1, _id: 1 })
        .skip(skip)
        .limit(limit)
        .lean()
        .exec(),
      this.areaModel.countDocuments(filter).exec(),
    ]);
    return {
      data: await this.toResponses(docs),
      meta: buildPaginationMeta(total, page, limit),
    };
  }

  async create(jwt: JwtPayload, dto: CreateAreaDto): Promise<AreaResponseDto> {
    try {
      const created = await withTransaction(
        this.connection,
        async (session) => {
          const parent = dto.parentId
            ? await this.requireParent(dto.parentId, session)
            : null;
          const [doc] = await this.areaModel.create(
            [
              {
                name: dto.name,
                nameNormalized: normalizeVietnamese(dto.name),
                type: dto.type,
                parentId: parent?._id ?? null,
                ancestorIds: parent ? [...parent.ancestorIds, parent._id] : [],
                adminCode: dto.adminCode ?? null,
                isLegacy: false,
                order:
                  dto.order ??
                  (await this.nextOrder(parent?._id ?? null, session)),
                isActive: true,
              },
            ],
            { session },
          );
          await this.audit.record(
            {
              entityType: CrmAuditEntityType.CATALOG,
              entitySubtype: AUDIT_SUBTYPE,
              entityId: doc._id,
              action: CrmAuditAction.CATALOG_CREATED,
              actor: jwt,
              changes: diffFields({}, doc.toObject(), AUDIT_FIELDS),
            },
            session,
          );
          return doc.toObject();
        },
      );
      return (await this.toResponses([created]))[0];
    } catch (error) {
      throw this.mapDuplicate(error, dto.name);
    }
  }

  async update(
    jwt: JwtPayload,
    id: string,
    dto: UpdateAreaDto,
  ): Promise<AreaResponseDto> {
    try {
      const updated = await withTransaction(
        this.connection,
        async (session) => {
          const areaId = new Types.ObjectId(id);
          const before = await this.areaModel
            .findOne({ _id: areaId, deletedAt: null })
            .session(session)
            .lean()
            .exec();
          if (!before) throw this.notFound();

          const patch: Record<string, unknown> = {};
          if (dto.name !== undefined) {
            patch.name = dto.name;
            patch.nameNormalized = normalizeVietnamese(dto.name);
          }
          if (dto.isActive !== undefined) patch.isActive = dto.isActive;
          if (dto.isLegacy !== undefined) patch.isLegacy = dto.isLegacy;
          if (dto.order !== undefined) patch.order = dto.order;

          const hasParentChange =
            dto.parentId !== undefined &&
            String(dto.parentId ?? '') !== String(before.parentId ?? '');
          let newAncestors = before.ancestorIds;
          if (hasParentChange) {
            const parent = dto.parentId
              ? await this.requireParent(dto.parentId, session)
              : null;
            if (
              parent &&
              (parent._id.equals(areaId) ||
                parent.ancestorIds.some((a) => a.equals(areaId)))
            ) {
              throw validationError(
                'Không thể chuyển khu vực vào chính nó hoặc vào khu vực con của nó',
              );
            }
            newAncestors = parent ? [...parent.ancestorIds, parent._id] : [];
            if (parent) {
              // "Khóa ghi": hai lần chuyển chéo nhau (A vào B, B vào A) cùng đọc dữ liệu cũ và đều qua được
              // kiểm tra vòng; tăng treeVersion của cha đích + tổ tiên khiến chúng xung đột ghi, một bên bị
              // retry và thấy cây mới (bị chặn bởi kiểm tra vòng ở trên).
              await this.areaModel
                .updateMany(
                  { _id: { $in: newAncestors } },
                  { $inc: { treeVersion: 1 } },
                  { session },
                )
                .exec();
            }
            patch.parentId = parent?._id ?? null;
            patch.ancestorIds = newAncestors;
          }

          const after = await this.areaModel
            .findOneAndUpdate(
              { _id: areaId },
              { $set: patch },
              { returnDocument: 'after', session },
            )
            .lean()
            .exec();
          if (!after) throw this.notFound();

          if (hasParentChange) {
            await this.rebaseDescendants(areaId, newAncestors, session);
          }

          const changes = diffFields(before, after, AUDIT_FIELDS);
          if (changes.length > 0) {
            await this.audit.record(
              {
                entityType: CrmAuditEntityType.CATALOG,
                entitySubtype: AUDIT_SUBTYPE,
                entityId: areaId,
                action: CrmAuditAction.CATALOG_UPDATED,
                actor: jwt,
                changes,
              },
              session,
            );
          }
          return after;
        },
      );
      return (await this.toResponses([updated]))[0];
    } catch (error) {
      throw this.mapDuplicate(error, dto.name);
    }
  }

  /** Xóa mềm: chặn khi còn khu vực con hoặc đang được khách/dự án dùng. */
  async remove(jwt: JwtPayload, id: string): Promise<void> {
    const areaId = new Types.ObjectId(id);
    await withTransaction(this.connection, async (session) => {
      const area = await this.areaModel
        .findOne({ _id: areaId, deletedAt: null })
        .session(session)
        .lean()
        .exec();
      if (!area) throw this.notFound();

      const [childCount, customerCount, projectCount] = await Promise.all([
        this.areaModel
          .countDocuments({ parentId: areaId, deletedAt: null })
          .session(session)
          .exec(),
        this.usage.countCustomersByArea(areaId),
        this.usage.countProjectsByArea(areaId),
      ]);
      const usageCount = customerCount + projectCount;
      if (childCount > 0 || usageCount > 0) {
        throw new BusinessException(
          ErrorCode.CATALOG_IN_USE,
          'Khu vực còn khu vực con hoặc đang được sử dụng, hãy tắt hoạt động thay vì xóa',
          HttpStatus.CONFLICT,
          { usageCount, childCount },
        );
      }

      await this.areaModel
        .updateOne(
          { _id: areaId },
          { $set: { deletedAt: new Date() } },
          { session },
        )
        .exec();
      await this.audit.record(
        {
          entityType: CrmAuditEntityType.CATALOG,
          entitySubtype: AUDIT_SUBTYPE,
          entityId: areaId,
          action: CrmAuditAction.CATALOG_DELETED,
          actor: jwt,
          changes: [{ field: 'name', from: area.name, to: null }],
        },
        session,
      );
    });
  }

  /** Cập nhật `ancestorIds` của mọi hậu duệ sau khi `movedId` đổi cha (1 lần bulkWrite, cùng transaction). */
  private async rebaseDescendants(
    movedId: Types.ObjectId,
    newAncestors: Types.ObjectId[],
    session: ClientSession,
  ): Promise<void> {
    const descendants = await this.areaModel
      .find({ ancestorIds: movedId })
      .select('ancestorIds')
      .session(session)
      .lean()
      .exec();
    if (descendants.length === 0) return;
    await this.areaModel.bulkWrite(
      descendants.map((descendant) => ({
        updateOne: {
          filter: { _id: descendant._id },
          update: {
            $set: {
              ancestorIds: rebaseAncestors(
                descendant.ancestorIds,
                movedId,
                newAncestors,
              ),
            },
          },
        },
      })),
      { session },
    );
  }

  private async requireParent(
    parentId: string,
    session: ClientSession,
  ): Promise<AreaLean> {
    const parent = await this.areaModel
      .findOne({ _id: new Types.ObjectId(parentId), deletedAt: null })
      .session(session)
      .lean()
      .exec();
    if (!parent) throw new NotFoundException('Không tìm thấy khu vực cha');
    return parent;
  }

  private async nextOrder(
    parentId: Types.ObjectId | null,
    session: ClientSession,
  ): Promise<number> {
    const last = await this.areaModel
      .findOne({ parentId, deletedAt: null })
      .sort({ order: -1 })
      .select('order')
      .session(session)
      .lean()
      .exec();
    return (last?.order ?? 0) + 1;
  }

  /** Dựng response cho cả lô khu vực: nạp tên các tổ tiên bằng 1 truy vấn `$in` (không N+1). */
  private async toResponses(areas: AreaLean[]): Promise<AreaResponseDto[]> {
    const ancestorIds = [
      ...new Map(
        areas.flatMap((area) => area.ancestorIds).map((id) => [String(id), id]),
      ).values(),
    ];
    const ancestors = ancestorIds.length
      ? await this.areaModel
          .find({ _id: { $in: ancestorIds } })
          .select('name')
          .lean()
          .exec()
      : [];
    const nameById = new Map(ancestors.map((a) => [String(a._id), a.name]));

    return areas.map((area) => ({
      id: String(area._id),
      label: area.name,
      name: area.name,
      type: area.type,
      parentId: area.parentId ? String(area.parentId) : null,
      path: area.ancestorIds.map((ancestorId) => ({
        id: String(ancestorId),
        label: nameById.get(String(ancestorId)) ?? '',
      })),
      adminCode: area.adminCode ?? null,
      isLegacy: area.isLegacy,
      order: area.order,
      isActive: area.isActive,
    }));
  }

  private mapDuplicate(error: unknown, name?: string): unknown {
    if (!isDuplicateKeyError(error)) return error;
    return new BusinessException(
      ErrorCode.CATALOG_DUPLICATED,
      `Đã có khu vực "${name ?? ''}" trong cùng khu vực cha`,
      HttpStatus.CONFLICT,
      { field: 'name', value: name ?? null },
    );
  }

  private notFound(): NotFoundException {
    return new NotFoundException('Không tìm thấy khu vực');
  }
}
