import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { NewsArticle, NewsStatus } from '../schemas/news-article.schema';
import * as crypto from 'crypto';
import { WordPressService } from './wordpress.service';
import { ArticleExtractorUtil } from '../../../utils/article-extractor.util';
import { AIFilterService } from './ai-filter.service';
import { AiPromptConfigService } from './ai-prompt-config.service';
import { MarketAnalysisHistory } from '../schemas/market-analysis-history.schema';

@Injectable()
export class NewsArticleService implements OnModuleInit {
  private readonly logger = new Logger(NewsArticleService.name);

  constructor(
    @InjectModel(NewsArticle.name)
    private readonly newsArticleModel: Model<NewsArticle>,
    @InjectModel(MarketAnalysisHistory.name)
    private readonly marketAnalysisHistoryModel: Model<MarketAnalysisHistory>,
    private readonly wordpressService: WordPressService,
    private readonly aiFilterService: AIFilterService,
    private readonly aiPromptConfigService: AiPromptConfigService,
  ) {}

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

  async saveArticles(articles: any[]): Promise<{
    savedCount: number;
    duplicates: number;
    processedUrlHashes: string[];
  }> {
    this.logger.log('Starting Job 3: Save to Database');
    let savedCount = 0;
    let duplicates = 0;
    const processedUrlHashes: string[] = [];

    for (const article of articles) {
      try {
        const urlHash =
          article.urlHash ||
          crypto.createHash('sha256').update(article.url).digest('hex');

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
          content: article.content,
          status: initialStatus,
        };

        const newArticle = new this.newsArticleModel({
          ...mappedArticle,
          urlHash,
        });

        await newArticle.save();
        savedCount++;
        processedUrlHashes.push(urlHash);
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
    return { savedCount, duplicates, processedUrlHashes };
  }

  async getSavedArticles(): Promise<NewsArticle[]> {
    return this.newsArticleModel.find().sort({ createdAt: -1 }).exec();
  }

  async publishToWordPress(id: string): Promise<NewsArticle> {
    const article = await this.newsArticleModel.findById(id);
    if (!article) {
      throw new NotFoundException(`Article with ID ${id} not found`);
    }

    // Ensure array for migration and clean up invalid statuses (like 'SAVED', '', etc)
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
      return article; // Already published
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
          // Fallback to raw markdown if AI fails
          article.content = rawMarkdown;
        }

        // Migration and cleanup of invalid statuses (like 'SAVED', '', etc)
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

    // Prepare combined data
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

    // Call AIFilterService
    const markdownResponse = await this.aiFilterService.analyzeMarketTrends(
      this.aiPromptConfigService.getPromptByName('MARKET_ANALYSIS_PROMPT'),
      combinedData,
    );

    // Save to MarketAnalysisHistory
    const historyEntry = new this.marketAnalysisHistoryModel({
      content: markdownResponse,
      articleIds: ids,
    });
    await historyEntry.save();

    return markdownResponse;
  }

  async getMarketAnalysisHistory(): Promise<MarketAnalysisHistory[]> {
    return this.marketAnalysisHistoryModel
      .find()
      .sort({ createdAt: -1 })
      .exec();
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
          article.content = extracted.markdown;
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
        article.content = await this.aiFilterService.cleanMarkdownContentWithAI(
          article.content,
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
}
