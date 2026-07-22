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
  ): Promise<{ savedCount: number; duplicates: number }> {
    this.logger.log('Starting Job 3: Save to Database');
    let savedCount = 0;
    let duplicates = 0;

    for (const article of articles) {
      const urlHash = crypto
        .createHash('sha256')
        .update(article.url)
        .digest('hex');

      const existing = await this.newsArticleModel.findOne({ urlHash });
      if (existing) {
        duplicates++;
        continue;
      }

      const newArticle = new this.newsArticleModel({
        ...article,
        urlHash,
      });

      await newArticle.save();
      savedCount++;
    }

    this.logger.log(
      `Job 3 completed. Saved: ${savedCount}, Duplicates ignored: ${duplicates}`,
    );
    return { savedCount, duplicates };
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
}
