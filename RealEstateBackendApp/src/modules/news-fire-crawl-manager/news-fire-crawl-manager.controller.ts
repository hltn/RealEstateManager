import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Query,
  Delete,
  Logger,
  Put,
  Headers,
  ConflictException,
} from '@nestjs/common';
import { ApiOperation, ApiTags, ApiParam, ApiHeader } from '@nestjs/swagger';
import {
  UpdateCronConfigDto,
  BulkIdsDto,
  AnalyzeRawArticlesDto,
  SaveArticlesDto,
  TriggerManualCrawlDto,
  AiPromptDto,
  TriggerManualAnalyzeDto,
  GetRawArticlesQueryDto,
  GetArticlesQueryDto,
} from './dtos/news-manager.dto';
import { PaginatedResponseDto } from '../../common/dto/paginated-response.dto';
import {
  buildPaginationMeta,
  normalizePagination,
} from '../../common/utils/pagination.util';
import { RawArticle } from './schemas/raw-article.schema';
import { NewsArticle } from './schemas/news-article.schema';
import * as fs from 'fs';
import { CustomCrawlerService } from './services/custom-crawler.service';
import { AIFilterService } from './services/ai-filter.service';
import { NewsArticleService } from './services/news-article.service';
import { CronjobService } from './services/cronjob.service';
import { AiPromptConfigService } from './services/ai-prompt-config.service';
import { IdempotencyService } from '../../common/services/idempotency.service';
import { AuditAction } from './schemas/audit-log.schema';
import { AuditLogService } from './services/audit-log.service';

@ApiTags('News Manager')
@Controller('news-manager')
export class NewsFireCrawlManagerController {
  private readonly logger = new Logger(NewsFireCrawlManagerController.name);

  constructor(
    private readonly customCrawlerService: CustomCrawlerService,
    private readonly aiFilterService: AIFilterService,
    private readonly newsArticleService: NewsArticleService,
    private readonly cronjobService: CronjobService,
    private readonly aiPromptConfigService: AiPromptConfigService,
    private readonly idempotencyService: IdempotencyService,
    private readonly auditLogService: AuditLogService,
  ) {}

  @ApiOperation({ summary: 'Get prompts', description: 'Get prompts' })
  @Get('prompts')
  getPrompts() {
    return {
      success: true,
      data: this.aiPromptConfigService.getPrompts(),
    };
  }

  @ApiOperation({ summary: 'Update prompts', description: 'Update prompts' })
  @Put('prompts')
  async updatePrompts(@Body() newPrompts: AiPromptDto[]) {
    await this.aiPromptConfigService.updatePrompts(newPrompts);
    return { success: true, message: 'Prompts updated successfully' };
  }

  @ApiOperation({ summary: 'Get cron config', description: 'Get cron config' })
  @Get('cron')
  getCronConfig() {
    return this.cronjobService.getConfig();
  }

  @ApiOperation({
    summary: 'Update cron config',
    description: 'Update cron config',
  })
  @Post('cron')
  updateCronConfig(@Body() body: UpdateCronConfigDto) {
    return this.cronjobService.updateConfig(body.isActive, body.frequency);
  }

  @ApiOperation({
    summary: 'Get raw articles',
    description:
      'Danh sách raw article có phân trang. Response: { data, meta: { total, page, limit, totalPages } }',
  })
  @Get('raw-articles')
  async getRawArticles(
    @Query() query: GetRawArticlesQueryDto,
  ): Promise<PaginatedResponseDto<RawArticle>> {
    const { search, sort, startDate, endDate } = query;
    // Chuẩn hóa page/limit trước khi xuống service để meta trả về luôn khớp
    // với tham số thực sự dùng cho skip/limit.
    const { page, limit } = normalizePagination(query.page, query.limit);

    const { data, total } = await this.customCrawlerService.getRawArticles(
      search,
      sort,
      startDate,
      endDate,
      page,
      limit,
    );

    return {
      data,
      meta: buildPaginationMeta(total, page, limit),
    };
  }

  @ApiOperation({
    summary: 'Delete raw article',
    description: 'Delete raw article',
  })
  @ApiParam({ name: 'id', required: true })
  @Delete('raw-articles/:id')
  async deleteRawArticle(@Param('id') id: string) {
    await this.customCrawlerService.deleteRawArticle(id);
    // Ghi audit log sau khi xóa thành công (fire-and-forget)
    void this.auditLogService.log(
      AuditAction.DELETE,
      'raw_articles',
      [id],
      'system',
    );
    return { message: 'Raw article deleted successfully' };
  }

  @ApiOperation({
    summary: 'Delete raw articles bulk',
    description: 'Delete raw articles bulk',
  })
  @Post('raw-articles/delete-bulk')
  async deleteRawArticlesBulk(@Body() body: BulkIdsDto) {
    const { ids } = body;

    if (!Array.isArray(ids) || ids.length === 0) {
      return { message: 'No articles to delete' };
    }
    await this.customCrawlerService.deleteRawArticlesBulk(ids);
    // Ghi audit log sau khi xóa bulk thành công (fire-and-forget)
    void this.auditLogService.log(
      AuditAction.BULK_DELETE,
      'raw_articles',
      ids,
      'system',
      { count: ids.length },
    );
    return { message: 'Raw articles deleted successfully' };
  }

  @ApiOperation({
    summary: 'Move raw articles bulk',
    description: 'Move raw articles bulk',
  })
  @Post('raw-articles/move-bulk')
  async moveRawArticlesBulk(@Body() body: BulkIdsDto) {
    const { ids } = body;

    if (!Array.isArray(ids) || ids.length === 0) {
      return { message: 'No articles to move' };
    }
    const rawArticles =
      await this.customCrawlerService.getRawArticlesByIds(ids);
    if (rawArticles.length > 0) {
      const { processedUrlHashes, newlySavedUrlHashes } =
        await this.newsArticleService.saveArticles(rawArticles);

      // successfulIds: tất cả bài đã được xử lý (saved mới + duplicate đã tồn tại)
      // → an toàn để xóa khỏi raw_articles vì đã có trong news_articles
      const typedRawArticles = rawArticles as Array<{
        _id: { toString: () => string };
        urlHash?: string | null;
      }>;

      const successfulIds = typedRawArticles
        .filter(
          (
            raw,
          ): raw is {
            _id: { toString: () => string };
            urlHash: string;
          } => Boolean(raw.urlHash && processedUrlHashes.includes(raw.urlHash)),
        )
        .map((raw) => raw._id.toString());

      if (successfulIds.length > 0) {
        try {
          await this.customCrawlerService.deleteRawArticlesBulk(successfulIds);
          void this.auditLogService.log(
            AuditAction.BULK_MOVE,
            'raw_articles',
            successfulIds,
            'system',
            {
              count: successfulIds.length,
              movedTo: 'news_articles',
            },
          );
        } catch (deleteError: any) {
          // Compensating transaction: rollback các bài được insert MỚI (không rollback duplicate)
          // vì duplicate đã tồn tại từ trước — xóa đi sẽ gây mất dữ liệu cũ
          this.logger.error(
            `deleteRawArticlesBulk thất bại sau saveArticles — bắt đầu rollback ${newlySavedUrlHashes.length} bài mới đã lưu`,
            deleteError.stack,
          );
          if (newlySavedUrlHashes.length > 0) {
            try {
              await this.newsArticleService.deleteArticlesByUrlHashes(
                newlySavedUrlHashes,
              );
              this.logger.log(
                `Rollback thành công: đã xóa ${newlySavedUrlHashes.length} bài khỏi news_articles`,
              );
            } catch (rollbackError: any) {
              // Rollback thất bại → log rõ để operator xử lý thủ công
              this.logger.error(
                `Rollback THẤT BẠI — dữ liệu không nhất quán. Nguyên nhân gốc (deleteRaw): ${deleteError.message}. ${newlySavedUrlHashes.length} bài tồn tại ở cả 2 collection. urlHashes cần xóa thủ công: [${newlySavedUrlHashes.join(', ')}]`,
                rollbackError.stack,
              );
            }
          }
          throw deleteError;
        }
      }
    }
    return { message: 'Raw articles moved successfully' };
  }

  @ApiOperation({
    summary: 'Trigger manual crawl',
    description: 'Trigger manual crawl',
  })
  @Post('crawl')
  async triggerManualCrawl(@Body() body: TriggerManualCrawlDto) {
    const { days, startDate, endDate } = body;
    this.logger.log(
      `Manual crawl called. Days: ${days || 'none'}, Start: ${startDate || 'none'}, End: ${endDate || 'none'}`,
    );
    const { filePath, stats } = await this.customCrawlerService.crawlData(
      days,
      startDate,
      endDate,
    );

    const rawData = JSON.parse(fs.readFileSync(filePath, 'utf8'));

    return {
      message: 'Crawl completed successfully',
      filePath,
      stats,
      data: rawData,
    };
  }

  @ApiOperation({
    summary: 'Trigger manual analyze',
    description: 'Trigger manual analyze',
  })
  @Post('analyze')
  async triggerManualAnalyze(@Body() body: TriggerManualAnalyzeDto) {
    const { filePath } = body;
    if (!filePath) {
      return { message: 'filePath is required', data: [] };
    }
    try {
      this.logger.log('Manual analyze called');
      const top5Articles = await this.aiFilterService.filterAndRank(filePath);

      return {
        message: 'AI filtering completed successfully',
        data: top5Articles,
      };
    } finally {
      // Dọn file tạm sau mỗi lần analyze, bất kể thành công hay lỗi
      void import('fs').then((fs) => {
        fs.promises
          .unlink(filePath)
          .catch((err) =>
            this.logger.error(
              `Failed to delete temp file ${filePath}`,
              err.stack,
            ),
          );
      });
    }
  }

  @ApiOperation({
    summary: 'Analyze raw articles',
    description: 'Analyze raw articles',
  })
  @Post('analyze-raw')
  async analyzeRawArticles(@Body() body: AnalyzeRawArticlesDto) {
    const { articles } = body;

    this.logger.log('Analyze Raw Articles called');
    if (!articles || articles.length === 0) {
      return { message: 'No articles to analyze', data: [] };
    }
    // Tập urlHash FE gửi lên — phạm vi an toàn để xóa (chỉ trong trang hiện tại, không phải toàn collection)
    const submittedHashes = articles
      .map((a: any) => a.urlHash)
      .filter(Boolean) as string[];

    const filteredArticles =
      await this.aiFilterService.filterRawArticles(articles);

    // Chỉ xóa bài nằm trong tập FE gửi lên mà AI không giữ lại.
    // Nếu AI trả về rỗng → toàn bộ bài trong trang bị xóa (đúng hành vi mong muốn).
    // Những bài ngoài trang này KHÔNG bị ảnh hưởng.
    const keepHashes: string[] = filteredArticles
      ? filteredArticles.map((a: any) => a.urlHash)
      : [];
    await this.customCrawlerService.deleteRawArticlesInSetNotIn(
      submittedHashes,
      keepHashes,
    );

    return {
      message: 'Raw articles filtered successfully',
      data: filteredArticles,
    };
  }

  @ApiOperation({ summary: 'Save articles', description: 'Save articles' })
  @Post('articles/save')
  async saveArticles(@Body() body: SaveArticlesDto) {
    const { articles } = body;

    if (!Array.isArray(articles) || articles.length === 0) {
      return { message: 'No articles to save' };
    }
    const result = await this.newsArticleService.saveArticles(articles);
    return {
      message: 'Articles processed',
      ...result,
    };
  }

  @ApiOperation({
    summary: 'Get articles',
    description:
      'Danh sách bài đã lưu có phân trang. Response: { data, meta: { total, page, limit, totalPages } }',
  })
  @Get('articles')
  async getArticles(
    @Query() query: GetArticlesQueryDto,
  ): Promise<PaginatedResponseDto<NewsArticle>> {
    // Chuẩn hóa page/limit trước khi xuống service để meta trả về luôn khớp
    // với tham số thực sự dùng cho skip/limit.
    const { page, limit } = normalizePagination(query.page, query.limit);

    const { data, total } = await this.newsArticleService.getSavedArticles(
      query.date,
      page,
      limit,
    );

    return {
      data,
      meta: buildPaginationMeta(total, page, limit),
    };
  }

  @ApiOperation({
    summary: 'Get market analysis history',
    description: 'Get market analysis history',
  })
  @Get('articles/market-analysis-history')
  async getMarketAnalysisHistory() {
    const history = await this.newsArticleService.getMarketAnalysisHistory();
    return {
      message: 'Market analysis history fetched successfully',
      data: history,
    };
  }

  @ApiOperation({
    summary: 'Get market analysis history by id',
    description: 'Get market analysis history by id',
  })
  @ApiParam({ name: 'id', required: true })
  @Get('articles/market-analysis-history/:id')
  async getMarketAnalysisHistoryById(@Param('id') id: string) {
    const record =
      await this.newsArticleService.getMarketAnalysisHistoryById(id);
    return {
      message: 'Market analysis history record fetched successfully',
      data: record,
    };
  }

  @ApiOperation({
    summary: 'Get article by id',
    description: 'Get article by id',
  })
  @ApiParam({ name: 'id', required: true })
  @Get('articles/:id')
  async getArticleById(@Param('id') id: string) {
    const article = await this.newsArticleService.getArticleById(id);
    return {
      message: 'Article fetched successfully',
      data: article,
    };
  }

  @ApiOperation({
    summary: 'Analyze market trends',
    description: 'Analyze market trends',
  })
  @Post('articles/analyze-market-trends')
  async analyzeMarketTrends(@Body() body: BulkIdsDto) {
    const { ids } = body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return { message: 'No articles to analyze' };
    }

    const result = await this.newsArticleService.analyzeMarketTrendsByAI(ids);
    return {
      message: 'Market trends analysis completed',
      data: result,
    };
  }

  @ApiOperation({
    summary: 'Analyze market bulk',
    description: 'Analyze market bulk',
  })
  @Post('articles/market-analysis-bulk')
  async analyzeMarketBulk(@Body() body: BulkIdsDto) {
    const { ids } = body;

    if (!Array.isArray(ids) || ids.length === 0) {
      return { message: 'No articles to analyze' };
    }

    const result = await this.newsArticleService.analyzeMarketBulk(ids);
    return {
      message: 'Bulk market analysis completed',
      data: result,
    };
  }

  @ApiOperation({
    summary: 'Delete bulk articles',
    description: 'Delete bulk articles',
  })
  @Post('articles/delete-bulk')
  async deleteBulkArticles(@Body() body: BulkIdsDto) {
    const { ids } = body;

    if (!Array.isArray(ids) || ids.length === 0) {
      return { message: 'No articles to delete' };
    }
    const result = await this.newsArticleService.deleteBulkArticles(ids);
    // Ghi audit log sau khi xóa bulk thành công (fire-and-forget)
    void this.auditLogService.log(
      AuditAction.BULK_DELETE,
      'news_articles',
      ids,
      'system',
      { count: ids.length },
    );
    return {
      message: 'Articles deleted successfully',
      data: result,
    };
  }

  @ApiOperation({
    summary: 'Publish bulk articles',
    description: 'Publish bulk articles',
  })
  @ApiHeader({
    name: 'x-idempotency-key',
    required: false,
    description: 'Chống đăng đúp khi double-click/retry',
  })
  @Post('articles/publish-bulk')
  async publishBulkArticles(
    @Body() body: BulkIdsDto,
    @Headers('x-idempotency-key') idempotencyKey?: string,
  ) {
    const { ids } = body;

    if (!Array.isArray(ids) || ids.length === 0) {
      return { message: 'No articles to publish' };
    }

    const iKey = idempotencyKey ? `bulk:${idempotencyKey}` : undefined;
    if (iKey) {
      const cached = this.idempotencyService.get(iKey);
      if (cached) return cached;
      if (this.idempotencyService.isInFlight(iKey)) {
        throw new ConflictException(
          'Request đang được xử lý, vui lòng thử lại sau',
        );
      }
      this.idempotencyService.markInFlight(iKey);
    }

    try {
      const results = await Promise.all(
        ids.map((id) => this.newsArticleService.publishToWordPress(id)),
      );

      // Ghi audit log sau khi publish bulk thành công (fire-and-forget)
      void this.auditLogService.log(
        AuditAction.BULK_PUBLISH,
        'news_articles',
        ids,
        'system',
        { count: ids.length },
      );

      const response = {
        message: 'Articles published to WordPress successfully',
        data: results,
      };

      if (iKey) this.idempotencyService.set(iKey, response);
      return response;
    } finally {
      if (iKey) this.idempotencyService.clearInFlight(iKey);
    }
  }

  @ApiOperation({ summary: 'Publish article', description: 'Publish article' })
  @ApiHeader({
    name: 'x-idempotency-key',
    required: false,
    description: 'Chống đăng đúp khi double-click/retry',
  })
  @ApiParam({ name: 'id', required: true })
  @Post('articles/:id/publish')
  async publishArticle(
    @Param('id') id: string,
    @Headers('x-idempotency-key') idempotencyKey?: string,
  ) {
    const iKey = idempotencyKey ? `single:${idempotencyKey}` : undefined;
    if (iKey) {
      const cached = this.idempotencyService.get(iKey);
      if (cached) return cached;
      if (this.idempotencyService.isInFlight(iKey)) {
        throw new ConflictException(
          'Request đang được xử lý, vui lòng thử lại sau',
        );
      }
      this.idempotencyService.markInFlight(iKey);
    }

    try {
      const result = await this.newsArticleService.publishToWordPress(id);
      // Ghi audit log sau khi publish thành công (fire-and-forget)
      void this.auditLogService.log(
        AuditAction.PUBLISH,
        'news_articles',
        [id],
        'system',
        { wpPostId: result.wpPostId },
      );
      const response = {
        message: 'Article published to WordPress successfully',
        data: result,
      };
      if (iKey) this.idempotencyService.set(iKey, response);
      return response;
    } finally {
      if (iKey) this.idempotencyService.clearInFlight(iKey);
    }
  }

  @ApiOperation({ summary: 'Clean article', description: 'Clean article' })
  @ApiParam({ name: 'id', required: true })
  @Post('articles/:id/clean')
  async cleanArticle(@Param('id') id: string) {
    const result = await this.newsArticleService.cleanArticle(id);
    return {
      message: 'Article cleaned successfully',
      data: result,
    };
  }
}
