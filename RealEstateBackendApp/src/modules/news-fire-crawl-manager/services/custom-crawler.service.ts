import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as fs from 'fs';
import * as path from 'path';
import axios, { AxiosRequestConfig, AxiosResponse } from 'axios';
import * as https from 'https';
import * as cheerio from 'cheerio';
import Parser from 'rss-parser';

import { NewsSourceService } from './news-source.service';
import { RawArticle } from '../schemas/raw-article.schema';
import { AIFilterService } from './ai-filter.service';
import { AiPromptConfigService } from './ai-prompt-config.service';
import { ExternalLogService } from '../../external-log/services/external-log.service';
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
  startOfDayUtcDaysAgo,
} from '../../../common/utils/timezone.util';

@Injectable()
export class CustomCrawlerService {
  private readonly logger = new Logger(CustomCrawlerService.name);
  private rssParser: Parser;

  /**
   * User-Agent chung cho mọi request fetch RSS/HTML.
   * Tránh duplicate chuỗi UA dài ở nhiều nhánh fetch (DRY).
   */
  private static readonly USER_AGENT =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

  constructor(
    private newsSourceService: NewsSourceService,
    private aiFilterService: AIFilterService,
    private aiPromptConfigService: AiPromptConfigService,
    private externalLogService: ExternalLogService,
    @InjectModel(RawArticle.name) private rawArticleModel: Model<RawArticle>,
  ) {
    this.rssParser = new Parser({
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
      requestOptions: {
        rejectUnauthorized: false,
      },
    });
  }

  async crawlData(
    days?: number,
    startDate?: string,
    endDate?: string,
  ): Promise<{
    filePath: string;
    stats: {
      successfulSources: number;
      failedSources: number;
      totalArticles: number;
      successfulDetails: { url: string; count: number }[];
      failedDetails: { url: string; error: string }[];
    };
  }> {
    this.logger.log(
      `Starting Job 1: Crawl data via CustomCrawlerService. Filter: days=${days || 'none'}, start=${startDate || 'none'}, end=${endDate || 'none'}`,
    );

    let cutoffDate: Date | null = null;
    let startDateObj: Date | null = null;
    let endDateObj: Date | null = null;

    if (days && days > 0) {
      // "Hôm nay" phải tính theo giờ Việt Nam (không phải UTC/giờ local của
      // server) rồi mới lùi lại (days - 1) ngày và lấy mốc đầu ngày đó —
      // toàn bộ phép tính gom về timezone.util (startOfDayUtcDaysAgo).
      cutoffDate = startOfDayUtcDaysAgo(days);
    }

    if (startDate) {
      startDateObj = startOfDayUtc(startDate);
    }
    if (endDate) {
      endDateObj = endOfDayUtc(endDate);
    }

    const crawledData: Array<{
      url: string;
      title: string;
      description?: string;
      content: string;
      source: string;
      publishedAt: string;
      thumbnailUrl?: string;
    }> = [];

    const activeSources = await this.newsSourceService.findActive();

    let successfulSources = 0;
    let failedSources = 0;
    const successfulDetails: { url: string; count: number }[] = [];
    const failedDetails: { url: string; error: string }[] = [];

    for (const source of activeSources) {
      this.logger.log(
        `Extracting list of articles from source: ${source.name} (${source.url})`,
      );

      try {
        let articles: any[] = [];
        let validArticlesCount = 0;

        if (source.rssUrl) {
          this.logger.log(
            `Using RSS Feed for ${source.name}: ${source.rssUrl}`,
          );
          const rssBody = await this.fetchWithAntiBotBypass(
            source.rssUrl,
            source.name,
          );
          // Remove BOM, control characters (except tab, newline, carriage return), and trim
          const cleanXml = rssBody
            .replace(/^\uFEFF/g, '')
            .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
            .trim();

          let xmlStartIndex = cleanXml.indexOf('<?xml');
          if (xmlStartIndex === -1) {
            xmlStartIndex = cleanXml.indexOf('<rss');
          }
          if (xmlStartIndex === -1) {
            xmlStartIndex = cleanXml.indexOf('<feed');
          }

          const finalXml =
            xmlStartIndex >= 0 ? cleanXml.substring(xmlStartIndex) : cleanXml;
          let feed;
          try {
            feed = await this.rssParser.parseString(finalXml);
          } catch (err: any) {
            this.logger.error(
              `Failed to parse RSS for ${source.name}. URL: ${source.rssUrl}`,
            );
            this.logger.error(`Parser error: ${err.message}`);
            this.logger.error(
              `Raw XML snippet: ${finalXml.substring(0, 500)}...`,
            );
            throw err;
          }

          articles = feed.items.map((item) => ({
            title: item.title || '',
            url: item.link || '',
            description: item.contentSnippet || item.content || '',
            publishedAt:
              item.pubDate || item.isoDate || new Date().toISOString(),
          }));
        } else {
          this.logger.log(
            `Using AI Extractor for ${source.name}: ${source.url}`,
          );
          // Dùng helper bypass chung (cả RSS + HTML) — chống duplicate logic
          // anti-bot challenge ở 2 nhánh. axios mặc định follow redirect
          // (maxRedirects: 5) nên sau khi replay cookie, nếu site trả 302
          // tới trang thật (VD quochoi.vn → /Pages/default.aspx) thì axios
          // tự follow và lấy HTML thật cho AI.
          const html = await this.fetchWithAntiBotBypass(
            source.url,
            source.name,
          );

          const $ = cheerio.load(html);
          $('script, style, noscript, iframe, nav, footer, header').remove();
          const cleanHtml = $('body').html() || '';

          const prompt = this.aiPromptConfigService.getPromptByName(
            'EXTRACT_LISTING_PROMPT',
          );

          if (!prompt) {
            throw new Error(
              'EXTRACT_LISTING_PROMPT not found in ai-prompts.json',
            );
          }

          const aiResult = await this.aiFilterService.callAiCompletion(
            prompt,
            cleanHtml.substring(0, 30000),
            'Extract listings',
          );

          try {
            let cleanAiResult = aiResult.trim();
            if (cleanAiResult.startsWith('```json')) {
              cleanAiResult = cleanAiResult
                .replace(/^```json/, '')
                .replace(/```$/, '')
                .trim();
            } else if (cleanAiResult.startsWith('```')) {
              cleanAiResult = cleanAiResult
                .replace(/^```/, '')
                .replace(/```$/, '')
                .trim();
            }
            const parsed = JSON.parse(cleanAiResult);
            if (Array.isArray(parsed)) {
              articles = parsed;
            } else if (parsed.articles && Array.isArray(parsed.articles)) {
              articles = parsed.articles;
            }
          } catch (e) {
            this.logger.error(
              `Failed to parse AI output for ${source.name}. Output: ${aiResult}`,
              e,
            );
          }
        }

        for (const article of articles) {
          if (!article.url || !article.title) continue;

          try {
            article.url = new URL(article.url, source.url).href;
          } catch (e) {
            this.logger.warn(
              `Failed to resolve URL: ${article.url} against base: ${source.url}`,
            );
          }

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

          if (startDateObj && parsedDate < startDateObj) {
            continue;
          }
          if (endDateObj && parsedDate > endDateObj) {
            continue;
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

          // urlHash SHA-256 — đồng bộ với NewsArticle (trước đây dùng MD5).
          // Bọc per-article trong try/catch: 1 URL hỏng (rỗng/whitespace) làm
          // generateUrlHash throw → chỉ skip bài đó, KHÔNG gãy cả source
          // (m3). generateUrlHash giữ contract throw khi url rỗng là đúng — chỉ
          // thay cách caller xử lý.
          try {
            const urlHash = generateUrlHash(articleData.url);
            await this.rawArticleModel.updateOne(
              { urlHash },
              { $set: { ...articleData, urlHash } },
              { upsert: true },
            );

            crawledData.push(articleData);
            validArticlesCount++;
          } catch (hashErr: any) {
            this.logger.warn(
              `Skip article bad URL/hash '${article.url}': ${hashErr.message}`,
            );
            continue;
          }
        }
        successfulSources++;
        successfulDetails.push({ url: source.url, count: validArticlesCount });
      } catch (e: any) {
        failedSources++;
        failedDetails.push({
          url: source.url,
          error: e?.message ?? 'Unknown error',
        });
        this.logger.error(
          `Error processing source ${source.name}: ${e.message}`,
          e.stack,
        );
      }
    }

    const tmpDir = path.join(process.cwd(), 'tmp');
    if (!fs.existsSync(tmpDir)) {
      fs.mkdirSync(tmpDir, { recursive: true });
    }

    const filePath = path.join(tmpDir, `crawled_data_${Date.now()}.json`);
    fs.writeFileSync(filePath, JSON.stringify(crawledData, null, 2), 'utf8');

    this.logger.log(`Job 1 completed. Saved temporary file to ${filePath}`);
    return {
      filePath,
      stats: {
        successfulSources,
        failedSources,
        totalArticles: crawledData.length,
        successfulDetails,
        failedDetails,
      },
    };
  }

  /**
   * Fetch body (RSS XML hoặc HTML) có bypass anti-bot challenge
   * (VD: laodong.vn / quochoi.vn / Cloudrity-fronted).
   *
   * Một số site trả challenge HTML set cookie qua JS `document.cookie="D1N=..."`
   * rồi `window.location.reload()`. Gọi lại cùng url với header `Cookie: <name>=<value>`
   * thì trả body thật (RSS XML hoặc HTML trang thật).
   *
   * Chiến lược:
   * 1. Gọi request đầu tiên (config chung: UA, httpsAgent, timeout 30s,
   *    responseType 'text' để luôn trả string cho cả RSS + HTML).
   * 2. Nếu body chứa pattern `document.cookie="..."` + `window.location.reload`
   *    → extract cặp `name=value` (ưu tiên D1N cụ thể, fallback generic) →
   *    re-fetch với header `Cookie`. Axios mặc định follow redirect
   *    (maxRedirects: 5) KHÔNG bị tắt → request 2 tự follow 302 tới trang thật.
   * 3. Giới hạn retry đúng 1 lần (2 request tổng) — chống loop vô hạn.
   * 4. Nếu sau retry vẫn là challenge → throw Error rõ ràng, rơi vào catch của
   *    crawlData và được lưu vào failedDetails.error.
   *
   * Dùng chung cho cả nhánh RSS (source.rssUrl) và nhánh AI Extractor
   * (source.url) — DRY: 1 helper generic, không lặp logic bypass ở 2 chỗ.
   *
   * Lưu ý bảo mật: KHÔNG log giá trị cookie.
   */
  private async fetchWithAntiBotBypass(
    url: string,
    sourceName?: string,
  ): Promise<string> {
    // targetService = source.name theo §9.1 spec; fallback hostname nếu không có context.
    const targetService = sourceName ?? this.extractHostname(url);

    const requestConfig = {
      headers: {
        'User-Agent': CustomCrawlerService.USER_AGENT,
      },
      httpsAgent: new https.Agent({ rejectUnauthorized: false }),
      timeout: 30000,
      responseType: 'text' as const,
    };

    const firstResponse = await this.performFetch(
      url,
      requestConfig,
      targetService,
      0,
    );
    const firstBody =
      typeof firstResponse.data === 'string'
        ? firstResponse.data
        : String(firstResponse.data);

    // Detect anti-bot challenge: set cookie qua JS rồi reload trang
    const isChallenge =
      firstBody.includes('document.cookie=') ||
      firstBody.includes('window.location.reload');

    if (isChallenge) {
      // Ưu tiên cookie D1N cụ thể (laodong.vn), fallback generic cho các challenge tương tự.
      // Regex generic bắt cả cặp `name=value` gốc (VD `D1N=abc`) để gửi nguyên vẹn lên header.
      const d1nMatch = firstBody.match(/document\.cookie="D1N=([a-f0-9]+)"/);
      const genericMatch = firstBody.match(/document\.cookie="([^"]+)"/);
      const cookiePair = d1nMatch ? `D1N=${d1nMatch[1]}` : genericMatch?.[1];

      if (cookiePair) {
        this.logger.warn(
          `Anti-bot challenge detected for ${url}, replaying with cookie`,
        );
        const secondResponse = await this.performFetch(
          url,
          {
            ...requestConfig,
            headers: {
              ...requestConfig.headers,
              Cookie: cookiePair,
            },
          },
          targetService,
          1,
        );
        const secondBody =
          typeof secondResponse.data === 'string'
            ? secondResponse.data
            : String(secondResponse.data);

        // Cookie không bypass được → throw rõ ràng để crawlData catch và log
        if (
          secondBody.includes('document.cookie=') ||
          secondBody.includes('window.location.reload')
        ) {
          throw new Error(
            `Fetch failed: anti-bot challenge could not be bypassed for ${url}`,
          );
        }
        return secondBody;
      }
    }

    return firstBody;
  }

  /**
   * Choke point crawl: thực hiện 1 HTTP GET ra ngoài (axios) + ghi external log
   * (fire-and-forget qua ExternalLogService.logCrawl — không bao giờ throw từ logger).
   *
   * Theo §9.1 spec:
   * - Log TỪNG HTTP call (retryCount 0/1) để thấy rõ request nào 403 anti-bot.
   * - statusCode từ response; axios throw → error.code = err.code (VD ECONNABORTED),
   *   nếu err.response tồn tại (403 Cloudflare, 503…) vẫn lưu statusCode +
   *   response.body = err.response.data (raw HTML error).
   * - response.body là HTML/RSS string → truncate 50KB xảy ra bên trong logger.
   * - request.prompt để rỗng (không phải AI).
   * - Cookie KHÔNG bao giờ lọt vào log (sanitizer mask header 'cookie').
   */
  private async performFetch(
    url: string,
    config: AxiosRequestConfig,
    targetService: string,
    retryCount: number,
  ): Promise<AxiosResponse> {
    const startTime = Date.now();
    try {
      const response = await axios.get(url, config);
      this.externalLogService.logCrawl({
        targetService,
        url,
        method: 'GET',
        statusCode: response.status,
        durationMs: Date.now() - startTime,
        requestHeaders: config.headers,
        requestQuery: this.extractQueryParams(url),
        responseHeaders: response.headers,
        responseBody: response.data,
        metadata: { retryCount },
      });
      return response;
    } catch (err: any) {
      this.externalLogService.logCrawl({
        targetService,
        url,
        method: 'GET',
        statusCode: err.response?.status,
        durationMs: Date.now() - startTime,
        requestHeaders: config.headers,
        requestQuery: this.extractQueryParams(url),
        responseHeaders: err.response?.headers as
          | Record<string, any>
          | undefined,
        responseBody: err.response?.data,
        error: {
          message: err.message,
          code: err.code ?? err.name,
          stack: err.stack,
        },
        metadata: { retryCount },
      });
      throw err;
    }
  }

  /** Tách query params từ URL string thành object (giá trị nhạy cảm sẽ được mask trong logger). */
  private extractQueryParams(url: string): Record<string, any> {
    try {
      const parsed = new URL(url);
      const query: Record<string, any> = {};
      parsed.searchParams.forEach((value, key) => {
        query[key] = value;
      });
      return query;
    } catch {
      return {};
    }
  }

  /** Fallback targetService khi không có source.name (lấy hostname từ URL). */
  private extractHostname(url: string): string {
    try {
      return new URL(url).hostname;
    } catch {
      return url;
    }
  }

  /**
   * Lấy danh sách raw article theo filter + phân trang.
   * Trả về { data, total }: total được đếm bằng countDocuments với CÙNG query filter
   * để controller tính totalPages. find và countDocuments chạy song song bằng
   * Promise.all nên latency không bị cộng dồn.
   */
  async getRawArticles(
    search?: string,
    sort?: 'newest' | 'oldest',
    startDate?: string,
    endDate?: string,
    page: number = DEFAULT_PAGE,
    limit: number = DEFAULT_LIMIT,
  ): Promise<PaginatedResult<RawArticle>> {
    const query: any = {};
    if (search) {
      const escapeRegex = (text: string) =>
        text.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
      const safeSearch = escapeRegex(search);
      query.$or = [
        { title: { $regex: safeSearch, $options: 'i' } },
        { description: { $regex: safeSearch, $options: 'i' } },
      ];
    }
    if (startDate || endDate) {
      query.publishedAt = {};
      if (startDate) {
        query.publishedAt.$gte = startOfDayUtc(startDate).toISOString();
      }
      if (endDate) {
        query.publishedAt.$lte = endOfDayUtc(endDate).toISOString();
      }
    }

    let sortObj: any = { publishedAt: -1 };
    if (sort === 'oldest') {
      sortObj = { publishedAt: 1 };
    }

    const { skip, limit: pageSize } = normalizePagination(page, limit);

    const [data, total] = await Promise.all([
      this.rawArticleModel
        .find(query)
        .sort(sortObj)
        .skip(skip)
        .limit(pageSize)
        .exec(),
      this.rawArticleModel.countDocuments(query).exec(),
    ]);

    return { data, total };
  }

  async getRawArticlesByIds(ids: string[]): Promise<any[]> {
    return this.rawArticleModel
      .find({ _id: { $in: ids } })
      .lean()
      .exec();
  }

  /**
   * Lấy toàn bộ raw articles chỉ với các field cần thiết cho pipeline phân tích AI.
   * Áp dụng nguyên tắc Least Privilege Data: chỉ select urlHash, title, description.
   */
  async getAllRawArticles(): Promise<
    Array<{ urlHash: string; title: string; description: string }>
  > {
    return this.rawArticleModel
      .find()
      .select('urlHash title description')
      .lean()
      .exec() as Promise<
      Array<{ urlHash: string; title: string; description: string }>
    >;
  }

  async deleteRawArticle(id: string): Promise<void> {
    await this.rawArticleModel.findByIdAndDelete(id).exec();
  }

  async deleteRawArticlesBulk(ids: string[]): Promise<void> {
    await this.rawArticleModel.deleteMany({ _id: { $in: ids } }).exec();
  }

  /**
   * [DEPRECATED - nguy hiểm] Xóa mọi bài KHÔNG nằm trong urlHashes trên toàn collection.
   * Chỉ giữ lại để tránh break nếu còn chỗ nào đó gọi — KHÔNG dùng cho analyze-raw nữa.
   */
  async deleteRawArticlesNotIn(urlHashes: string[]): Promise<void> {
    await this.rawArticleModel
      .deleteMany({ urlHash: { $nin: urlHashes } })
      .exec();
  }

  /**
   * Xóa cứng những bài nằm trong submittedHashes nhưng KHÔNG có trong keepHashes.
   * Phạm vi xóa bị giới hạn đúng trong tập submittedHashes — tránh xóa lan ra toàn collection
   * khi FE chỉ gửi lên một trang (phân trang).
   *
   * @param submittedHashes - Tập urlHash FE gửi lên để AI phân tích (phạm vi trang hiện tại)
   * @param keepHashes      - Tập urlHash AI quyết định giữ lại
   */
  async deleteRawArticlesInSetNotIn(
    submittedHashes: string[],
    keepHashes: string[],
  ): Promise<void> {
    // Không có bài nào được submit → bỏ qua, tránh xóa nhầm
    if (submittedHashes.length === 0) return;
    await this.rawArticleModel
      .deleteMany({ urlHash: { $in: submittedHashes, $nin: keepHashes } })
      .exec();
  }
}
