import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { NewsArticle, NewsStatus } from '../schemas/news-article.schema';
import { RawArticle } from '../schemas/raw-article.schema';
import { WordPressService } from './wordpress.service';
import { ArticleExtractorUtil } from '../../../utils/article-extractor.util';
import { AIFilterService } from './ai-filter.service';
import { AiPromptConfigService } from './ai-prompt-config.service';
import { EmbeddingService } from './embedding.service';
import { MarketAnalysisHistory } from '../schemas/market-analysis-history.schema';
import { PaginatedResult } from '../../../common/dto/paginated-response.dto';
import {
  DEFAULT_LIMIT,
  DEFAULT_PAGE,
} from '../../../common/dto/pagination-query.dto';
import { normalizePagination } from '../../../common/utils/pagination.util';
import { generateUrlHash } from '../../../common/utils/url-hash.util';
import {
  startOfDayUtc,
  endOfDayUtc,
} from '../../../common/utils/timezone.util';
import { cosineSimilarity } from '../../../utils/cosine-similarity.util';

/**
 * Normalize content: unescape literal \\n, \\t, \\r than ky tu that.
 * AI API đôi khi tra ve literal \\n thay vì newline character -> DB luu sai.
 */
function normalizeContent(content: string | undefined | null): string {
  if (!content) return '';
  return content
    .replace(/\\\\n/g, '\\n')
    .replace(/\\\\t/g, '\\t')
    .replace(/\\\\r/g, '\\r');
}

const MARKET_ANALYSIS_HISTORY_PAGE_SIZE = 10;

/** Default dedup threshold (configurable via env DEDUP_THRESHOLD) */
const DEFAULT_DEDUP_THRESHOLD = 0.90;

/** Default dedup window in days (configurable via env DEDUP_WINDOW_DAYS) */
const DEFAULT_DEDUP_WINDOW_DAYS = 30;

export interface MarketAnalysisHistoryPage {
  data: MarketAnalysisHistory[];
  meta: { limit: number; hasMore: boolean; nextCursor: string | null };
}

interface MarketAnalysisHistoryCursor { createdAt: string; id: string; }

function encodeMarketAnalysisHistoryCursor(record: any): string {
  return Buffer.from(JSON.stringify({
    createdAt: new Date(record.createdAt).toISOString(),
    id: record._id.toString(),
  } satisfies MarketAnalysisHistoryCursor)).toString('base64url');
}

function decodeMarketAnalysisHistoryCursor(cursor: string): MarketAnalysisHistoryCursor {
  try {
    const decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as MarketAnalysisHistoryCursor;
    const createdAt = new Date(decoded.createdAt);
    if (!decoded?.id || Number.isNaN(createdAt.getTime()) || !Types.ObjectId.isValid(decoded.id)) {
      throw new Error('invalid cursor');
    }
    return { createdAt: createdAt.toISOString(), id: decoded.id };
  } catch {
    throw new BadRequestException('Invalid market analysis history cursor');
  }
}

/** Result of a duplicate check against existing articles */
export interface DuplicateResult {
  isDuplicate: boolean;
  duplicateOf: Types.ObjectId | null;
  duplicateScore: number | null;
}

/** Entry in the in-memory batch embedding buffer */
interface BatchEmbeddingEntry {
  embedding: number[];
  id: string;
  title: string;
}

@Injectable()
export class NewsArticleService implements OnModuleInit {
  private readonly logger = new Logger(NewsArticleService.name);
  private readonly dedupThreshold: number;
  private readonly dedupWindowDays: number;

  constructor(
    @InjectModel(NewsArticle.name)
    private readonly newsArticleModel: Model<NewsArticle>,
    @InjectModel(RawArticle.name)
    private readonly rawArticleModel: Model<RawArticle>,
    @InjectModel(MarketAnalysisHistory.name)
    private readonly marketAnalysisHistoryModel: Model<MarketAnalysisHistory>,
    private readonly wordpressService: WordPressService,
    private readonly aiFilterService: AIFilterService,
    private readonly aiPromptConfigService: AiPromptConfigService,
    private readonly embeddingService: EmbeddingService,
    private readonly configService: ConfigService,
  ) {
    this.dedupThreshold = Number(
      this.configService.get<number>('DEDUP_THRESHOLD', DEFAULT_DEDUP_THRESHOLD),
    );
    this.dedupWindowDays = Number(
      this.configService.get<number>('DEDUP_WINDOW_DAYS', DEFAULT_DEDUP_WINDOW_DAYS),
    );
  }

  async onModuleInit() {
    await this.cleanupUncontentCrawledStatus();
  }

  async cleanupUncontentCrawledStatus(): Promise<{ modifiedCount: number }> {
    try {
      this.logger.log(
        'Running startup cleanup: Removing CRAWLED status from articles without valid content...',
      );

      const filter = {
        $or: [
          { content: { $exists: false } },
          { content: null },
          { content: { $regex: /^\s*$/ } },
        ],
        status: NewsStatus.CRAWLED,
      };

      const result = await this.newsArticleModel.updateMany(filter, {
        $pull: { status: NewsStatus.CRAWLED },
      });

      this.logger.log(
        `Cleanup completed. Articles updated: ${result.modifiedCount}`,
      );
      return { modifiedCount: result.modifiedCount };
    } catch (error: any) {
      this.logger.error(
        `Failed to clean up CRAWLED status for empty content articles: ${error.message}`,
        error.stack,
      );
      return { modifiedCount: 0 };
    }
  }

  // ──────────────────────────────────────────────────────────────
  // DEDUP METHODS
  // ──────────────────────────────────────────────────────────────

  /**
   * Query NewsArticle candidates within N days of publishDate that have
   * embeddings. Returns only fields needed for cosine comparison.
   */
  async findDuplicateCandidates(
    publishDate: string,
    windowDays: number = this.dedupWindowDays,
  ): Promise<{ _id: Types.ObjectId; contentEmbedding: number[]; title: string }[]> {
    const refDate = new Date(publishDate);
    if (isNaN(refDate.getTime())) {
      return [];
    }

    const startDate = new Date(refDate);
    startDate.setDate(startDate.getDate() - windowDays);

    return this.newsArticleModel
      .find({
        contentEmbedding: { $ne: null },
        publishDate: {
          $gte: startDate.toISOString(),
          $lte: refDate.toISOString(),
        },
      })
      .select('_id contentEmbedding title')
      .lean()
      .exec() as Promise<{ _id: Types.ObjectId; contentEmbedding: number[]; title: string }[]>;
  }

  /**
   * Check if a given embedding is a duplicate of any existing NewsArticle.
   * Compares against DB candidates + in-memory batch buffer.
   */
  async checkDuplicate(
    embedding: number[],
    publishDate: string,
    threshold: number = this.dedupThreshold,
    batchBuffer: BatchEmbeddingEntry[] = [],
  ): Promise<DuplicateResult> {
    // Query DB candidates
    const candidates = await this.findDuplicateCandidates(publishDate);

    let bestMatch: { id: Types.ObjectId; score: number } | null = null;

    // Compare against DB candidates
    for (const candidate of candidates) {
      if (!candidate.contentEmbedding) continue;
      try {
        const score = cosineSimilarity(embedding, candidate.contentEmbedding);
        if (!bestMatch || score > bestMatch.score) {
          bestMatch = { id: candidate._id, score };
        }
      } catch {
        // Dimension mismatch — skip this candidate
      }
    }

    // Compare against in-memory batch buffer (same-batch dedup)
    for (const prev of batchBuffer) {
      try {
        const score = cosineSimilarity(embedding, prev.embedding);
        if (!bestMatch || score > bestMatch.score) {
          bestMatch = { id: new Types.ObjectId(prev.id), score };
        }
      } catch {
        // Dimension mismatch — skip
      }
    }

    if (bestMatch && bestMatch.score >= threshold) {
      return {
        isDuplicate: true,
        duplicateOf: bestMatch.id,
        duplicateScore: bestMatch.score,
      };
    }

    return { isDuplicate: false, duplicateOf: null, duplicateScore: null };
  }

  // ──────────────────────────────────────────────────────────────
  // saveArticles — WITH DEDUP
  // ──────────────────────────────────────────────────────────────

  async saveArticles(articles: any[]): Promise<{
    savedCount: number;
    duplicates: number;
    processedUrlHashes: string[];
    newlySavedUrlHashes: string[];
  }> {
    this.logger.log('Starting Job 3: Save to Database (with dedup)');
    let savedCount = 0;
    let duplicates = 0;
    const processedUrlHashes: string[] = [];
    // Chi chua hash cua bai duoc insert moi — dung cho rollback compensating transaction
    const newlySavedUrlHashes: string[] = [];

    // In-memory buffer for same-batch dedup detection
    const batchEmbeddings: BatchEmbeddingEntry[] = [];
    const embeddingModelName = this.embeddingService.getEmbeddingModelName();

    for (const article of articles) {
      try {
        const urlHash = article.urlHash || generateUrlHash(article.url);

        const existing = await this.newsArticleModel.findOne({ urlHash });
        if (existing) {
          duplicates++;
          processedUrlHashes.push(urlHash);
          continue;
        }

        let initialStatus = Array.isArray(article.status)
          ? article.status
          : article.status
            ? [article.status]
            : [];
        initialStatus = initialStatus.filter((s: string) =>
          Object.values(NewsStatus).includes(s as any),
        );
        const contentStr = article.content || '';
        if (
          contentStr.trim().length > 0 &&
          !initialStatus.includes(NewsStatus.CRAWLED)
        ) {
          initialStatus.push(NewsStatus.CRAWLED);
        } else if (contentStr.trim().length === 0) {
          initialStatus = initialStatus.filter(
            (s: string) => s !== (NewsStatus.CRAWLED as string),
          );
        }

        let finalPublishDate = article.publishDate || article.publishedAt;
        if (finalPublishDate) {
          const tempDate = new Date(finalPublishDate);
          if (!isNaN(tempDate.getTime())) {
            finalPublishDate = tempDate.toISOString();
          } else {
            finalPublishDate = new Date().toISOString();
          }
        } else {
          finalPublishDate = new Date().toISOString();
        }

        // ── DEDUP: Create embedding + check ──
        let contentEmbedding: number[] | null = null;
        let embeddingInput: string = '';
        let isDuplicate = false;
        let duplicateOfArticleId: Types.ObjectId | null = null;
        let duplicateScore: number | null = null;

        try {
          embeddingInput = this.embeddingService.prepareEmbeddingInput(article);
          contentEmbedding = await this.embeddingService.createEmbedding(embeddingInput);

          // Check duplicate against DB candidates + batch buffer
          const checkResult = await this.checkDuplicate(
            contentEmbedding,
            finalPublishDate,
            this.dedupThreshold,
            batchEmbeddings,
          );

          isDuplicate = checkResult.isDuplicate;
          duplicateOfArticleId = checkResult.duplicateOf;
          duplicateScore = checkResult.duplicateScore;

          if (isDuplicate) {
            this.logger.warn(
              `Duplicate detected: "${article.title}" ~ existing article ` +
              `(score: ${duplicateScore?.toFixed(3)}, ref: ${duplicateOfArticleId})`,
            );
          }
        } catch (embeddingError: any) {
          // Embedding fail → bai xu ly binh thuong (khong dedup)
          this.logger.error(
            `Embedding failed for "${article.title}": ${embeddingError.message}`,
          );
        }

        if (isDuplicate) {
          // 4a. TRUNG → KHONG luu vao NewsArticle, cap nhat RawArticle
          duplicates++;
          processedUrlHashes.push(urlHash);

          // Update RawArticle if this is a raw article document (has _id)
          if (article._id) {
            try {
              await this.rawArticleModel.updateOne(
                { _id: article._id },
                {
                  $set: {
                    isDuplicate: true,
                    duplicateOfArticleId,
                    duplicateScore,
                    contentEmbedding,
                    embeddingInput,
                    embeddingModel: embeddingModelName,
                  },
                },
              );
            } catch (rawUpdateError: any) {
              this.logger.error(
                `Failed to update RawArticle ${article._id} for duplicate: ${rawUpdateError.message}`,
              );
            }
          }
        } else {
          // 4b. KHONG TRUNG → luu vao NewsArticle
          const mappedArticle = {
            title: article.title,
            summary:
              article.summary ||
              article.description ||
              article.content?.substring(0, 200),
            importanceReason: article.importanceReason,
            impactLevel: article.impactLevel,
            targetAudience: article.targetAudience,
            expertOpinion: article.expertOpinion,
            publishDate: finalPublishDate,
            thumbnailUrl: article.thumbnailUrl,
            source: article.source,
            url: article.url,
            keywords: article.keywords,
            wpPostId: article.wpPostId || null,
            content: normalizeContent(article.content),
            status: initialStatus,
          };

          const newArticle = new this.newsArticleModel({
            ...mappedArticle,
            urlHash,
            contentEmbedding,
            embeddingInput,
            embeddingModel: embeddingModelName,
          });

          await newArticle.save();
          savedCount++;
          processedUrlHashes.push(urlHash);
          newlySavedUrlHashes.push(urlHash);

          // Add to batch buffer for same-batch dedup
          if (contentEmbedding) {
            batchEmbeddings.push({
              embedding: contentEmbedding,
              id: newArticle._id.toString(),
              title: article.title,
            });
          }

          // Update RawArticle with link to saved NewsArticle (if raw article doc)
          if (article._id) {
            try {
              await this.rawArticleModel.updateOne(
                { _id: article._id },
                {
                  $set: {
                    savedArticleId: newArticle._id,
                    contentEmbedding,
                    embeddingInput,
                    embeddingModel: embeddingModelName,
                  },
                },
              );
            } catch (rawUpdateError: any) {
              this.logger.error(
                `Failed to update RawArticle ${article._id} with savedArticleId: ${rawUpdateError.message}`,
              );
            }
          }
        }
      } catch (error: any) {
        this.logger.error(
          `Failed to save article ${article.url}: ${error.message}`,
          error.stack,
        );
      }
    }

    this.logger.log(
      `Job 3 completed. Saved: ${savedCount}, Duplicates ignored: ${duplicates}`,
    );
    return { savedCount, duplicates, processedUrlHashes, newlySavedUrlHashes };
  }

  // ──────────────────────────────────────────────────────────────
  // BACKFILL & RETROACTIVE DEDUP
  // ──────────────────────────────────────────────────────────────

  /**
   * Backfill embeddings for NewsArticles that don't have one yet.
   * Processes batchSize articles per call, with 100ms rate limit between API calls.
   */
  async backfillEmbeddings(
    batchSize: number = 50,
  ): Promise<{ processed: number; failed: number }> {
    this.logger.log(`Starting backfill embeddings (batchSize=${batchSize})`);
    let processed = 0;
    let failed = 0;

    const articlesWithoutEmbedding = await this.newsArticleModel
      .find({ contentEmbedding: null })
      .sort({ publishDate: -1 })
      .limit(batchSize)
      .exec();

    const embeddingModelName = this.embeddingService.getEmbeddingModelName();

    for (const article of articlesWithoutEmbedding) {
      try {
        const input = this.embeddingService.prepareEmbeddingInput({
          title: article.title,
          summary: article.summary,
          content: article.content,
        });
        const embedding = await this.embeddingService.createEmbedding(input);

        await this.newsArticleModel.updateOne(
          { _id: article._id },
          {
            $set: {
              contentEmbedding: embedding,
              embeddingInput: input,
              embeddingModel: embeddingModelName,
            },
          },
        );
        processed++;
      } catch (error: any) {
        failed++;
        this.logger.error(
          `Backfill failed for ${article._id}: ${error.message}`,
        );
      }

      // Rate limiting: wait 100ms between requests
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    this.logger.log(
      `Backfill completed. Processed: ${processed}, Failed: ${failed}`,
    );
    return { processed, failed };
  }

  /**
   * Retroactive dedup scan: compare all NewsArticles with embeddings
   * pair-wise and mark duplicates.
   */
  async retroactiveDedupScan(): Promise<{ duplicatesFound: number }> {
    this.logger.log('Starting retroactive dedup scan');
    let duplicatesFound = 0;

    // Get all articles with embeddings, sorted by publishDate ascending
    // (older articles = originals)
    const articles = await this.newsArticleModel
      .find({ contentEmbedding: { $ne: null } })
      .sort({ publishDate: 1 })
      .select('_id contentEmbedding title publishDate')
      .lean()
      .exec();

    for (let i = 1; i < articles.length; i++) {
      const current = articles[i];
      if (!current.contentEmbedding) continue;

      // Compare with all previous articles (within window)
      for (let j = i - 1; j >= 0; j--) {
        const candidate = articles[j];
        if (!candidate.contentEmbedding) continue;

        // Check window
        if (current.publishDate && candidate.publishDate) {
          const daysDiff =
            (new Date(current.publishDate).getTime() -
              new Date(candidate.publishDate).getTime()) /
            (1000 * 60 * 60 * 24);
          if (daysDiff > this.dedupWindowDays) break;
        }

        try {
          const score = cosineSimilarity(
            current.contentEmbedding,
            candidate.contentEmbedding,
          );

          if (score >= this.dedupThreshold) {
            // Mark as duplicate in NewsArticle
            await this.newsArticleModel.updateOne(
              { _id: current._id },
              {
                $set: {
                  isDuplicate: true,
                  duplicateOf: candidate._id,
                  duplicateScore: score,
                },
              },
            );
            duplicatesFound++;
            this.logger.warn(
              `Retroactive duplicate: "${current.title}" ~ "${candidate.title}" (score: ${score.toFixed(3)})`,
            );
            break; // Found duplicate, no need to check further
          }
        } catch {
          // Dimension mismatch — skip
        }
      }

      // Rate limit: small delay between comparisons to avoid blocking
      if (i % 100 === 0) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    }

    this.logger.log(
      `Retroactive dedup scan completed. Duplicates found: ${duplicatesFound}`,
    );
    return { duplicatesFound };
  }

  // ──────────────────────────────────────────────────────────────
  // EXISTING METHODS (unchanged)
  // ──────────────────────────────────────────────────────────────

  /**
   * Lay danh sach bai da luu voi filter ngay/trang thai + phan trang.
   * Tra ve { data, total }: total dem bang countDocuments voi CUNG query filter,
   * truoc khi skip/limit nen luon la tong toan bo tap ket qua da loc.
   */
  async getSavedArticles(
    date?: string,
    status?: 'pending' | 'CRAWLED' | 'POSTED_WP' | 'ERROR',
    page: number = DEFAULT_PAGE,
    limit: number = DEFAULT_LIMIT,
  ): Promise<PaginatedResult<NewsArticle>> {
    const filters: any[] = [];
    if (date) {
      const startDate = startOfDayUtc(date);
      const endDate = endOfDayUtc(date);
      filters.push({
        $or: [
          {
            publishDate: {
              $gte: startDate.toISOString(),
              $lte: endDate.toISOString(),
            },
          },
          {
            $and: [
              {
                $or: [{ publishDate: { $exists: false } }, { publishDate: null }],
              },
              { createdAt: { $gte: startDate, $lte: endDate } },
            ],
          },
        ],
      });
    }
    if (status === 'pending') {
      filters.push({
        $or: [
          { status: { $exists: false } },
          { status: null },
          { status: { $size: 0 } },
        ],
      });
    } else if (status) {
      filters.push({ status });
    }

    const query = filters.length === 0 ? {} : filters.length === 1 ? filters[0] : { $and: filters };
    const { skip, limit: pageSize } = normalizePagination(page, limit);

    const [data, total] = await Promise.all([
      this.newsArticleModel
        .find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(pageSize)
        .exec(),
      this.newsArticleModel.countDocuments(query).exec(),
    ]);

    return { data, total };
  }

  async publishToWordPress(id: string): Promise<NewsArticle> {
    const article = await this.newsArticleModel.findById(id);
    if (!article) {
      throw new NotFoundException(`Article with ID ${id} not found`);
    }

    let statusArray: any[] = [];
    if (Array.isArray(article.status)) {
      statusArray = article.status;
    } else if (article.status) {
      statusArray = [article.status];
    }

    article.status = statusArray.filter((s: string) =>
      Object.values(NewsStatus).includes(s as any),
    ) as NewsStatus[];

    if (article.status.includes(NewsStatus.POSTED_WP)) {
      return article;
    }

    try {
      const wpPostId = await this.wordpressService.pushToWordPress(article);
      article.wpPostId = wpPostId;
      if (!article.status.includes(NewsStatus.POSTED_WP)) {
        article.status.push(NewsStatus.POSTED_WP);
      }
      return await article.save();
    } catch (error) {
      if (!article.status.includes(NewsStatus.ERROR)) {
        article.status.push(NewsStatus.ERROR);
      }
      await article.save();
      throw error;
    }
  }

  async deleteBulkArticles(ids: string[]): Promise<any> {
    if (!ids || ids.length === 0) {
      return { deletedCount: 0 };
    }
    const result = await this.newsArticleModel.deleteMany({
      _id: { $in: ids },
    });
    return result;
  }

  async getArticleById(id: string): Promise<NewsArticle> {
    const article = await this.newsArticleModel.findById(id);
    if (!article) {
      throw new NotFoundException(`Article with ID ${id} not found`);
    }
    return article;
  }

  async analyzeMarketBulk(ids: string[]): Promise<any> {
    this.logger.log(`Starting bulk market analysis for ${ids.length} articles`);
    let processed = 0;
    let failed = 0;
    const processedArticles: any[] = [];

    for (const id of ids) {
      try {
        const article = await this.newsArticleModel.findById(id);
        if (!article) {
          failed++;
          continue;
        }

        let rawMarkdown = '';
        try {
          const extracted = await ArticleExtractorUtil.extractArticle(
            article.url,
          );
          rawMarkdown = extracted.markdown;
          if (!article.thumbnailUrl && extracted.thumbnailUrl) {
            article.thumbnailUrl = extracted.thumbnailUrl;
          }
          if (
            (!article.publishDate || article.publishDate === 'Invalid Date') &&
            extracted.publishDate
          ) {
            const tempDate = new Date(extracted.publishDate);
            if (!isNaN(tempDate.getTime())) {
              article.publishDate = tempDate.toISOString();
            }
          }
        } catch (error: any) {
          this.logger.warn(
            `Failed to scrape article ${article.url}: ${error.message}`,
          );
          failed++;
          continue;
        }

        if (!article.publishDate || article.publishDate === 'Invalid Date') {
          article.publishDate = new Date().toISOString();
        }

        try {
          article.content =
            await this.aiFilterService.cleanMarkdownContentWithAI(rawMarkdown);
        } catch (aiError: any) {
          this.logger.warn(
            `AI cleanup failed for article ${id}, fallback to basic string: ${aiError.message}`,
          );
          article.content = rawMarkdown;
        }

        let statusArray: any[] = [];
        if (Array.isArray(article.status)) {
          statusArray = article.status;
        } else if (article.status) {
          statusArray = [article.status];
        }

        article.status = statusArray.filter((s: string) =>
          Object.values(NewsStatus).includes(s as any),
        ) as NewsStatus[];

        const contentStr = article.content || '';
        if (
          contentStr.trim().length > 0 &&
          !article.status.includes(NewsStatus.CRAWLED)
        ) {
          article.status.push(NewsStatus.CRAWLED);
        } else if (contentStr.trim().length === 0) {
          article.status = article.status.filter(
            (s: string) => s !== (NewsStatus.CRAWLED as string),
          );
        }

        await article.save();
        processed++;
        processedArticles.push(article);
      } catch (error: any) {
        this.logger.error(
          `Failed to analyze market for article ID ${id}: ${error.message}`,
          error.stack,
        );
        failed++;
      }
    }

    return { processed, failed, processedArticles };
  }

  async analyzeMarketTrendsByAI(ids: string[]): Promise<string> {
    this.logger.log(`Starting AI market analysis for ${ids.length} articles`);

    if (!ids || ids.length === 0) {
      throw new BadRequestException('No articles selected');
    }

    const articles = await this.newsArticleModel.find({ _id: { $in: ids } });
    if (!articles || articles.length === 0) {
      throw new BadRequestException('Articles not found');
    }

    const combinedData = articles
      .map((article) => {
        return `
Title: ${article.title || 'N/A'}
Date: ${article.publishDate ? new Date(article.publishDate).toISOString() : 'N/A'}
Original URL: ${article.url || 'N/A'}
Content: ${article.content || article.summary || 'N/A'}
      `.trim();
      })
      .join('\n\n---\n\n');

    const markdownResponse = await this.aiFilterService.callAiCompletion(
      this.aiPromptConfigService.getPromptByName('MARKET_ANALYSIS_PROMPT'),
      combinedData,
      'Market trends analysis',
    );

    const historyEntry = new this.marketAnalysisHistoryModel({
      content: normalizeContent(markdownResponse),
      articleIds: ids,
    });
    await historyEntry.save();

    return markdownResponse;
  }

  async getMarketAnalysisHistory(cursor?: string): Promise<MarketAnalysisHistoryPage> {
    const query: Record<string, unknown> = {};
    if (cursor) {
      const anchor = decodeMarketAnalysisHistoryCursor(cursor);
      const anchorDate = new Date(anchor.createdAt);
      query.$or = [
        { createdAt: { $lt: anchorDate } },
        { createdAt: anchorDate, _id: { $lt: new Types.ObjectId(anchor.id) } },
      ];
    }

    const records = await this.marketAnalysisHistoryModel
      .find(query)
      .sort({ createdAt: -1, _id: -1 })
      .limit(MARKET_ANALYSIS_HISTORY_PAGE_SIZE + 1)
      .exec();
    const hasMore = records.length > MARKET_ANALYSIS_HISTORY_PAGE_SIZE;
    const data = hasMore ? records.slice(0, MARKET_ANALYSIS_HISTORY_PAGE_SIZE) : records;
    return {
      data,
      meta: {
        limit: MARKET_ANALYSIS_HISTORY_PAGE_SIZE,
        hasMore,
        nextCursor: hasMore ? encodeMarketAnalysisHistoryCursor(data[data.length - 1]) : null,
      },
    };
  }

  async getMarketAnalysisHistoryById(
    id: string,
  ): Promise<MarketAnalysisHistory> {
    const record = await this.marketAnalysisHistoryModel.findById(id).exec();
    if (!record) {
      throw new NotFoundException(
        `Market Analysis History with ID ${id} not found`,
      );
    }
    return record;
  }

  async cleanArticle(id: string): Promise<NewsArticle> {
    const article = await this.newsArticleModel.findById(id);
    if (!article) {
      throw new NotFoundException(`Article with ID ${id} not found`);
    }

    if (!article.content || article.content.trim().length === 0) {
      try {
        const extracted = await ArticleExtractorUtil.extractArticle(
          article.url,
        );
        if (!article.thumbnailUrl && extracted.thumbnailUrl) {
          article.thumbnailUrl = extracted.thumbnailUrl;
        }
        if (
          (!article.publishDate || article.publishDate === 'Invalid Date') &&
          extracted.publishDate
        ) {
          const tempDate = new Date(extracted.publishDate);
          if (!isNaN(tempDate.getTime())) {
            article.publishDate = tempDate.toISOString();
          }
        }
        if (extracted.markdown) {
          article.content = normalizeContent(extracted.markdown);
        }
      } catch (error: any) {
        this.logger.warn(
          `Failed to extract article ${article.url}: ${error.message}`,
        );
      }
    }

    if (!article.publishDate || article.publishDate === 'Invalid Date') {
      article.publishDate = new Date().toISOString();
    }

    if (article.content && article.content.trim().length > 0) {
      try {
        article.content = normalizeContent(
          await this.aiFilterService.cleanMarkdownContentWithAI(
            article.content,
          ),
        );
      } catch (error: any) {
        this.logger.warn(
          `AI cleanup failed for article ${id}, retaining raw content fallback: ${error.message}`,
        );
      }
    }

    let statusArray: any[] = [];
    if (Array.isArray(article.status)) {
      statusArray = article.status;
    } else if (article.status) {
      statusArray = [article.status];
    }
    article.status = statusArray.filter((s: string) =>
      Object.values(NewsStatus).includes(s as any),
    ) as NewsStatus[];

    const contentStr = article.content || '';
    if (contentStr.trim().length > 0) {
      if (!article.status.includes(NewsStatus.CRAWLED)) {
        article.status.push(NewsStatus.CRAWLED);
      }
    } else {
      article.status = article.status.filter(
        (s: string) => s !== (NewsStatus.CRAWLED as string),
      );
    }

    await article.save();
    return article;
  }

  /**
   * Xoa cac bai trong news_articles theo urlHash — dung de rollback compensating transaction
   * khi deleteRawArticlesBulk that bai sau khi saveArticles da thanh cong.
   * Chi xoa dung cac hash duoc truyen vao, khong anh huong bai khac.
   */
  async deleteArticlesByUrlHashes(urlHashes: string[]): Promise<void> {
    if (urlHashes.length === 0) return;
    await this.newsArticleModel
      .deleteMany({ urlHash: { $in: urlHashes } })
      .exec();
  }

  /**
   * Map urlHashes -> news_article _id.
   * Dung sau saveArticles de lay _id cua cac vua tao/da ton tai.
   */
  async getArticleIdsByUrlHashes(urlHashes: string[]): Promise<string[]> {
    if (!urlHashes || urlHashes.length === 0) return [];
    const articles = await this.newsArticleModel
      .find({ urlHash: { $in: urlHashes } })
      .select('_id')
      .lean()
      .exec();
    return articles.map((a: any) => a._id.toString());
  }
}
