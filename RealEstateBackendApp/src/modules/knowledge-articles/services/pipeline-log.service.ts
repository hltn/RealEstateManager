import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  PipelineLog,
  PipelineRunStatus,
} from '../schemas/pipeline-log.schema';
import { PipelineStepInfo } from '../types/knowledge-pipeline-state';
import {
  DEFAULT_LIMIT,
} from '../../../common/dto/pagination-query.dto';

@Injectable()
export class PipelineLogService {
  private readonly logger = new Logger(PipelineLogService.name);

  constructor(
    @InjectModel(PipelineLog.name)
    private readonly logModel: Model<PipelineLog>,
  ) {}

  /** Create a new pipeline run log */
  async createLog(params: {
    batchId: string;
    categorySlug: string;
    source: 'cron' | 'manual';
  }): Promise<PipelineLog> {
    return this.logModel.create({
      batchId: params.batchId,
      categorySlug: params.categorySlug,
      source: params.source,
      status: PipelineRunStatus.RUNNING,
    });
  }

  /** Update article result in the log */
  async addArticleResult(
    batchId: string,
    result: {
      articleId: Types.ObjectId;
      title: string;
      state: string;
      error?: string;
      failedStep?: number;
      wpPostId?: number;
      duration: number;
    },
  ): Promise<void> {
    await this.logModel
      .updateOne(
        { batchId },
        {
          $push: { articleResults: result },
          $inc: {
            totalArticles: 1,
            ...(result.state === 'published' ? { publishedCount: 1 } : {}),
            ...(result.state === 'failed' ? { failedCount: 1 } : {}),
            ...(result.state === 'ready' ? { readyCount: 1 } : {}),
          },
        },
      )
      .exec();
  }

  /** Update step status */
  async updateStep(
    batchId: string,
    step: number,
    patch: {
      status: 'pending' | 'running' | 'done' | 'error';
      result?: unknown;
      error?: string;
    },
  ): Promise<void> {
    const now = new Date().toISOString();
    const stepUpdate: Record<string, unknown> = {
      'steps.$.status': patch.status,
    };

    if (patch.result !== undefined) {
      stepUpdate['steps.$.result'] = patch.result;
    }
    if (patch.error !== undefined) {
      stepUpdate['steps.$.error'] = patch.error;
    }
    if (patch.status === 'running') {
      stepUpdate['steps.$.startedAt'] = now;
    }
    if (patch.status === 'done' || patch.status === 'error') {
      stepUpdate['steps.$.completedAt'] = now;
    }

    await this.logModel
      .updateOne(
        { batchId, 'steps.step': step },
        { $set: stepUpdate },
      )
      .exec();
  }

  /** Update total duration for a pipeline run */
  async updateTotalDuration(
    batchId: string,
    totalDuration: number,
  ): Promise<void> {
    await this.logModel
      .updateOne({ batchId }, { $set: { totalDuration } })
      .exec();
  }

  /** Mark pipeline as completed/failed */
  async finalizeLog(
    batchId: string,
    status: PipelineRunStatus,
    summary?: {
      publishedCount: number;
      failedCount: number;
      readyCount: number;
      errorSummary?: string;
    },
  ): Promise<void> {
    const update: Record<string, unknown> = { status };

    if (summary) {
      update.publishedCount = summary.publishedCount;
      update.failedCount = summary.failedCount;
      update.readyCount = summary.readyCount;
      if (summary.errorSummary) {
        update.errorSummary = summary.errorSummary;
      }
    }

    await this.logModel.updateOne({ batchId }, { $set: update }).exec();
  }

  /** Paginated list */
  async listLogs(query: {
    page: number;
    limit: number;
    status?: string;
    category?: string;
  }): Promise<{
    data: PipelineLog[];
    meta: { page: number; limit: number; total: number; totalPages: number };
  }> {
    const { page = 1, limit = DEFAULT_LIMIT, status, category } = query;

    const filter: Record<string, unknown> = {};
    if (status) {
      filter.status = status;
    }
    if (category) {
      filter.categorySlug = category;
    }

    const [data, total] = await Promise.all([
      this.logModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean()
        .exec(),
      this.logModel.countDocuments(filter).exec(),
    ]);

    return {
      data: data as unknown as PipelineLog[],
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /** Get detail by batchId */
  async getLogByBatchId(batchId: string): Promise<PipelineLog | null> {
    return this.logModel.findOne({ batchId }).lean().exec() as unknown as PipelineLog | null;
  }

  /**
   * Mark all PipelineLog documents with status `RUNNING` as `FAILED`.
   * Called on server startup to clean up stale in-memory state that was lost during restart.
   * Returns the number of logs updated.
   */
  async markRunningAsFailed(errorMessage: string): Promise<number> {
    const result = await this.logModel
      .updateMany(
        { status: PipelineRunStatus.RUNNING },
        {
          $set: {
            status: PipelineRunStatus.FAILED,
            errorSummary: errorMessage,
          },
        },
      )
      .exec();

    return result.modifiedCount;
  }
}
