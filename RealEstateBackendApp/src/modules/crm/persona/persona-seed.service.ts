import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  FeatureFlag,
  FeatureFlagService,
} from '../../../shared/feature-flags/feature-flag.service';
import { CatalogItemType } from '../catalogs/catalog.enums';
import {
  CatalogItem,
  CatalogItemDocument,
} from '../catalogs/schemas/catalog-item.schema';
import { ensureSeeded } from '../seed/ensure-seeded.util';
import { PersonaConfigService } from './persona-config.service';
import { PersonaRecomputeService } from './persona-recompute.service';
import { SEED_PERSONA_FIELDS, SEED_PERSONA_GROUPS } from './persona-seed.data';
import {
  PersonaField,
  PersonaFieldDocument,
} from './schemas/persona-field.schema';

export interface PersonaSeedReport {
  personaGroups: number;
  personaFields: number;
}

/**
 * Seed nhóm trường (`catalog_items` PERSONA_GROUP) và trường chân dung mẫu (tài liệu 04 mục 3.4, gồm nhóm
 * REAL_ESTATE). IDEMPOTENT và KHÔNG GHI ĐÈ: nhận diện bằng `seedKey` nên Quản trị sửa/tắt/xóa mềm trường mẫu không bị
 * seed hoàn tác khi khởi động lại (cùng cơ chế seed của danh mục M1). Chỉ chạy khi `FEATURE_CRM_ENABLED` bật.
 *
 * Tách khỏi `CrmSeedService` (M1) để không đổi báo cáo seed đã có; trường mới thêm vào seed ở bản sau sẽ có mặt sau
 * lần khởi động kế và kích job tính lại độ đầy đủ cho khách cũ.
 */
@Injectable()
export class PersonaSeedService implements OnApplicationBootstrap {
  private readonly logger = new Logger(PersonaSeedService.name);

  constructor(
    @InjectModel(CatalogItem.name)
    private readonly itemModel: Model<CatalogItemDocument>,
    @InjectModel(PersonaField.name)
    private readonly fieldModel: Model<PersonaFieldDocument>,
    private readonly featureFlags: FeatureFlagService,
    private readonly config: PersonaConfigService,
    private readonly recompute: PersonaRecomputeService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!this.featureFlags.isEnabled(FeatureFlag.CRM_ENABLED)) return;
    try {
      const report = await this.seedAll();
      this.logger.log(`Seed chân dung xong: ${JSON.stringify(report)}`);
    } catch (error) {
      // Seed hỏng không được làm sập API; chạy lại ở lần khởi động sau.
      this.logger.error(
        `Seed chân dung thất bại: ${(error as Error)?.message}`,
        (error as Error)?.stack,
      );
    }
  }

  /** Nhóm trước, trường sau. Trả về số bản ghi MỚI được chèn. */
  async seedAll(): Promise<PersonaSeedReport> {
    let personaGroups = 0;
    for (const group of SEED_PERSONA_GROUPS) {
      const created = await ensureSeeded(
        this.itemModel,
        `${CatalogItemType.PERSONA_GROUP}:${group.code}`,
        { type: CatalogItemType.PERSONA_GROUP, code: group.code },
        {
          label: group.label,
          order: group.order,
          isActive: true,
          isSystem: true,
          meta: null,
        },
      );
      if (created) personaGroups += 1;
    }

    let personaFields = 0;
    for (const [index, field] of SEED_PERSONA_FIELDS.entries()) {
      const created = await ensureSeeded(
        this.fieldModel,
        `PERSONA_FIELD:${field.key}`,
        { key: field.key },
        {
          label: field.label,
          helpText: null,
          placeholder: field.placeholder ?? null,
          groupCode: field.groupCode,
          type: field.type,
          options: (field.options ?? []).map((option) => ({
            ...option,
            isActive: true,
          })),
          order: index + 1,
          weight: 1,
          suggestPriority: field.suggestPriority,
          isFilterable: field.isFilterable ?? false,
          isOccasion: field.isOccasion ?? false,
          occasionLabel: field.occasionLabel ?? null,
          linkedCriterion: field.linkedCriterion ?? null,
          isSensitive: false,
          isSystem: true,
          isActive: true,
        },
      );
      if (created) personaFields += 1;
    }
    // Trường mới chèn làm đổi mẫu số độ đầy đủ của khách cũ: chỉ instance nào chèn THẬT mới tăng phiên bản cấu hình
    // (instance khác thấy trường đã có thì không chèn, không tăng) rồi kích job tính lại.
    if (personaFields > 0) {
      await this.config.bumpVersionNow();
      void this.recompute.run();
    }
    return { personaGroups, personaFields };
  }
}
