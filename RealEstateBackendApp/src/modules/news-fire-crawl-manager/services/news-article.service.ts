import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { NewsArticle, NewsStatus } from '../schemas/news-article.schema';
import * as crypto from 'crypto';
import { WordPressService } from './wordpress.service';
import { FirecrawlService } from './firecrawl.service';
import { cleanMarkdownContent } from '../../../utils/content-cleaner';

@Injectable()
export class NewsArticleService {
  private readonly logger = new Logger(NewsArticleService.name);

  constructor(
    @InjectModel(NewsArticle.name)
    private readonly newsArticleModel: Model<NewsArticle>,
    private readonly wordpressService: WordPressService,
    private readonly firecrawlService: FirecrawlService,
  ) {}

  async saveArticles(
    articles: any[],
  ): Promise<{ savedCount: number; duplicates: number; processedUrlHashes: string[] }> {
    this.logger.log('Starting Job 3: Save to Database');
    let savedCount = 0;
    let duplicates = 0;
    const processedUrlHashes: string[] = [];

    for (const article of articles) {
      try {
        const urlHash = article.urlHash || crypto
          .createHash('sha256')
          .update(article.url)
          .digest('hex');

        const existing = await this.newsArticleModel.findOne({ urlHash });
        if (existing) {
          duplicates++;
          processedUrlHashes.push(urlHash);
          continue;
        }

        let initialStatus = Array.isArray(article.status) ? article.status : (article.status ? [article.status] : []);
        initialStatus = initialStatus.filter((s: string) => Object.values(NewsStatus).includes(s as any));
        const contentStr = article.content || '';
        if (contentStr.trim().length > 0 && !initialStatus.includes(NewsStatus.CRAWLED)) {
          initialStatus.push(NewsStatus.CRAWLED);
        } else if (contentStr.trim().length === 0) {
          initialStatus = initialStatus.filter((s: string) => s !== NewsStatus.CRAWLED);
        }

        const mappedArticle = {
          title: article.title,
          summary: article.summary || article.description || article.content?.substring(0, 200),
          importanceReason: article.importanceReason,
          impactLevel: article.impactLevel,
          targetAudience: article.targetAudience,
          expertOpinion: article.expertOpinion,
          publishDate: article.publishDate || article.publishedAt,
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
        this.logger.error(`Failed to save article ${article.url}: ${error.message}`, error.stack);
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
    
    article.status = statusArray.filter((s: string) => Object.values(NewsStatus).includes(s as any)) as NewsStatus[];

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
    const result = await this.newsArticleModel.deleteMany({ _id: { $in: ids } });
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

    for (const id of ids) {
      try {
        const article = await this.newsArticleModel.findById(id);
        if (!article) {
          failed++;
          continue;
        }

        const scrapeResult = await this.firecrawlService.scrapeUrl(article.url, { formats: ['markdown'] });
        
        if (!scrapeResult || scrapeResult.success === false) {
          this.logger.warn(`Failed to scrape article ${article.url}: ${scrapeResult?.error || 'Unknown error'}. Raw response: ${JSON.stringify(scrapeResult)}`);
          failed++;
          continue;
        }

        const resultData = scrapeResult.data || scrapeResult;
        
        article.publishDate = resultData.metadata?.date || resultData.metadata?.publishedAt || new Date().toISOString();
        const rawMarkdown = resultData.markdown || '';
        article.content = cleanMarkdownContent(rawMarkdown);

        if (!article.thumbnailUrl && resultData.metadata?.ogImage) {
          article.thumbnailUrl = resultData.metadata.ogImage;
        }

        if (!article.summary && resultData.metadata?.description) {
          article.summary = resultData.metadata.description;
        }

        // Migration and cleanup of invalid statuses (like 'SAVED', '', etc)
        let statusArray: any[] = [];
        if (Array.isArray(article.status)) {
          statusArray = article.status;
        } else if (article.status) {
          statusArray = [article.status];
        }
        
        article.status = statusArray.filter((s: string) => Object.values(NewsStatus).includes(s as any)) as NewsStatus[];

        const contentStr = article.content || '';
        if (contentStr.trim().length > 0 && !article.status.includes(NewsStatus.CRAWLED)) {
          article.status.push(NewsStatus.CRAWLED);
        } else if (contentStr.trim().length === 0) {
          article.status = article.status.filter((s: string) => s !== NewsStatus.CRAWLED) as NewsStatus[];
        }

        await article.save();
        processed++;
      } catch (error: any) {
        this.logger.error(`Failed to analyze market for article ID ${id}: ${error.message}`, error.stack);
        failed++;
      }
    }

    return { processed, failed };
  }

  async cleanArticle(id: string): Promise<NewsArticle> {
    const article = await this.newsArticleModel.findById(id);
    if (!article) {
      throw new NotFoundException(`Article with ID ${id} not found`);
    }

    if (article.content) {
      this.logger.log(`Raw input content for article ${id}:\n${article.content}`);
      
      article.content = cleanMarkdownContent(article.content);
      
      this.logger.log(`Cleaned content for article ${id}:\n${article.content}`);
      
      await article.save();
      
      this.logger.log(`Successfully updated and saved cleaned content for article ${id} to DB`);
    }

    return article;
  }
}
