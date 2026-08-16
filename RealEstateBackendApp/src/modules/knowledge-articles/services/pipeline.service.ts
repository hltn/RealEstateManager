import {
  Injectable,
  Logger,
  BadRequestException,
  InternalServerErrorException,
  OnModuleInit,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { KnowledgeArticleService } from './knowledge-article.service';
import { KnowledgeConfigService } from './knowledge-config.service';
import { AiWritingService } from './ai-writing.service';
import { AiImageService } from './ai-image.service';
import { WpClientService } from './wp-client.service';
import { PipelineLogService } from './pipeline-log.service';
import { CategoryRotationService } from './category-rotation.service';
import { KnowledgeArticleState } from '../types/knowledge-article-state';
import { PipelineRunStatus } from '../schemas/pipeline-log.schema';
import {
  PipelineStepInfo,
  PIPELINE_STEPS,
} from '../types/knowledge-pipeline-state';
import { Types } from 'mongoose';

/**
 * In-memory store for pipeline job statuses.
 * Job lifecycle: created -> running -> done/error
 *
 * LIMITATION (M-01): This state lives in RAM only and is NOT persisted to MongoDB.
 * On server restart all job polling state is lost. This is an accepted trade-off:
 * the durable pipeline state (per-article results, step statuses, final status) is
 * persisted in the PipelineLog collection, while this Map only backs short-lived
 * job-polling. On startup, `onModuleInit` marks any PipelineLog still stuck in
 * RUNNING as FAILED so the durable state does not stay "running" forever.
 */
const pipelineJobs = new Map<
  string,
  {
    status: 'pending' | 'running' | 'done' | 'error';
    currentStep: number;
    steps: PipelineStepInfo[];
    batchId?: string;
    result?: {
      published: number;
      failed: number;
      ready: number;
      category: string;
    };
    error?: string;
    startedAt: Date;
  }
>();

/**
 * Pipeline orchestration service.
 * Runs the 5-step batch pipeline: pick topics -> AI writing -> AI image -> upload media -> publish to WP.
 *
 * Features:
 * - Concurrent run prevention via global lock
 * - Per-article error isolation (one failed article doesn't block the batch)
 * - Pipeline log recording for every step with duration tracking
 * - Category rotation via CategoryRotationService
 */
@Injectable()
export class PipelineService implements OnModuleInit {
  private readonly logger = new Logger(PipelineService.name);

  /** Global lock to prevent concurrent pipeline runs (not persisted — resets on restart) */
  private isRunning = false;

  constructor(
    private readonly knowledgeArticleService: KnowledgeArticleService,
    private readonly knowledgeConfigService: KnowledgeConfigService,
    private readonly aiWritingService: AiWritingService,
    private readonly aiImageService: AiImageService,
    private readonly wpClientService: WpClientService,
    private readonly pipelineLogService: PipelineLogService,
    private readonly categoryRotationService: CategoryRotationService,
  ) {}

  // ── Lifecycle Hooks ────────────────────────────────────

  /**
   * M-01: On server startup, mark any PipelineLog stuck in RUNNING as FAILED.
   * In-memory job state (pipelineJobs Map) is lost on restart, so we cannot resume
   * or continue those jobs. Marking them failed ensures the durable state does not
   * stay "running" forever and users see an accurate status.
   */
  async onModuleInit(): Promise<void> {
    try {
      const staleCount = await this.pipelineLogService.markRunningAsFailed(
        'server restarted - pipeline state lost',
      );
      if (staleCount > 0) {
        this.logger.warn(
          `M-01 recovery: marked ${staleCount} RUNNING pipeline log(s) as FAILED due to server restart`,
        );
      } else {
        this.logger.log('M-01 startup check: no stale RUNNING pipeline logs found');
      }
    } catch (error: any) {
      this.logger.error(
        `M-01 recovery failed: could not mark stale RUNNING logs as FAILED — ${error.message}`,
        error,
      );
      // Non-fatal — do not block server startup
    }
  }

  // ── Public API ──────────────────────────────────────────

  /**
   * Start batch pipeline — returns immediately with jobId.
   * The pipeline runs asynchronously in the background.
   * Prevents concurrent runs via global lock.
   */
  startPipeline(params?: {
    category?: string;
    articleCount?: number;
    source?: 'cron' | 'manual';
  }): { message: string; jobId: string } {
    if (this.isRunning) {
      throw new BadRequestException(
        'A pipeline is already running. Wait for it to complete or check status.',
      );
    }

    const jobId = randomUUID();
    const steps = PIPELINE_STEPS.map((s) => ({ ...s }));

    pipelineJobs.set(jobId, {
      status: 'running',
      currentStep: 1,
      steps,
      startedAt: new Date(),
    });

    this.isRunning = true;

    // Run asynchronously (fire-and-forget)
    this.runPipeline(
      jobId,
      params?.category,
      params?.articleCount ?? 3,
      params?.source ?? 'manual',
    )
      .then(() => {
        this.isRunning = false;
      })
      .catch((error) => {
        this.logger.error(`Pipeline ${jobId} failed: ${error.message}`, error);
        this.isRunning = false;
        const job = pipelineJobs.get(jobId);
        if (job) {
          job.status = 'error';
          job.error = error.message;
        }
      });

    return { message: 'Pipeline started', jobId };
  }

  /**
   * Check if a pipeline is currently running.
   */
  isPipelineRunning(): boolean {
    return this.isRunning;
  }

  /**
   * Get pipeline job status (for polling).
   */
  getJobStatus(jobId: string): {
    status: string;
    currentStep: number;
    steps: PipelineStepInfo[];
    result?: Record<string, unknown>;
    error?: string;
  } | null {
    const job = pipelineJobs.get(jobId);
    if (!job) return null;

    return {
      status: job.status,
      currentStep: job.currentStep,
      steps: job.steps,
      ...(job.result ? { result: job.result } : {}),
      ...(job.error ? { error: job.error } : {}),
    };
  }

  /**
   * Retry all failed articles in a batch.
   */
  async retryFailedArticles(
    batchId: string,
  ): Promise<{ retriedCount: number }> {
    // Get the pipeline log to find failed articles
    const log = await this.pipelineLogService.getLogByBatchId(batchId);
    if (!log) {
      throw new BadRequestException(`Pipeline log not found for batch: ${batchId}`);
    }

    const failedArticles = (log.articleResults || []).filter(
      (r) => r.state === 'failed',
    );

    let retriedCount = 0;
    for (const article of failedArticles) {
      try {
        await this.knowledgeArticleService.retryArticle(
          article.articleId.toString(),
        );
        retriedCount++;
      } catch (error: any) {
        this.logger.warn(
          `Failed to retry article ${article.articleId}: ${error.message}`,
        );
      }
    }

    return { retriedCount };
  }

  // ── Pipeline Steps ──────────────────────────────────────

  /**
   * Internal: run the 5-step pipeline.
   */
  private async runPipeline(
    jobId: string,
    categorySlug: string | undefined,
    articleCount: number,
    source: 'cron' | 'manual',
  ): Promise<void> {
    const startTime = Date.now();
    const batchId = randomUUID();
    const job = pipelineJobs.get(jobId)!;

    try {
      // ── Step 1: Pick Topics (with category rotation) ────
      await this.updateStep(job, 1, 'running');

      const rotationResult =
        await this.categoryRotationService.pickCategory(
          categorySlug,
          articleCount,
        );

      const selectedTopic = rotationResult.topic;
      const wpCategoryId = rotationResult.wpCategoryId;

      // Create pending articles
      const articleTopics = Array.from({ length: articleCount }, (_, i) => ({
        title: `${selectedTopic.name} — Bài ${i + 1}`,
        categorySlug: selectedTopic.slug,
        wpCategoryId,
      }));

      const articles =
        await this.knowledgeArticleService.createBatchArticles(
          batchId,
          articleTopics,
        );

      // Create pipeline log
      await this.pipelineLogService.createLog({
        batchId,
        categorySlug: selectedTopic.slug,
        source,
      });

      await this.updateStep(job, 1, 'done', {
        articleCount: articles.length,
        category: selectedTopic.slug,
      });

      this.logger.log(
        `Pipeline ${jobId}: Step 1 done — ${articles.length} articles for "${selectedTopic.name}"`,
      );

      // Process each article sequentially
      let publishedCount = 0;
      let failedCount = 0;
      let readyCount = 0;

      for (const article of articles) {
        const articleStartTime = Date.now();

        try {
          // ── Step 2: AI Writing ──────────────────────
          await this.updateStep(job, 2, 'running');

          await this.knowledgeArticleService.updateState(
            article._id.toString(),
            KnowledgeArticleState.GENERATING_CONTENT,
          );

          const contentResult = await this.aiWritingService.generateContent({
            topic: selectedTopic.name,
            category: selectedTopic.slug,
            topicDescription: selectedTopic.description,
          });

          await this.knowledgeArticleService.updateState(
            article._id.toString(),
            KnowledgeArticleState.CONTENT_READY,
            {
              title: contentResult.title,
              content: contentResult.content,
              summary: contentResult.summary,
            },
          );

          await this.updateStep(job, 2, 'done');

          // ── Step 3: AI Image ───────────────────────
          await this.updateStep(job, 3, 'running');

          const imageConfig =
            await this.knowledgeConfigService.getAiImageConfig();

          if (imageConfig.enabled !== false) {
            await this.knowledgeArticleService.updateState(
              article._id.toString(),
              KnowledgeArticleState.GENERATING_IMAGE,
            );

            const imageResult =
              await this.aiImageService.generateFeaturedImage({
                title: contentResult.title,
                contentSummary: contentResult.summary,
              });

            if (imageResult.imageUrl || imageResult.buffer.length > 0) {
              await this.knowledgeArticleService.updateState(
                article._id.toString(),
                KnowledgeArticleState.READY,
                {
                  featuredImageUrl: imageResult.imageUrl,
                },
              );
            } else {
              await this.knowledgeArticleService.updateState(
                article._id.toString(),
                KnowledgeArticleState.READY,
              );
            }
          } else {
            // Image generation disabled -> skip to ready
            await this.knowledgeArticleService.updateState(
              article._id.toString(),
              KnowledgeArticleState.READY,
            );
          }

          await this.updateStep(job, 3, 'done');

          // ── Step 4: Upload Media to WP ─────────────
          await this.updateStep(job, 4, 'running');

          const reloadedArticle =
            await this.knowledgeArticleService.getArticleById(
              article._id.toString(),
            );

          let wpMediaId: number | undefined;
          if (reloadedArticle.featuredImageUrl) {
            try {
              // Download the generated image and upload to WP
              const imgResponse = await fetch(reloadedArticle.featuredImageUrl);
              if (imgResponse.ok) {
                const buffer = Buffer.from(await imgResponse.arrayBuffer());
                const uploaded = await this.wpClientService.uploadMedia(
                  buffer,
                  `knowledge-${batchId}-${article._id}.jpg`,
                  'image/jpeg',
                );
                wpMediaId = uploaded.mediaId;

                await this.knowledgeArticleService.updateState(
                  article._id.toString(),
                  undefined,
                  { wpMediaId },
                );
              }
            } catch (uploadError: any) {
              this.logger.warn(
                `Failed to upload media for article ${article._id}: ${uploadError.message}`,
              );
              // Non-fatal — continue without featured image
            }
          }

          await this.updateStep(job, 4, 'done');

          // ── Step 5: Publish to WP ──────────────────
          await this.updateStep(job, 5, 'running');

          await this.knowledgeArticleService.updateState(
            article._id.toString(),
            KnowledgeArticleState.PUBLISHING,
          );

          const postResult = await this.wpClientService.createPost({
            title: reloadedArticle.title,
            content: this.aiWritingService.markdownToHtml(reloadedArticle.content || ''),
            status: 'publish',
            categories: [reloadedArticle.wpCategoryId || wpCategoryId],
            tags: reloadedArticle.wpTagIds || [],
            featuredMedia: wpMediaId,
          });

          await this.knowledgeArticleService.updateState(
            article._id.toString(),
            KnowledgeArticleState.PUBLISHED,
            { wpPostId: postResult.postId },
          );

          await this.updateStep(job, 5, 'done');
          const articleDuration = Date.now() - articleStartTime;
          publishedCount++;

          // Log article result
          await this.pipelineLogService.addArticleResult(batchId, {
            articleId: new Types.ObjectId(article._id),
            title: reloadedArticle.title,
            state: 'published',
            wpPostId: postResult.postId,
            duration: articleDuration,
          });
        } catch (error: any) {
          failedCount++;
          const articleDuration = Date.now() - articleStartTime;

          this.logger.error(
            `Article ${article._id} failed in pipeline: ${error.message}`,
          );

          // Mark the article as failed with step info
          const currentStep = job.currentStep;
          await this.knowledgeArticleService.markFailed(
            article._id.toString(),
            currentStep,
            error.message,
          );

          // Log the failure
          await this.pipelineLogService.addArticleResult(batchId, {
            articleId: new Types.ObjectId(article._id),
            title: article.title || 'Unknown',
            state: 'failed',
            error: error.message,
            failedStep: currentStep,
            duration: articleDuration,
          });

          // Continue with next article (resilient batch processing)
        }
      }

      // Finalize pipeline log
      const totalDuration = Date.now() - startTime;
      const finalStatus =
        failedCount === 0
          ? PipelineRunStatus.COMPLETED
          : publishedCount === 0
            ? PipelineRunStatus.FAILED
            : PipelineRunStatus.PARTIAL;

      await this.pipelineLogService.finalizeLog(batchId, finalStatus, {
        publishedCount,
        failedCount,
        readyCount,
        errorSummary:
          failedCount > 0
            ? `${failedCount}/${articles.length} articles failed`
            : undefined,
      });

      // Update pipeline log total duration
      await this.pipelineLogService.updateTotalDuration(
        batchId,
        totalDuration,
      );

      // Update job status
      job.status = 'done';
      job.batchId = batchId;
      job.result = {
        published: publishedCount,
        failed: failedCount,
        ready: readyCount,
        category: categorySlug || 'auto',
      };

      this.logger.log(
        `Pipeline ${jobId} completed: ${publishedCount} published, ${failedCount} failed, ${readyCount} ready (${totalDuration}ms)`,
      );
    } catch (error: any) {
      job.status = 'error';
      job.error = error.message;

      // Finalize pipeline log as failed
      await this.pipelineLogService
        .finalizeLog(batchId, PipelineRunStatus.FAILED, {
          publishedCount: 0,
          failedCount: 0,
          readyCount: 0,
          errorSummary: error.message,
        })
        .catch(() => {});

      throw error;
    }
  }

  // ── Helpers ─────────────────────────────────────────────

  private async updateStep(
    job: NonNullable<ReturnType<typeof pipelineJobs.get>>,
    stepNumber: number,
    status: 'pending' | 'running' | 'done' | 'error',
    result?: unknown,
  ): Promise<void> {
    job.currentStep = stepNumber;
    const step = job.steps.find((s) => s.step === stepNumber);
    if (step) {
      step.status = status;
      if (status === 'running') step.startedAt = new Date().toISOString();
      if (status === 'done' || status === 'error')
        step.completedAt = new Date().toISOString();
      if (result !== undefined) step.result = result;
    }

    // Also persist to pipeline log
    if (job.batchId) {
      await this.pipelineLogService.updateStep(job.batchId, stepNumber, {
        status,
        ...(result !== undefined ? { result } : {}),
      });
    }
  }
}
