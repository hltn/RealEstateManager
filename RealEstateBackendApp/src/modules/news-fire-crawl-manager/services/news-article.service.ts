import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { NewsArticle, NewsStatus } from '../schemas/news-article.schema';
import * as crypto from 'crypto';
import { WordPressService } from './wordpress.service';

@Injectable()
export class NewsArticleService {
  private readonly logger = new Logger(NewsArticleService.name);

  constructor(
    @InjectModel(NewsArticle.name)
    private readonly newsArticleModel: Model<NewsArticle>,
    private readonly wordpressService: WordPressService,
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
          status: article.status || NewsStatus.SAVED,
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

    if (article.status === NewsStatus.POSTED_WP) {
      return article; // Already published
    }

    try {
      const wpPostId = await this.wordpressService.pushToWordPress(article);
      article.wpPostId = wpPostId;
      article.status = NewsStatus.POSTED_WP;
      return await article.save();
    } catch (error) {
      article.status = NewsStatus.ERROR;
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
}
