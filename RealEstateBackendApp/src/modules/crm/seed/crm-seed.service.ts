import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  FeatureFlag,
  FeatureFlagService,
} from '../../../shared/feature-flags/feature-flag.service';
import { AreaType, CatalogItemType } from '../catalogs/catalog.enums';
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
import { ensureSeeded } from './ensure-seeded.util';
import {
  provinceSeedKey,
  SEED_CONTACT_RESULTS,
  SEED_LEAD_SOURCES,
  SEED_PROJECTS,
  SEED_PROVINCES,
  SEED_STATUSES,
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

  /** Chạy toàn bộ seed theo thứ tự phụ thuộc (34 tỉnh/thành trước dự án). Trả về số bản ghi MỚI được chèn. */
  async seedAll(): Promise<CrmSeedReport> {
    const statuses = await this.seedStatuses();
    const leadSources = await this.seedItems(SEED_LEAD_SOURCES);
    const contactResults = await this.seedItems(SEED_CONTACT_RESULTS);
    const { inserted: areas, idByName } = await this.seedAreas();
    const projects = await this.seedProjects(idByName);
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

  /** Seed 34 tỉnh/thành (danh sách phẳng); trả thêm bản đồ "tên tỉnh" -> id để gắn dự án. */
  private async seedAreas(): Promise<{
    inserted: number;
    idByName: Map<string, Types.ObjectId>;
  }> {
    const idByName = new Map<string, Types.ObjectId>();
    let inserted = 0;

    for (const [index, name] of SEED_PROVINCES.entries()) {
      const nameNormalized = normalizeVietnamese(name);
      const seedKey = provinceSeedKey(name);
      const created = await this.ensureSeeded(
        this.areaModel,
        seedKey,
        { parentId: null, nameNormalized },
        {
          name,
          type: AreaType.PROVINCE,
          ancestorIds: [],
          adminCode: null,
          isLegacy: false,
          order: index + 1,
          isActive: true,
        },
      );
      if (created) inserted += 1;

      // Tìm lại theo seedKey (không theo tên): bản ghi có thể đã được Quản trị đổi tên.
      const saved = await this.areaModel
        .findOne({ seedKey })
        .select('_id')
        .lean()
        .exec();
      if (saved) idByName.set(name, saved._id);
    }
    return { inserted, idByName };
  }

  private async seedProjects(
    idByName: Map<string, Types.ObjectId>,
  ): Promise<number> {
    let inserted = 0;
    for (const project of SEED_PROJECTS) {
      const areaId = project.areaName
        ? (idByName.get(project.areaName) ?? null)
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

  /** Chèn bản ghi mẫu đúng một lần theo `seedKey` (xem `ensureSeeded`). Trả `true` khi vừa chèn mới. */
  private ensureSeeded<T>(
    model: Model<T>,
    seedKey: string,
    naturalKey: Record<string, unknown>,
    doc: Record<string, unknown>,
  ): Promise<boolean> {
    return ensureSeeded(model, seedKey, naturalKey, doc);
  }
}
