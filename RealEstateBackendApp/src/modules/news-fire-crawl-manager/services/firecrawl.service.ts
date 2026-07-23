import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import FirecrawlApp from '@mendable/firecrawl-js';
import { NewsSourceService } from './news-source.service';

@Injectable()
export class FirecrawlService {
  private readonly logger = new Logger(FirecrawlService.name);
  private firecrawlApp: FirecrawlApp;

  constructor(
    private configService: ConfigService,
    private newsSourceService: NewsSourceService,
  ) {
    const apiKey =
      this.configService.get<string>('FIRECRAWL_API_KEY') || 'dummy';
    this.firecrawlApp = new FirecrawlApp({ apiKey });
  }

  async crawlData(): Promise<string> {
    this.logger.log('Starting Job 1: Crawl data via Firecrawl');

    let crawledData: Array<{
      url: string;
      title: string;
      content: string;
      source: string;
      publishedAt: string;
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
            `Scraping real data from source: ${source.name} (${source.url})`,
          );

          try {
            const scrapeResult = (await this.firecrawlApp.scrapeUrl(
              source.url,
              { formats: ['markdown'] },
            )) as any;

            if (scrapeResult.success === false) {
              this.logger.error(
                `Failed to scrape ${source.url}: ${scrapeResult.error || 'Unknown error'}`,
              );
              continue; // Skip this source and try next
            }

            const resultData = scrapeResult.data || scrapeResult;

            crawledData.push({
              url: source.url,
              title: resultData.metadata?.title || source.name,
              content: resultData.markdown || '',
              source: source.name,
              publishedAt: new Date().toISOString(),
            });
          } catch (e: any) {
            this.logger.error(
              `Error scraping source ${source.name}: ${e.message}`,
            );
          }
        }
      } catch (error: any) {
      this.logger.error(
        `Error in Firecrawl scrape: ${error.message}`,
        error.stack,
      );
      throw new BadRequestException(`Error in Firecrawl scrape: ${error.message}`);
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
}
