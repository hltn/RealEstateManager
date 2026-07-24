import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import axios from 'axios';
import * as cheerio from 'cheerio';
import Parser from 'rss-parser';

import { NewsSourceService } from './news-source.service';
import { RawArticle } from '../schemas/raw-article.schema';
import { AIFilterService } from './ai-filter.service';
import { AiPromptConfigService } from './ai-prompt-config.service';

@Injectable()
export class CustomCrawlerService {
  private readonly logger = new Logger(CustomCrawlerService.name);
  private rssParser: Parser;

  constructor(
    private newsSourceService: NewsSourceService,
    private aiFilterService: AIFilterService,
    private aiPromptConfigService: AiPromptConfigService,
    @InjectModel(RawArticle.name) private rawArticleModel: Model<RawArticle>,
  ) {
    this.rssParser = new Parser();
  }

  async crawlData(days?: number): Promise<string> {
    this.logger.log(`Starting Job 1: Crawl data via CustomCrawlerService. Filter: ${days ? `last ${days} days` : 'All time'}`);

    let cutoffDate: Date | null = null;
    if (days && days > 0) {
      cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - (days - 1));
      // Reset to start of day
      cutoffDate.setHours(0, 0, 0, 0);
    }

    let crawledData: Array<{
      url: string;
      title: string;
      description?: string;
      content: string;
      source: string;
      publishedAt: string;
      thumbnailUrl?: string;
    }> = [];

    const activeSources = await this.newsSourceService.findActive();

    for (const source of activeSources) {
      this.logger.log(`Extracting list of articles from source: ${source.name} (${source.url})`);

      try {
        let articles: any[] = [];

        if (source.rssUrl) {
          this.logger.log(`Using RSS Feed for ${source.name}: ${source.rssUrl}`);
          const feed = await this.rssParser.parseURL(source.rssUrl);
          articles = feed.items.map(item => ({
            title: item.title || '',
            url: item.link || '',
            description: item.contentSnippet || item.content || '',
            publishedAt: item.pubDate || item.isoDate || new Date().toISOString(),
          }));
        } else {
          this.logger.log(`Using AI Extractor for ${source.name}: ${source.url}`);
          const response = await axios.get(source.url, {
            headers: {
              'User-Agent':
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            },
          });
          const html = response.data;

          const $ = cheerio.load(html);
          $('script, style, noscript, iframe, nav, footer, header').remove();
          const cleanHtml = $('body').html() || '';

          const prompt = this.aiPromptConfigService.getPromptByName('EXTRACT_LISTING_PROMPT');
          
          if (!prompt) {
             throw new Error('EXTRACT_LISTING_PROMPT not found in ai-prompts.json');
          }

          const aiResult = await this.aiFilterService.analyzeMarketTrends(prompt, cleanHtml.substring(0, 30000));

          try {
            let cleanAiResult = aiResult.trim();
            if (cleanAiResult.startsWith('```json')) {
              cleanAiResult = cleanAiResult.replace(/^```json/, '').replace(/```$/, '').trim();
            } else if (cleanAiResult.startsWith('```')) {
              cleanAiResult = cleanAiResult.replace(/^```/, '').replace(/```$/, '').trim();
            }
            const parsed = JSON.parse(cleanAiResult);
            if (Array.isArray(parsed)) {
              articles = parsed;
            } else if (parsed.articles && Array.isArray(parsed.articles)) {
              articles = parsed.articles;
            }
          } catch (e) {
            this.logger.error(`Failed to parse AI output for ${source.name}. Output: ${aiResult}`);
          }
        }

        for (const article of articles) {
          if (!article.url || !article.title) continue;

          let parsedDate = new Date();
          if (article.publishedAt) {
            const tempDate = new Date(article.publishedAt);
            if (!isNaN(tempDate.getTime())) {
              parsedDate = tempDate;
            }
          }

          // Filter by date if cutoffDate is set
          if (cutoffDate && parsedDate < cutoffDate) {
            continue; // Bỏ qua bài viết cũ hơn số ngày chỉ định
          }

          const articleData = {
            url: article.url,
            title: article.title || source.name,
            description: article.description || '',
            content: '', // Phase 1: Content is empty
            source: source.name,
            publishedAt: parsedDate.toISOString(),
            thumbnailUrl: article.thumbnailUrl || '',
          };

          const urlHash = crypto.createHash('md5').update(articleData.url).digest('hex');

          await this.rawArticleModel.updateOne(
            { urlHash },
            { $set: { ...articleData, urlHash } },
            { upsert: true }
          );

          crawledData.push(articleData);
        }
      } catch (e: any) {
        this.logger.error(`Error processing source ${source.name}: ${e.message}`, e.stack);
      }
    }

    const tmpDir = path.join(process.cwd(), 'tmp');
    if (!fs.existsSync(tmpDir)) {
      fs.mkdirSync(tmpDir, { recursive: true });
    }

    const filePath = path.join(tmpDir, `crawled_data_${Date.now()}.json`);
    fs.writeFileSync(filePath, JSON.stringify(crawledData, null, 2), 'utf8');

    this.logger.log(`Job 1 completed. Saved temporary file to ${filePath}`);
    return filePath;
  }

  async getRawArticles(search?: string, sort?: 'newest' | 'oldest'): Promise<RawArticle[]> {
    const query: any = {};
    if (search) {
      const escapeRegex = (text: string) => text.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
      const safeSearch = escapeRegex(search);
      query.$or = [
        { title: { $regex: safeSearch, $options: 'i' } },
        { description: { $regex: safeSearch, $options: 'i' } }
      ];
    }
    
    let sortObj: any = { publishedAt: -1 };
    if (sort === 'oldest') {
      sortObj = { publishedAt: 1 };
    }

    return this.rawArticleModel.find(query).sort(sortObj).exec();
  }

  async getRawArticlesByIds(ids: string[]): Promise<any[]> {
    return this.rawArticleModel.find({ _id: { $in: ids } }).lean().exec();
  }

  async deleteRawArticle(id: string): Promise<void> {
    await this.rawArticleModel.findByIdAndDelete(id).exec();
  }

  async deleteRawArticlesBulk(ids: string[]): Promise<void> {
    await this.rawArticleModel.deleteMany({ _id: { $in: ids } }).exec();
  }

  async deleteRawArticlesNotIn(urlHashes: string[]): Promise<void> {
    await this.rawArticleModel.deleteMany({ urlHash: { $nin: urlHashes } }).exec();
  }
}
