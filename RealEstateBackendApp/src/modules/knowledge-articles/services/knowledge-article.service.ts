import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, SortOrder } from 'mongoose';
import {
  NewsArticle,
  NewsArticleSchema,
} from '../../news-fire-crawl-manager/schemas/news-article.schema';
import { KnowledgeArticleState } from '../types/knowledge-article-state';
import {
  GetKnowledgeArticlesQueryDto,
} from '../dtos/knowledge-article.dto';
import { DEFAULT_LIMIT } from '../../../common/dto/pagination-query.dto';
import { createHash } from 'crypto';
import { WpClientService } from './wp-client.service';
import { AiWritingService } from './ai-writing.service';
import { AiImageService } from './ai-image.service';

@Injectable()
export class KnowledgeArticleService {
  private readonly logger = new Logger(KnowledgeArticleService.name);

  constructor(
    @InjectModel(NewsArticle.name)
    private readonly newsArticleModel: Model<NewsArticle>,
    private readonly wpClientService: WpClientService,
    private readonly aiWritingService: AiWritingService,
    private readonly aiImageService: AiImageService,
  ) {}

  // ── CRUD ────────────────────────────────────────────────

  /**
   * List knowledge articles with pagination, filters, and search.
   */
  async listArticles(
    query: GetKnowledgeArticlesQueryDto,
  ): Promise<{
    data: NewsArticle[];
    meta: { page: number; limit: number; total: number; totalPages: number };
  }> {
    const {
      page = 1,
      limit = DEFAULT_LIMIT,
      status,
      category,
      search,
      sort = 'newest',
    } = query;

    // C-01: exclude soft-deleted articles (deletedAt != null) from listing.
    const filter: Record<string, unknown> = {
      type: 'knowledge',
      deletedAt: null,
    };

    if (status) {
      filter.pipelineState = status;
    }
    if (category) {
      filter.categorySlug = category;
    }
    if (search) {
      filter.title = { $regex: search, $options: 'i' };
    }

    const sortOption: Record<string, SortOrder> =
      sort === 'oldest' ? { createdAt: 1 as SortOrder } : { createdAt: -1 as SortOrder };

    const [data, total] = await Promise.all([
      this.newsArticleModel
        .find(filter)
        .sort(sortOption)
        .skip((page - 1) * limit)
        .limit(limit)
        .lean()
        .exec(),
      this.newsArticleModel.countDocuments(filter).exec(),
    ]);

    return {
      data,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Get a knowledge article by ID.
   */
  async getArticleById(id: string): Promise<NewsArticle> {
    // C-01: exclude soft-deleted articles from single-article lookup.
    const article = await this.newsArticleModel
      .findOne({ _id: id, type: 'knowledge', deletedAt: null })
      .lean()
      .exec();

    if (!article) {
      throw new NotFoundException(`Knowledge article not found: ${id}`);
    }

    return article as unknown as NewsArticle;
  }

  /**
   * Soft delete a knowledge article.
   */
  async deleteArticle(id: string): Promise<void> {
    await this.getArticleById(id);
    await this.newsArticleModel
      .updateOne({ _id: id }, { $set: { deletedAt: new Date() } })
      .exec();

    this.logger.log(`Knowledge article deleted: ${id}`);
  }

  /**
   * Bulk soft delete knowledge articles.
   */
  async deleteBulkArticles(ids: string[]): Promise<{ deletedCount: number }> {
    // C-01: exclude soft-deleted articles from bulk delete scope.
    const result = await this.newsArticleModel
      .updateMany(
        { _id: { $in: ids }, type: 'knowledge', deletedAt: null },
        { $set: { deletedAt: new Date() } },
      )
      .exec();

    return { deletedCount: result.modifiedCount };
  }

  // ── State Machine ───────────────────────────────────────

  /**
   * Update the pipeline state of a knowledge article.
   * If `state` is omitted, only the `extra` fields are updated.
   */
  async updateState(
    id: string,
    state?: KnowledgeArticleState,
    extra?: Partial<NewsArticle>,
  ): Promise<void> {
    const update: Record<string, unknown> = {};

    if (state) {
      update.pipelineState = state;
    }

    if (extra) {
      Object.assign(update, extra);
    }

    await this.newsArticleModel
      .updateOne({ _id: id }, { $set: update })
      .exec();
  }

  /**
   * Mark an article as failed with step and error info.
   */
  async markFailed(
    id: string,
    step: number,
    error: string,
  ): Promise<void> {
    await this.newsArticleModel
      .updateOne(
        { _id: id },
        {
          $set: {
            pipelineState: KnowledgeArticleState.FAILED,
            pipelineFailedStep: step,
            pipelineError: error,
          },
        },
      )
      .exec();
  }

  // ── Manual Controls ─────────────────────────────────────

  /**
   * Retry a failed article by resuming the pipeline inline from the failed step.
   *
   * M-03: Previously this method only reset the article's state field — the
   * article stayed stuck forever because nothing re-ran the remaining pipeline
   * steps. Now it actually re-executes the steps after `pipelineFailedStep`:
   *   - step 1-2 failed → regenerate content (AI writing)
   *   - step 3 failed   → regenerate featured image (AI image)
   *   - step 4-5 failed → (re)publish via publishToWordPress
   * On success the article reaches PUBLISHED; on failure it is re-marked FAILED.
   */
  async retryArticle(
    id: string,
  ): Promise<{
    success: boolean;
    failedStep: number | null;
    wpPostId?: number;
  }> {
    const article = await this.getArticleById(id);

    if (article.pipelineState !== KnowledgeArticleState.FAILED) {
      throw new BadRequestException(
        'Only articles in "failed" state can be retried',
      );
    }

    const failedStep = article.pipelineFailedStep;

    try {
      // ── Step 2: regenerate content if it never became ready ────────
      if (failedStep === null || failedStep <= 2) {
        await this.updateState(id, KnowledgeArticleState.GENERATING_CONTENT);

        const contentResult = await this.aiWritingService.generateContent({
          topic: article.title,
          category: article.categorySlug || '',
          topicDescription: '',
        });

        await this.updateState(id, KnowledgeArticleState.CONTENT_READY, {
          title: contentResult.title,
          content: contentResult.content,
          htmlContent: contentResult.htmlContent,
          summary: contentResult.summary,
        });
      }

      // ── Step 3: regenerate image if content/image stage failed ─────
      if (failedStep === null || failedStep <= 3) {
        const reloaded = await this.getArticleById(id);

        if (!reloaded.featuredImageUrl) {
          await this.updateState(id, KnowledgeArticleState.GENERATING_IMAGE);

          const imageResult =
            await this.aiImageService.generateFeaturedImage({
              title: reloaded.title,
              contentSummary: reloaded.summary || '',
            });

          if (imageResult.imageUrl || imageResult.buffer?.length > 0) {
            await this.updateState(id, KnowledgeArticleState.READY, {
              featuredImageUrl: imageResult.imageUrl,
            });
          } else {
            await this.updateState(id, KnowledgeArticleState.READY);
          }
        } else {
          // Image already generated — move straight to READY
          await this.updateState(id, KnowledgeArticleState.READY);
        }
      }

      // Clear failure info before the publish attempt
      await this.newsArticleModel
        .updateOne(
          { _id: id },
          { $set: { pipelineError: null, pipelineFailedStep: null } },
        )
        .exec();

      // ── Steps 4+5: publish to WordPress (requires READY state) ─────
      const readyArticle = await this.getArticleById(id);
      const publishResult = await this.publishToWordPress(id, readyArticle);

      this.logger.log(
        `Retry succeeded for article ${id} (was failed at step ${failedStep}) — wpPostId: ${publishResult.wpPostId}`,
      );

      return { success: true, failedStep, wpPostId: publishResult.wpPostId };
    } catch (error: any) {
      this.logger.error(
        `Retry failed for article ${id} at step ${failedStep}: ${error.message}`,
      );

      // Re-mark as failed so the article can be retried again
      await this.markFailed(id, failedStep ?? 1, error.message);

      throw new BadRequestException(
        `Retry failed at step ${failedStep}: ${error.message}`,
      );
    }
  }

  /**
   * Publish a ready article to WordPress via WpClientService.
   * M-02: Replaced fake stub with real WP API call.
   * @param preloadedArticle Optional already-loaded article (avoids redundant DB call).
   */
  async publishToWordPress(
    id: string,
    preloadedArticle?: NewsArticle,
  ): Promise<{ wpPostId: number }> {
    const article = preloadedArticle ?? await this.getArticleById(id);

    if (article.pipelineState !== KnowledgeArticleState.READY) {
      throw new BadRequestException(
        'Only articles in "ready" state can be published',
      );
    }

    await this.updateState(id, KnowledgeArticleState.PUBLISHING);

    try {
      const htmlContent = article.htmlContent || this.markdownToHtml(article.content || '');

      const wpResult = await this.wpClientService.createPost({
        title: article.title,
        content: htmlContent,
        status: 'publish' as const,
        categories: article.wpCategoryId ? [article.wpCategoryId] : [],
        tags: Array.isArray(article.wpTagIds) ? article.wpTagIds : [],
        featuredMedia: article.wpMediaId || undefined,
      });

      await this.updateState(id, KnowledgeArticleState.PUBLISHED, {
        wpPostId: wpResult.postId,
      });

      this.logger.log(`Article ${id} published to WP: post ${wpResult.postId}`);
      return { wpPostId: wpResult.postId };
    } catch (error: any) {
      this.logger.error(`Article ${id} WP publish failed: ${error.message}`);
      await this.updateState(id, KnowledgeArticleState.READY);
      throw new BadRequestException(
        `WordPress publish failed: ${error.message}`,
      );
    }
  }

  /**
   * Convert markdown to basic HTML (fallback for articles without htmlContent).
   */
  private markdownToHtml(markdown: string): string {
    return markdown
      .replace(/^### (.+)$/gm, '<h3>$1</h3>')
      .replace(/^## (.+)$/gm, '<h2>$1</h2>')
      .replace(/^# (.+)$/gm, '<h1>$1</h1>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/\n/g, '<br>');
  }

  /**
   * Republish (update) an existing WordPress post via WpClientService.
   * M-02: Replaced fake stub with real WP API call.
   */
  async republishToWordPress(
    id: string,
  ): Promise<{ wpPostId: number }> {
    const article = await this.getArticleById(id);

    if (!article.wpPostId) {
      throw new BadRequestException(
        'Article has not been published to WordPress yet',
      );
    }

    await this.updateState(id, KnowledgeArticleState.PUBLISHING);

    try {
      const htmlContent = article.htmlContent || this.markdownToHtml(article.content || '');

      await this.wpClientService.updatePost(article.wpPostId, {
        title: article.title,
        content: htmlContent,
        categories: article.wpCategoryId ? [article.wpCategoryId] : [],
        tags: Array.isArray(article.wpTagIds) ? article.wpTagIds : [],
      });

      await this.updateState(id, KnowledgeArticleState.PUBLISHED);

      this.logger.log(`Article ${id} republished to WP: post ${article.wpPostId}`);
      return { wpPostId: article.wpPostId };
    } catch (error: any) {
      this.logger.error(`Article ${id} WP republish failed: ${error.message}`);
      await this.updateState(id, KnowledgeArticleState.READY);
      throw new BadRequestException(
        `WordPress republish failed: ${error.message}`,
      );
    }
  }

  // ── Batch Creation ──────────────────────────────────────

  /**
   * Create a batch of knowledge articles for a pipeline run.
   */
  async createBatchArticles(
    batchId: string,
    topics: Array<{
      title: string;
      categorySlug: string;
      wpCategoryId: number;
    }>,
  ): Promise<NewsArticle[]> {
    const articles = await Promise.all(
      topics.map(async (topic) => {
        const urlHash = createHash('sha256')
          .update(`knowledge:${topic.title}`)
          .digest('hex')
          .slice(0, 16);

        return this.newsArticleModel.create({
          title: topic.title,
          urlHash,
          type: 'knowledge',
          pipelineState: KnowledgeArticleState.PENDING,
          categorySlug: topic.categorySlug,
          wpCategoryId: topic.wpCategoryId,
          batchId,
        });
      }),
    );

    this.logger.log(
      `Created ${articles.length} batch articles for batch ${batchId}`,
    );

    return articles;
  }
}
