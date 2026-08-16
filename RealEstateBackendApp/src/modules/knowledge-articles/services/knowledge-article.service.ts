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

@Injectable()
export class KnowledgeArticleService {
  private readonly logger = new Logger(KnowledgeArticleService.name);

  constructor(
    @InjectModel(NewsArticle.name)
    private readonly newsArticleModel: Model<NewsArticle>,
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

    const filter: Record<string, unknown> = { type: 'knowledge' };

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
    const article = await this.newsArticleModel
      .findOne({ _id: id, type: 'knowledge' })
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
    const result = await this.newsArticleModel
      .updateMany(
        { _id: { $in: ids }, type: 'knowledge' },
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
   * Retry a failed article. Validates the article is in 'failed' state
   * and clears the failure info so the pipeline can resume.
   */
  async retryArticle(
    id: string,
  ): Promise<{ success: boolean; failedStep: number | null }> {
    const article = await this.getArticleById(id);

    if (article.pipelineState !== KnowledgeArticleState.FAILED) {
      throw new BadRequestException(
        'Only articles in "failed" state can be retried',
      );
    }

    const failedStep = article.pipelineFailedStep;

    // Resume from the failed step
    let nextState: KnowledgeArticleState;
    if (failedStep !== null && failedStep <= 2) {
      nextState = KnowledgeArticleState.GENERATING_CONTENT;
    } else if (failedStep !== null && failedStep <= 3) {
      nextState = KnowledgeArticleState.CONTENT_READY;
    } else if (failedStep !== null && failedStep <= 5) {
      nextState = KnowledgeArticleState.READY;
    } else {
      nextState = KnowledgeArticleState.PENDING;
    }

    await this.newsArticleModel
      .updateOne(
        { _id: id },
        {
          $set: {
            pipelineState: nextState,
            pipelineError: null,
            pipelineFailedStep: null,
          },
        },
      )
      .exec();

    this.logger.log(
      `Retried article ${id}: state → ${nextState} (was step ${failedStep})`,
    );

    return { success: true, failedStep };
  }

  /**
   * Publish a ready article to WordPress.
   * TODO: Implement real WP publish when WpClientService is ready.
   */
  async publishToWordPress(
    id: string,
  ): Promise<{ wpPostId: number }> {
    const article = await this.getArticleById(id);

    if (article.pipelineState !== KnowledgeArticleState.READY) {
      throw new BadRequestException(
        'Only articles in "ready" state can be published',
      );
    }

    await this.updateState(id, KnowledgeArticleState.PUBLISHING);

    // TODO: Call WpClientService.createPost(...)
    // For now, stub the wpPostId
    const wpPostId = Math.floor(Math.random() * 100000);

    await this.updateState(id, KnowledgeArticleState.PUBLISHED, {
      wpPostId,
    });

    return { wpPostId };
  }

  /**
   * Republish (update) an existing WordPress post.
   * TODO: Implement real WP update when WpClientService is ready.
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

    // TODO: Call WpClientService.updatePost(...)
    const wpPostId = article.wpPostId;

    await this.updateState(id, KnowledgeArticleState.PUBLISHED);

    return { wpPostId };
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
