import {
  ForbiddenException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model, Types } from 'mongoose';
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
import { escapeRegex } from '../../../common/utils/regex.util';
import { withTransaction } from '../../../shared/database/with-transaction.util';
import { diffFields } from '../audit-logs/audit-diff.util';
import {
  CrmAuditAction,
  CrmAuditEntityType,
} from '../audit-logs/crm-audit.constants';
import { CrmAuditLogService } from '../audit-logs/crm-audit-log.service';
import { Area, AreaDocument } from '../catalogs/schemas/area.schema';
import { CrmActorService } from '../common/access/crm-actor.service';
import { CrmUsageService } from '../common/crm-usage.service';
import { parseSort } from '../common/utils/sort-parser.util';
import {
  CreateProjectDto,
  ListProjectsQueryDto,
  ProjectDetailResponseDto,
  ProjectResponseDto,
  RestoreProjectDto,
  UpdateProjectDto,
} from './dtos/project.dto';
import {
  assertPriceRange,
  normalizeProjectCode,
  normalizePropertyTypes,
  ProjectStatus,
} from './project.rules';
import { Project, ProjectDocument } from './schemas/project.schema';

const AUDIT_FIELDS = [
  'name',
  'code',
  'developer',
  'location',
  'areaId',
  'propertyTypes',
  'priceFrom',
  'priceTo',
  'status',
  'description',
  'isActive',
] as const;
const SORTABLE_FIELDS = ['name', 'createdAt'] as const;
const VIETNAMESE_COLLATION = { locale: 'vi' } as const;
/** Field của PATCH không được phép `null` (bắt buộc hoặc có giá trị mặc định). */
const NON_NULLABLE_UPDATE_FIELDS = [
  'name',
  'code',
  'status',
  'isActive',
] as const;

type ProjectLean = Project & { _id: Types.ObjectId };

const emptyToNull = (value: string | null | undefined): string | null => {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed === '' ? null : trimmed;
};

/**
 * Dự án (`/crm/projects`, tài liệu 05 mục 2.8). Quản trị ghi; mọi vai trò CRM đọc.
 *
 * Quy tắc xóa (quyết định #8, #30): còn khách chưa xóa mềm tham chiếu => 409 `PROJECT_IN_USE`
 * (Quản trị chuyển `isActive=false`); không còn => xóa mềm; khôi phục qua `restore`.
 */
@Injectable()
export class ProjectsService {
  constructor(
    @InjectModel(Project.name)
    private readonly projectModel: Model<ProjectDocument>,
    @InjectModel(Area.name) private readonly areaModel: Model<AreaDocument>,
    @InjectConnection() private readonly connection: Connection,
    private readonly usage: CrmUsageService,
    private readonly audit: CrmAuditLogService,
    private readonly actors: CrmActorService,
  ) {}

  async list(
    jwt: JwtPayload,
    query: ListProjectsQueryDto,
  ): Promise<{ data: ProjectResponseDto[]; meta: PaginationMetaDto }> {
    // Quyền xem dự án đã xóa đọc từ DB (không tin role trong JWT, có thể đã cũ).
    if (query.isDeleted && !(await this.isActiveAdmin(jwt))) {
      throw new ForbiddenException('Forbidden');
    }
    const { page, limit, skip } = normalizePagination(query.page, query.limit);
    const sort = parseSort(query.sort, SORTABLE_FIELDS, {
      field: 'name',
      direction: 1,
    });

    const filter: Record<string, unknown> = {
      deletedAt: query.isDeleted ? { $ne: null } : null,
    };
    if (query.status) filter.status = query.status;
    if (query.areaId) filter.areaId = new Types.ObjectId(query.areaId);
    if (query.isActive !== undefined) filter.isActive = query.isActive;
    if (query.q) {
      const pattern = new RegExp(escapeRegex(query.q), 'i');
      filter.$or = [
        { name: pattern },
        { code: pattern },
        { developer: pattern },
      ];
    }

    const [docs, total] = await Promise.all([
      this.projectModel
        .find(filter)
        .collation(VIETNAMESE_COLLATION)
        .sort({ [sort.field]: sort.direction, _id: 1 })
        .skip(skip)
        .limit(limit)
        .lean()
        .exec(),
      this.projectModel.countDocuments(filter).exec(),
    ]);
    return {
      data: await this.toResponses(docs),
      meta: buildPaginationMeta(total, page, limit),
    };
  }

  /** Chi tiết: Quản trị xem được cả dự án đã xóa mềm (phục vụ khôi phục); vai trò khác nhận 404. */
  async getById(
    jwt: JwtPayload,
    id: string,
  ): Promise<ProjectDetailResponseDto> {
    const filter: Record<string, unknown> = { _id: new Types.ObjectId(id) };
    if (!(await this.isActiveAdmin(jwt))) filter.deletedAt = null;
    const project = await this.projectModel.findOne(filter).lean().exec();
    if (!project) throw this.notFound();
    return (await this.toDetailResponses([project]))[0];
  }

  async create(
    jwt: JwtPayload,
    dto: CreateProjectDto,
  ): Promise<ProjectDetailResponseDto> {
    assertPriceRange(dto.priceFrom, dto.priceTo);
    if (dto.areaId) await this.assertAreaExists(dto.areaId);
    const actorId = new Types.ObjectId(jwt.sub);

    try {
      const created = await withTransaction(
        this.connection,
        async (session) => {
          const [doc] = await this.projectModel.create(
            [
              {
                name: dto.name,
                code: dto.code,
                codeNormalized: normalizeProjectCode(dto.code),
                developer: emptyToNull(dto.developer),
                location: emptyToNull(dto.location),
                areaId: dto.areaId ? new Types.ObjectId(dto.areaId) : null,
                propertyTypes: normalizePropertyTypes(dto.propertyTypes),
                priceFrom: dto.priceFrom ?? null,
                priceTo: dto.priceTo ?? null,
                status: dto.status ?? ProjectStatus.UPCOMING,
                description: emptyToNull(dto.description),
                isActive: true,
                createdBy: actorId,
                updatedBy: actorId,
              },
            ],
            { session },
          );
          await this.audit.record(
            {
              entityType: CrmAuditEntityType.PROJECT,
              entityId: doc._id,
              action: CrmAuditAction.PROJECT_CREATED,
              actor: jwt,
              changes: diffFields({}, doc.toObject(), AUDIT_FIELDS),
            },
            session,
          );
          return doc.toObject();
        },
      );
      return (await this.toDetailResponses([created]))[0];
    } catch (error) {
      throw this.mapDuplicateCode(error, dto.code);
    }
  }

  async update(
    jwt: JwtPayload,
    id: string,
    dto: UpdateProjectDto,
  ): Promise<ProjectDetailResponseDto> {
    this.assertNoNullForRequiredFields(dto);
    if (dto.areaId) await this.assertAreaExists(dto.areaId);

    try {
      const updated = await withTransaction(
        this.connection,
        async (session) => {
          const projectId = new Types.ObjectId(id);
          const before = await this.projectModel
            .findOne({ _id: projectId, deletedAt: null })
            .session(session)
            .lean()
            .exec();
          if (!before) throw this.notFound();

          const nextPriceFrom =
            dto.priceFrom === undefined ? before.priceFrom : dto.priceFrom;
          const nextPriceTo =
            dto.priceTo === undefined ? before.priceTo : dto.priceTo;
          assertPriceRange(nextPriceFrom, nextPriceTo);

          const patch = this.buildPatch(dto, jwt);
          const after = await this.projectModel
            .findOneAndUpdate(
              { _id: projectId },
              { $set: patch },
              { returnDocument: 'after', session },
            )
            .lean()
            .exec();
          if (!after) throw this.notFound();

          const changes = diffFields(before, after, AUDIT_FIELDS);
          if (changes.length > 0) {
            const isDeactivation = before.isActive && !after.isActive;
            await this.audit.record(
              {
                entityType: CrmAuditEntityType.PROJECT,
                entityId: projectId,
                action: isDeactivation
                  ? CrmAuditAction.PROJECT_DEACTIVATED
                  : CrmAuditAction.PROJECT_UPDATED,
                actor: jwt,
                changes,
              },
              session,
            );
          }
          return after;
        },
      );
      return (await this.toDetailResponses([updated]))[0];
    } catch (error) {
      throw this.mapDuplicateCode(error, dto.code);
    }
  }

  /**
   * Xóa mềm: còn khách chưa xóa mềm quan tâm dự án => 409 PROJECT_IN_USE { customerCount }.
   * Đếm khách và xóa nằm cùng transaction (đếm bằng snapshot) để thu hẹp cửa sổ race; khách được thêm
   * vào dự án SAU lúc đếm vẫn hợp lệ vì dự án xóa mềm có thể khôi phục và hiển thị "đã ngừng".
   */
  async remove(jwt: JwtPayload, id: string): Promise<void> {
    const projectId = new Types.ObjectId(id);
    await withTransaction(this.connection, async (session) => {
      const project = await this.projectModel
        .findOne({ _id: projectId, deletedAt: null })
        .session(session)
        .lean()
        .exec();
      if (!project) throw this.notFound();

      const customerCount = await this.usage.countActiveCustomersByProject(
        projectId,
        session,
      );
      if (customerCount > 0) {
        throw new BusinessException(
          ErrorCode.PROJECT_IN_USE,
          'Dự án đang có khách hàng quan tâm, chỉ có thể ngừng hoạt động',
          HttpStatus.CONFLICT,
          { customerCount },
        );
      }

      await this.projectModel
        .updateOne(
          { _id: projectId },
          {
            $set: {
              deletedAt: new Date(),
              deletedBy: new Types.ObjectId(jwt.sub),
            },
          },
          { session },
        )
        .exec();
      await this.audit.record(
        {
          entityType: CrmAuditEntityType.PROJECT,
          entityId: projectId,
          action: CrmAuditAction.PROJECT_DELETED,
          actor: jwt,
          changes: [{ field: 'code', from: project.code, to: null }],
        },
        session,
      );
    });
  }

  /** Khôi phục dự án đã xóa mềm; dự án không tồn tại hoặc chưa bị xóa => 404 RESOURCE_NOT_FOUND. */
  async restore(
    jwt: JwtPayload,
    dto: RestoreProjectDto,
  ): Promise<ProjectDetailResponseDto> {
    const restored = await withTransaction(this.connection, async (session) => {
      const projectId = new Types.ObjectId(dto.projectId);
      const result = await this.projectModel
        .findOneAndUpdate(
          { _id: projectId, deletedAt: { $ne: null } },
          {
            $set: {
              deletedAt: null,
              deletedBy: null,
              updatedBy: new Types.ObjectId(jwt.sub),
            },
          },
          { returnDocument: 'after', session },
        )
        .lean()
        .exec();
      if (!result) throw this.notFound();

      await this.audit.record(
        {
          entityType: CrmAuditEntityType.PROJECT,
          entityId: projectId,
          action: CrmAuditAction.PROJECT_RESTORED,
          actor: jwt,
          reason: dto.reason ?? null,
        },
        session,
      );
      return result;
    });
    return (await this.toDetailResponses([restored]))[0];
  }

  private async isActiveAdmin(jwt: JwtPayload): Promise<boolean> {
    const actor = await this.actors.resolve(jwt);
    return actor.role === UserRole.ADMIN;
  }

  /** Dựng `$set` cho PATCH từ các field thực sự được gửi (undefined = giữ nguyên, null = xóa giá trị). */
  private buildPatch(
    dto: UpdateProjectDto,
    jwt: JwtPayload,
  ): Record<string, unknown> {
    const patch: Record<string, unknown> = {
      updatedBy: new Types.ObjectId(jwt.sub),
    };
    if (dto.name !== undefined) patch.name = dto.name;
    if (dto.code !== undefined) {
      patch.code = dto.code;
      patch.codeNormalized = normalizeProjectCode(dto.code);
    }
    if (dto.developer !== undefined)
      patch.developer = emptyToNull(dto.developer);
    if (dto.location !== undefined) patch.location = emptyToNull(dto.location);
    if (dto.areaId !== undefined) {
      patch.areaId = dto.areaId ? new Types.ObjectId(dto.areaId) : null;
    }
    if (dto.propertyTypes !== undefined) {
      patch.propertyTypes = normalizePropertyTypes(dto.propertyTypes);
    }
    if (dto.priceFrom !== undefined) patch.priceFrom = dto.priceFrom;
    if (dto.priceTo !== undefined) patch.priceTo = dto.priceTo;
    if (dto.status !== undefined) patch.status = dto.status;
    if (dto.description !== undefined)
      patch.description = emptyToNull(dto.description);
    if (dto.isActive !== undefined) patch.isActive = dto.isActive;
    return patch;
  }

  private assertNoNullForRequiredFields(dto: UpdateProjectDto): void {
    const nulls = NON_NULLABLE_UPDATE_FIELDS.filter(
      (field) => (dto as Record<string, unknown>)[field] === null,
    );
    if (nulls.length > 0) {
      throw new BusinessException(
        ErrorCode.VALIDATION_FAILED,
        `Không được để trống: ${nulls.join(', ')}`,
        HttpStatus.BAD_REQUEST,
        { fields: nulls },
      );
    }
  }

  private async assertAreaExists(areaId: string): Promise<void> {
    const exists = await this.areaModel
      .exists({ _id: new Types.ObjectId(areaId), deletedAt: null })
      .exec();
    if (!exists) throw new NotFoundException('Không tìm thấy khu vực');
  }

  private mapDuplicateCode(error: unknown, code?: string): unknown {
    if (!isDuplicateKeyError(error)) return error;
    return new BusinessException(
      ErrorCode.PROJECT_CODE_DUPLICATED,
      `Mã dự án "${code ?? ''}" đã tồn tại (kể cả dự án đã xóa)`,
      HttpStatus.CONFLICT,
      { code: code ?? null },
    );
  }

  /** Dựng response cho cả lô: khu vực và số khách lấy bằng truy vấn gom, không N+1. */
  private async toResponses(
    projects: ProjectLean[],
  ): Promise<ProjectResponseDto[]> {
    if (projects.length === 0) return [];
    const areaIds = [
      ...new Map(
        projects
          .filter((project) => project.areaId)
          .map((project) => [
            String(project.areaId),
            project.areaId as Types.ObjectId,
          ]),
      ).values(),
    ];
    const [areas, customerCounts] = await Promise.all([
      areaIds.length
        ? this.areaModel
            .find({ _id: { $in: areaIds } })
            .select('name')
            .lean()
            .exec()
        : Promise.resolve([]),
      this.usage.countActiveCustomersByProjects(projects.map((p) => p._id)),
    ]);
    const areaNameById = new Map(
      areas.map((area) => [String(area._id), area.name]),
    );

    return projects.map((project) => ({
      id: String(project._id),
      name: project.name,
      code: project.code,
      developer: project.developer ?? null,
      location: project.location ?? null,
      area: project.areaId
        ? {
            id: String(project.areaId),
            label: areaNameById.get(String(project.areaId)) ?? '',
          }
        : null,
      propertyTypes: normalizePropertyTypes(project.propertyTypes),
      priceFrom: project.priceFrom ?? null,
      priceTo: project.priceTo ?? null,
      status: project.status,
      isActive: project.isActive,
      customerCount: customerCounts.get(String(project._id)) ?? 0,
      deletedAt: project.deletedAt ? project.deletedAt.toISOString() : null,
    }));
  }

  private async toDetailResponses(
    projects: ProjectLean[],
  ): Promise<ProjectDetailResponseDto[]> {
    const base = await this.toResponses(projects);
    return base.map((item, index) => ({
      ...item,
      description: projects[index].description ?? null,
    }));
  }

  private notFound(): NotFoundException {
    return new NotFoundException('Không tìm thấy dự án');
  }
}
