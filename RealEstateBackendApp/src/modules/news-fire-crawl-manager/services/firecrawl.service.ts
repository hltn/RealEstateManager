import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import FirecrawlApp from '@mendable/firecrawl-js';
import { NewsSourceService } from './news-source.service';
import { RawArticle } from '../schemas/raw-article.schema';

@Injectable()
export class FirecrawlService {
  private readonly logger = new Logger(FirecrawlService.name);
  private firecrawlApp: FirecrawlApp;

  constructor(
    private configService: ConfigService,
    private newsSourceService: NewsSourceService,
    @InjectModel(RawArticle.name) private rawArticleModel: Model<RawArticle>,
  ) {
    const apiKey =
      this.configService.get<string>('FIRECRAWL_API_KEY') || 'dummy';
    this.firecrawlApp = new FirecrawlApp({ apiKey });
  }

  async scrapeUrl(url: string, options?: any): Promise<any> {
    return this.firecrawlApp.scrapeUrl(url, options);
  }

  async crawlData(): Promise<string> {
    this.logger.log('Starting Job 1: Crawl data via Firecrawl');

    let crawledData: Array<{
      url: string;
      title: string;
      description?: string;
      content: string;
      source: string;
      publishedAt: string;
      thumbnailUrl?: string;
    }> = [];

    // Dynamically fetch active sources from Database
    const activeSources = await this.newsSourceService.findActive();

    const apiKey = this.configService.get<string>('FIRECRAWL_API_KEY');
    const isApiKeyValid = apiKey && apiKey !== 'your_firecrawl_api_key_here';

    if (!isApiKeyValid) {
      this.logger.error('FIRECRAWL_API_KEY is not set or invalid.');
      throw new BadRequestException('FIRECRAWL_API_KEY is not set or invalid.');
    }

    try {
      for (const source of activeSources) {
        this.logger.log(
          `Extracting list of articles from source: ${source.name} (${source.url})`,
        );

        try {
          // 1. Extract the list of articles from the category/listing page
          const extractResult = (await this.firecrawlApp.extract({
            urls: [source.url],
            prompt: 'Extract a list of news articles from this listing page',
            schema: {
              type: 'object',
              properties: {
                articles: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      title: { type: 'string' },
                      url: { type: 'string' },
                      description: { type: 'string' },
                      publishedAt: { type: 'string' },
                      thumbnailUrl: { type: 'string' },
                    },
                    required: ['title', 'url'],
                  },
                },
              },
              required: ['articles'],
            },
          } as any)) as any;

          if (extractResult.success === false || !extractResult.data?.articles) {
            this.logger.error(
              `Failed to extract articles from ${source.url}. Error or no articles found. Raw response: ${JSON.stringify(extractResult)}`,
            );
            continue; // Skip this source and try next
          }

          const articles = extractResult.data.articles;
          this.logger.log(
            `Found ${articles.length} articles from ${source.name}. Scraping detail pages...`,
          );

          // 2. Scrape each article's detail page sequentially to get the full content
          /* 
          for (const article of articles) {
            this.logger.log(`Scraping detail page: ${article.url}`);
            
            try {
              const detailScrapeResult = (await this.firecrawlApp.scrapeUrl(
                article.url,
                { formats: ['markdown'] },
              )) as any;

              if (detailScrapeResult.success === false) {
                this.logger.warn(
                  `Failed to scrape detail page ${article.url}: ${detailScrapeResult.error || 'Unknown error'}`,
                );
                continue;
              }

              const resultData = detailScrapeResult.data || detailScrapeResult;

              crawledData.push({
                url: article.url,
                title: article.title || resultData.metadata?.title || source.name,
                description: article.description || resultData.metadata?.description || '',
                content: resultData.markdown || '',
                source: source.name,
                publishedAt: article.publishedAt || new Date().toISOString(),
                thumbnailUrl: article.thumbnailUrl || resultData.metadata?.ogImage || '',
              });
            } catch (detailErr: any) {
              this.logger.error(
                `Error scraping detail page ${article.url}: ${detailErr.message}`,
              );
            }
          }
          */

          // 2. Temp alternative: Skip detail scraping, just use data extracted from Step 1 directly
          for (const article of articles) {
            const articleData = {
              url: article.url,
              title: article.title || source.name,
              description: article.description || '',
              content: '',
              source: source.name,
              publishedAt: article.publishedAt || new Date().toISOString(),
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
          this.logger.error(
            `Error processing source ${source.name}: ${e.message}`,
          );
        }
      }
    } catch (error: any) {
      this.logger.error(
        `Error in Firecrawl scrape: ${error.message}`,
        error.stack,
      );
      throw new BadRequestException(
        `Error in Firecrawl scrape: ${error.message}`,
      );
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
