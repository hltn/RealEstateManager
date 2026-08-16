import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  KnowledgeConfig,
  KnowledgeConfigType,
} from '../schemas/knowledge-config.schema';

@Injectable()
export class KnowledgeConfigService {
  private readonly logger = new Logger(KnowledgeConfigService.name);

  constructor(
    @InjectModel(KnowledgeConfig.name)
    private readonly configModel: Model<KnowledgeConfig>,
  ) {}

  /**
   * Get a config record by type. Returns null if not yet created.
   */
  async getConfig(
    type: KnowledgeConfigType,
  ): Promise<KnowledgeConfig | null> {
    return this.configModel
      .findOne({ type })
      .lean()
      .exec() as unknown as KnowledgeConfig | null;
  }

  /**
   * Upsert a config record by type.
   * Returns the updated document.
   */
  async updateConfig(
    type: KnowledgeConfigType,
    config: Record<string, unknown>,
  ): Promise<KnowledgeConfig> {
    const updated = await this.configModel
      .findOneAndUpdate(
        { type },
        { type, config, updatedAt: new Date() },
        { upsert: true, new: true },
      )
      .exec();

    this.logger.log(`Config updated: ${type}`);
    return updated;
  }

  // ── Typed helpers ─────────────────────────────────────

  async getWpConfig(): Promise<Record<string, unknown>> {
    const doc = await this.getConfig(KnowledgeConfigType.WP_CONNECTION);
    return doc?.config ?? {};
  }

  async updateWpConfig(
    config: Record<string, unknown>,
  ): Promise<KnowledgeConfig> {
    return this.updateConfig(KnowledgeConfigType.WP_CONNECTION, config);
  }

  async getAiWritingConfig(): Promise<Record<string, unknown>> {
    const doc = await this.getConfig(KnowledgeConfigType.AI_WRITING);
    return doc?.config ?? {};
  }

  async updateAiWritingConfig(
    config: Record<string, unknown>,
  ): Promise<KnowledgeConfig> {
    return this.updateConfig(KnowledgeConfigType.AI_WRITING, config);
  }

  async getAiImageConfig(): Promise<Record<string, unknown>> {
    const doc = await this.getConfig(KnowledgeConfigType.AI_IMAGE);
    return doc?.config ?? {};
  }

  async updateAiImageConfig(
    config: Record<string, unknown>,
  ): Promise<KnowledgeConfig> {
    return this.updateConfig(KnowledgeConfigType.AI_IMAGE, config);
  }

  async getCronConfig(): Promise<Record<string, unknown>> {
    const doc = await this.getConfig(KnowledgeConfigType.CRON);
    return doc?.config ?? {};
  }

  async updateCronConfig(
    config: Record<string, unknown>,
  ): Promise<KnowledgeConfig> {
    return this.updateConfig(KnowledgeConfigType.CRON, config);
  }
}
