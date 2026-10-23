import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { isDuplicateKeyError } from '../../../common/utils/mongo-error.util';
import {
  FeatureFlag,
  FeatureFlagService,
} from '../../../shared/feature-flags/feature-flag.service';
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
import { normalizeVietnamese } from '../common/utils/vietnamese-text.util';
import {
  normalizeProjectCode,
  normalizePropertyTypes,
} from '../projects/project.rules';
import { Project, ProjectDocument } from '../projects/schemas/project.schema';
import {
  SEED_AREA_TREE,
  SEED_CONTACT_RESULTS,
  SEED_LEAD_SOURCES,
  SEED_PROJECTS,
  SEED_STATUSES,
  SeedAreaNode,
} from './crm-seed.data';

export interface CrmSeedReport {
  statuses: number;
  leadSources: number;
  contactResults: number;
  areas: number;
  projects: number;
}

/**
 * Seed danh mục + dự án mẫu của CRM. IDEMPOTENT và KHÔNG GHI ĐÈ:
 * mỗi bản ghi chỉ được chèn khi khóa tự nhiên (code / cha+tên / mã dự án) chưa tồn tại — kể cả bản đã xóa mềm —
 * nên chỉnh sửa, ngừng hoạt động hay xóa của Quản trị không bị seed hoàn tác khi khởi động lại.
 * Dùng upsert `$setOnInsert` nên an toàn khi nhiều instance khởi động cùng lúc.
 *
 * Chỉ chạy khi `FEATURE_CRM_ENABLED` bật (tắt cờ = không ghi gì vào DB).
 */
@Injectable()
export class CrmSeedService implements OnApplicationBootstrap {
  private readonly logger = new Logger(CrmSeedService.name);

  constructor(
    @InjectModel(CustomerStatus.name)
    private readonly statusModel: Model<CustomerStatusDocument>,
    @InjectModel(CatalogItem.name)
    private readonly itemModel: Model<CatalogItemDocument>,
    @InjectModel(Area.name) private readonly areaModel: Model<AreaDocument>,
    @InjectModel(Project.name)
    private readonly projectModel: Model<ProjectDocument>,
    private readonly featureFlags: FeatureFlagService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!this.featureFlags.isEnabled(FeatureFlag.CRM_ENABLED)) return;
    try {
      const report = await this.seedAll();
      this.logger.log(`Seed CRM xong: ${JSON.stringify(report)}`);
    } catch (error) {
      // Seed hỏng không được làm sập API; thiếu danh mục sẽ lộ ngay ở màn hình, và seed chạy lại ở lần khởi động sau.
      this.logger.error(
        `Seed CRM thất bại: ${(error as Error)?.message}`,
        (error as Error)?.stack,
      );
    }
  }

  /** Chạy toàn bộ seed theo thứ tự phụ thuộc (khu vực trước dự án). Trả về số bản ghi MỚI được chèn. */
  async seedAll(): Promise<CrmSeedReport> {
    const statuses = await this.seedStatuses();
    const leadSources = await this.seedItems(SEED_LEAD_SOURCES);
    const contactResults = await this.seedItems(SEED_CONTACT_RESULTS);
    const { inserted: areas, idByPath } = await this.seedAreas();
    const projects = await this.seedProjects(idByPath);
    return { statuses, leadSources, contactResults, areas, projects };
  }

  private async seedStatuses(): Promise<number> {
    let inserted = 0;
    for (const status of SEED_STATUSES) {
      const created = await this.ensureSeeded(
        this.statusModel,
        `STATUS:${status.code}`,
        { code: status.code },
        {
          label: status.label,
          listGroup: status.listGroup,
          color: status.color,
          order: status.order,
          isDefault: status.isDefault,
          isSystem: true,
          isActive: true,
        },
      );
      if (created) inserted += 1;
    }
    return inserted;
  }

  private async seedItems(
    items: ReadonlyArray<{
      type: CatalogItemType;
      code: string;
      label: string;
      order: number;
      meta?: { suggestedFollowUpDays: number | null; suggestionText: string };
    }>,
  ): Promise<number> {
    let inserted = 0;
    for (const item of items) {
      const created = await this.ensureSeeded(
        this.itemModel,
        `${item.type}:${item.code}`,
        { type: item.type, code: item.code },
        {
          label: item.label,
          order: item.order,
          isActive: true,
          isSystem: false,
          meta: item.meta ?? null,
        },
      );
      if (created) inserted += 1;
    }
    return inserted;
  }

  /** Seed cây khu vực; trả thêm bản đồ "tỉnh/huyện" -> id để gắn dự án. */
  private async seedAreas(): Promise<{
    inserted: number;
    idByPath: Map<string, Types.ObjectId>;
  }> {
    const idByPath = new Map<string, Types.ObjectId>();
    let inserted = 0;

    interface ParentRef {
      id: Types.ObjectId;
      ancestorIds: Types.ObjectId[];
      /** Đường dẫn chuẩn hóa (không dấu) — dùng làm khóa seed ổn định. */
      keyPath: string;
      /** Đường dẫn hiển thị — khớp `SeedProject.areaPath`. */
      displayPath: string;
    }

    const visit = async (
      node: SeedAreaNode,
      parent: ParentRef | null,
      order: number,
    ): Promise<void> => {
      const nameNormalized = normalizeVietnamese(node.name);
      const parentId = parent?.id ?? null;
      const ancestorIds = parent ? [...parent.ancestorIds, parent.id] : [];
      const keyPath = parent
        ? `${parent.keyPath}/${nameNormalized}`
        : nameNormalized;
      const seedKey = `AREA:${keyPath}`;
      const created = await this.ensureSeeded(
        this.areaModel,
        seedKey,
        { parentId, nameNormalized },
        {
          name: node.name,
          type: node.type,
          ancestorIds,
          adminCode: null,
          isLegacy: false,
          order,
          isActive: true,
        },
      );
      if (created) inserted += 1;

      // Tìm lại theo seedKey (không theo tên): bản ghi có thể đã được Quản trị đổi tên hoặc chuyển cha.
      const saved = await this.areaModel
        .findOne({ seedKey })
        .select('_id ancestorIds')
        .lean()
        .exec();
      if (!saved) return;
      const displayPath = parent
        ? `${parent.displayPath}/${node.name}`
        : node.name;
      idByPath.set(displayPath, saved._id);
      for (const [index, child] of (node.children ?? []).entries()) {
        await visit(
          child,
          {
            id: saved._id,
            ancestorIds: saved.ancestorIds,
            keyPath,
            displayPath,
          },
          index + 1,
        );
      }
    };

    for (const [index, root] of SEED_AREA_TREE.entries()) {
      await visit(root, null, index + 1);
    }
    return { inserted, idByPath };
  }

  private async seedProjects(
    idByPath: Map<string, Types.ObjectId>,
  ): Promise<number> {
    let inserted = 0;
    for (const project of SEED_PROJECTS) {
      const areaId = project.areaPath
        ? (idByPath.get(project.areaPath.join('/')) ?? null)
        : null;
      const codeNormalized = normalizeProjectCode(project.code);
      const created = await this.ensureSeeded(
        this.projectModel,
        `PROJECT:${codeNormalized}`,
        { codeNormalized },
        {
          name: project.name,
          code: project.code,
          developer: project.developer,
          location: project.location,
          areaId,
          propertyTypes: normalizePropertyTypes(project.propertyTypes),
          priceFrom: project.priceFrom,
          priceTo: project.priceTo,
          status: project.status,
          description: project.description,
          isActive: true,
        },
      );
      if (created) inserted += 1;
    }
    return inserted;
  }

  /**
   * Chèn bản ghi mẫu đúng MỘT lần, nhận diện bằng `seedKey` bất biến (không phải tên/mã người dùng sửa được):
   * 1. Đã có bản ghi mang `seedKey` này (kể cả đã đổi tên/mã hay xóa mềm) => bỏ qua.
   * 2. Dữ liệu seed từ TRƯỚC khi có `seedKey`: ghép theo khóa tự nhiên cũ (`naturalKey`: code / cha+tên /
   *    mã dự án), gắn bổ sung `seedKey` rồi bỏ qua — không tạo trùng.
   * 3. Chưa có gì => upsert `$setOnInsert` (an toàn khi nhiều instance khởi động cùng lúc).
   * Trả `true` khi vừa chèn mới; lỗi trùng khóa do race với instance khác coi như "đã có".
   */
  private async ensureSeeded<T>(
    model: Model<T>,
    seedKey: string,
    naturalKey: Record<string, unknown>,
    doc: Record<string, unknown>,
  ): Promise<boolean> {
    if (await model.exists({ seedKey } as never).exec()) return false;

    const legacy = await model
      .findOne(naturalKey as never)
      .select('_id')
      .lean()
      .exec();
    if (legacy) {
      await model
        .updateOne(
          {
            _id: legacy._id,
            seedKey: { $exists: false },
          },
          { $set: { seedKey } },
        )
        .exec();
      return false;
    }

    try {
      const result = await model
        .updateOne(
          { seedKey } as never,
          { $setOnInsert: { ...naturalKey, ...doc, seedKey } },
          { upsert: true },
        )
        .exec();
      return result.upsertedCount === 1;
    } catch (error) {
      if (isDuplicateKeyError(error)) return false;
      throw error;
    }
  }
}
