import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export enum PipelineRunStatus {
  RUNNING = 'running',
  COMPLETED = 'completed',
  FAILED = 'failed',
  PARTIAL = 'partial',
}

@Schema({ timestamps: true })
export class PipelineLog extends Document {
  /** Unique batch/pipeline run ID */
  @Prop({ required: true, unique: true, index: true })
  batchId: string;

  /** Category slug for this run */
  @Prop({ required: true })
  categorySlug: string;

  /** Trigger source */
  @Prop({ required: true, enum: ['cron', 'manual'] })
  source: string;

  /** Overall status */
  @Prop({ required: true, enum: PipelineRunStatus, index: true })
  status: PipelineRunStatus;

  /** Total articles attempted */
  @Prop({ default: 0 })
  totalArticles: number;

  /** Articles that reached 'published' */
  @Prop({ default: 0 })
  publishedCount: number;

  /** Articles that reached 'failed' */
  @Prop({ default: 0 })
  failedCount: number;

  /** Articles in 'ready' state (generated but not yet published) */
  @Prop({ default: 0 })
  readyCount: number;

  /** Per-article results */
  @Prop({ type: [Object], default: [] })
  articleResults: Array<{
    articleId: Types.ObjectId;
    title: string;
    state: string;
    error?: string;
    failedStep?: number;
    wpPostId?: number;
    duration: number;
  }>;

  /** Pipeline step-level results */
  @Prop({ type: [Object], default: [] })
  steps: Array<{
    step: number;
    label: string;
    status: 'pending' | 'running' | 'done' | 'error';
    result?: unknown;
    error?: string;
    startedAt?: string;
    completedAt?: string;
  }>;

  /** Total pipeline duration in ms */
  @Prop({ default: 0 })
  totalDuration: number;

  /** Error summary if overall status is failed */
  @Prop({ type: String, default: null })
  errorSummary: string | null;
}

export const PipelineLogSchema = SchemaFactory.createForClass(PipelineLog);
PipelineLogSchema.index({ createdAt: -1 });
PipelineLogSchema.index({ categorySlug: 1, createdAt: -1 });
PipelineLogSchema.index({ status: 1, createdAt: -1 });
