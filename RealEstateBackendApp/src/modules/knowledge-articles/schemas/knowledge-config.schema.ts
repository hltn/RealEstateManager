import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export enum KnowledgeConfigType {
  WP_CONNECTION = 'wp_connection',
  AI_WRITING = 'ai_writing',
  AI_IMAGE = 'ai_image',
  CRON = 'cron',
}

@Schema({ timestamps: true })
export class KnowledgeConfig extends Document {
  @Prop({ required: true, enum: KnowledgeConfigType, unique: true, index: true })
  type: KnowledgeConfigType;

  /**
   * Flexible config payload — shape depends on `type`.
   * - wp_connection: siteUrl, username, appPassword, categoryMapping, tagMapping, …
   * - ai_writing:    promptTemplate, model, provider, maxTokens, temperature, topics, …
   * - ai_image:      enabled, promptTemplate, model, provider, width, height, style
   * - cron:          isActive, frequency, nlDescription, parsedCron, lastRunAt, nextRunAt
   */
  @Prop({ type: Object, required: true })
  config: Record<string, unknown>;
}

export const KnowledgeConfigSchema =
  SchemaFactory.createForClass(KnowledgeConfig);
