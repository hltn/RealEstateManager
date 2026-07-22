import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import FirecrawlApp, { ScrapeResponse } from '@mendable/firecrawl-js';
import { NewsSourceService } from './news-source.service';

@Injectable()
export class FirecrawlService {
  private readonly logger = new Logger(FirecrawlService.name);
  private firecrawlApp: FirecrawlApp;

  constructor(
    private configService: ConfigService,
    private newsSourceService: NewsSourceService,
  ) {
    const apiKey = this.configService.get<string>('FIRECRAWL_API_KEY') || 'dummy';
    this.firecrawlApp = new FirecrawlApp({ apiKey });
  }

  async crawlData(): Promise<string> {
    this.logger.log('Starting Job 1: Crawl data via Firecrawl');
    
    let crawledData = [];
    
    // Dynamically fetch active sources from Database
    const activeSources = await this.newsSourceService.findActive();

    try {
      if (this.configService.get<string>('FIRECRAWL_API_KEY')) {
        for (const source of activeSources) {
          this.logger.log(`Scraping real data from source: ${source.name} (${source.url})`);
          
          try {
            const scrapeResult = await this.firecrawlApp.scrapeUrl(source.url, { formats: ['markdown'] }) as ScrapeResponse;
            
            if (!scrapeResult.success) {
              this.logger.error(`Failed to scrape ${source.url}: ${scrapeResult.error}`);
              continue; // Skip this source and try next
            }

            crawledData.push({
              url: source.url,
              title: scrapeResult.metadata?.title || source.name,
              content: scrapeResult.markdown || '',
              source: source.name,
              publishedAt: new Date().toISOString(),
            });
          } catch (e: any) {
             this.logger.error(`Error scraping source ${source.name}: ${e.message}`);
          }
        }
      } else {
        this.logger.warn('FIRECRAWL_API_KEY is not set. Using mock data.');
        crawledData = [
          {
            url: 'https://example.com/news/1',
            title: 'Thị trường bất động sản phục hồi',
            content:
              'Nhiều tín hiệu cho thấy thị trường bất động sản đang có dấu hiệu phục hồi tích cực...',
            source: 'VnExpress',
            publishedAt: new Date().toISOString(),
          },
          {
            url: 'https://example.com/news/2',
            title: 'Lãi suất vay mua nhà giảm mạnh',
            content:
              'Các ngân hàng đồng loạt giảm lãi suất vay mua nhà xuống mức thấp kỷ lục...',
            source: 'Dantri',
            publishedAt: new Date().toISOString(),
          },
        ];
      }
    } catch (error: any) {
      this.logger.error(`Error in Firecrawl scrape: ${error.message}`, error.stack);
      throw error;
    }

    const tmpDir = path.join(process.cwd(), 'tmp');
    if (!fs.existsSync(tmpDir)) {
      fs.mkdirSync(tmpDir, { recursive: true });
    }

    const filePath = path.join(tmpDir, `crawled_data_${Date.now()}.json`);
    fs.writeFileSync(
      filePath,
      JSON.stringify(crawledData, null, 2),
      'utf8',
    );

    this.logger.log(`Job 1 completed. Saved temporary file to ${filePath}`);
    return filePath;
  }
}
