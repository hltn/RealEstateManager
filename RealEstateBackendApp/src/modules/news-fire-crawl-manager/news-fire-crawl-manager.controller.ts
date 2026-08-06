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
  TriggerMarketAnalysisWorkflowDto,
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
import { AnalyzeJobService } from './services/analyze-job.service';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../common/enums/user-role.enum';
import {
  WorkflowJobState,
  WorkflowStepState,
  STEP_LABELS,
} from './types/workflow-job-state';

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
    private readonly analyzeJobService: AnalyzeJobService,
  ) {}

  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Get prompts', description: 'Get prompts' })
  @Get('prompts')
  getPrompts() {
    return {
      success: true,
      data: this.aiPromptConfigService.getPrompts(),
    };
  }

  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Update prompts', description: 'Update prompts' })
  @Put('prompts')
  async updatePrompts(@Body() newPrompts: AiPromptDto[]) {
    await this.aiPromptConfigService.updatePrompts(newPrompts);
    return { success: true, message: 'Prompts updated successfully' };
  }

  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Get cron config', description: 'Get cron config' })
  @Get('cron')
  getCronConfig() {
    return this.cronjobService.getConfig();
  }

  @Roles(UserRole.ADMIN)
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
    summary: 'Trigger manual crawl (async)',
    description:
      'Trả về jobId ngay lập tức, việc crawl + AI extract (có thể mất vài phút) chạy nền. ' +
      'Dùng GET /crawl/:jobId để poll trạng thái khi hoàn tất.',
  })
  @Post('crawl')
  triggerManualCrawl(@Body() body: TriggerManualCrawlDto) {
    const { days, startDate, endDate } = body;
    this.logger.log(
      `Manual crawl called. Days: ${days || 'none'}, Start: ${startDate || 'none'}, End: ${endDate || 'none'}`,
    );

    // Khóa global dùng chung với bulk crawl — chống 2 job thu thập/phân tích chạy
    // song song (double-click FE, 2 tab/client): tránh tốn API cost gấp đôi và
    // upsert articles đè nhau.
    const LOCK_KEY = 'crawl:global';
    if (this.idempotencyService.isInFlight(LOCK_KEY)) {
      throw new ConflictException(
        'Đang có tác vụ thu thập/phân tích đang chạy, vui lòng đợi hoàn tất',
      );
    }
    this.idempotencyService.markInFlight(LOCK_KEY);

    const jobId = this.analyzeJobService.createJob();

    // Audit: admin trigger manual crawl — fire-and-forget, chỉ audit khi đã qua lock
    // (không audit khi Conflict). Giống pattern market-analysis-bulk.
    void this.auditLogService.log(
      AuditAction.MANUAL_CRAWL,
      'raw_articles',
      [],
      'system',
      { jobId, days, startDate, endDate },
    );

    // Fire-and-forget: không await trong request handler để HTTP response trả về ngay,
    // tránh phụ thuộc thời gian crawl thực tế (gây Axios timeout phía FE) — giống
    // pattern analyze-raw / analyze-market-trends. `.catch` safety net chống
    // unhandled rejection ngoài dự kiến.
    void this.runManualCrawlJob(jobId, days, startDate, endDate, LOCK_KEY).catch(
      (err: any) =>
        this.logger.error(
          `Manual crawl fire-and-forget rejected: ${err?.message}`,
          err?.stack,
        ),
    );

    return { message: 'Crawl started', jobId };
  }

  /**
   * Thực thi job crawl thủ công trong nền. Lifecycle (markDone/markError/
   * clearInFlight) delegate cho runLockedJob chung (DRY) — giống runAnalyzeMarketTrendsJob.
   */
  private runManualCrawlJob(
    jobId: string,
    days: number | undefined,
    startDate: string | undefined,
    endDate: string | undefined,
    lockKey: string,
  ): Promise<void> {
    return this.runLockedJob(jobId, lockKey, 'Manual crawl job', async () => {
      const { filePath, stats } = await this.customCrawlerService.crawlData(
        days,
        startDate,
        endDate,
      );
      const rawData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      return {
        stats,
        count: Array.isArray(rawData) ? rawData.length : 0,
        filePath,
      };
    });
  }

  @ApiOperation({
    summary: 'Get manual crawl job status',
    description: 'Poll trạng thái job crawl chạy nền theo jobId.',
  })
  @ApiParam({
    name: 'jobId',
    description: 'ID job trả về từ POST /crawl',
  })
  @Get('crawl/:jobId')
  getManualCrawlJob(@Param('jobId') jobId: string) {
    const job = this.analyzeJobService.getJob(jobId);
    if (!job) {
      return { status: 'not_found' };
    }
    return job;
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
      // Dọn file tạm sau mỗi lần analyze, bất kể thành công hay lỗi.
      // Dùng static fs (đã import đầu file) thay vì dynamic import('fs')
      // để tránh crash Jest VM (ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING_FLAG).
      fs.promises
        .unlink(filePath)
        .catch((err) =>
          this.logger.error(
            `Failed to delete temp file ${filePath}`,
            err.stack,
          ),
        );
    }
  }

  @ApiOperation({
    summary: 'Analyze raw articles (async)',
    description:
      'Trả về jobId ngay lập tức, việc gọi AI + xóa bài chạy nền. ' +
      'Dùng GET /analyze-raw/:jobId để lấy kết quả khi hoàn tất.',
  })
  @Post('analyze-raw')
  analyzeRawArticles(@Body() body: AnalyzeRawArticlesDto) {
    const { articles } = body;

    this.logger.log('Analyze Raw Articles called');
    if (!articles || articles.length === 0) {
      return { jobId: null, message: 'No articles to analyze' };
    }

    const jobId = this.analyzeJobService.createJob();

    // Fire-and-forget: không await trong request handler để HTTP response
    // trả về ngay, tránh phụ thuộc vào thời gian xử lý thực tế của AI upstream.
    // `.catch` là safety net cuối cùng — runJob đã tự catch mọi lỗi lifecycle,
    // nhưng giữ lại để chống unhandled rejection nếu có lỗi ngoài dự kiến.
    void this.runAnalyzeRawArticlesJob(jobId, articles).catch((err: any) =>
      this.logger.error(
        `Analyze raw articles fire-and-forget rejected: ${err?.message}`,
        err?.stack,
      ),
    );

    return { jobId, message: 'Đã nhận yêu cầu, đang xử lý trong nền' };
  }

  /**
   * Thực thi job phân tích AI + xóa bài trong nền. Chỉ chứa phần logic riêng
   * (filter + delete theo urlHash); lifecycle (markDone/markError) được delegate
   * cho runJob chung để DRY và chống unhandled rejection (QA: DRY + robustness).
   */
  private runAnalyzeRawArticlesJob(
    jobId: string,
    articles: Record<string, any>[],
  ): Promise<void> {
    return this.runJob(jobId, 'Analyze job', async () => {
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

      return filteredArticles;
    });
  }

  @ApiOperation({
    summary: 'Analyze all raw articles (async)',
    description:
      'Tự lấy toàn bộ raw articles từ DB rồi chạy pipeline AI. ' +
      'Trả về jobId ngay lập tức — dùng GET /analyze-raw/:jobId để poll kết quả.',
  })
  @Post('analyze-raw-all')
  async analyzeAllRawArticles() {
    // Khóa global để chống 2 job chạy song song (double-click FE, 2 client)
    const LOCK_KEY = 'analyze-raw-all:global';
    if (this.idempotencyService.isInFlight(LOCK_KEY)) {
      throw new ConflictException(
        'Đang có job phân tích toàn bộ đang chạy, vui lòng đợi hoàn tất',
      );
    }
    this.idempotencyService.markInFlight(LOCK_KEY);

    this.logger.log('Analyze All Raw Articles called');
    const jobId = this.analyzeJobService.createJob();
    // Fire-and-forget: không await để HTTP response trả về ngay lập tức.
    // `.catch` safety net chống unhandled rejection ngoài dự kiến.
    void this.runAnalyzeAllRawArticlesJob(jobId, LOCK_KEY).catch((err: any) =>
      this.logger.error(
        `Analyze-all fire-and-forget rejected: ${err?.message}`,
        err?.stack,
      ),
    );
    return {
      jobId,
      message: 'Đã nhận yêu cầu phân tích toàn bộ, đang xử lý trong nền',
    };
  }

  /**
   * Lấy toàn bộ raw articles từ DB rồi chạy pipeline AI phân tích + xóa bài không đạt.
   * Khác runAnalyzeRawArticlesJob: tự query DB thay vì nhận danh sách từ FE,
   * nên phạm vi xóa là toàn bộ collection thay vì chỉ trang hiện tại.
   * Lifecycle (markDone/markError/clearInFlight) delegate cho runLockedJob chung (DRY).
   */
  private runAnalyzeAllRawArticlesJob(
    jobId: string,
    lockKey: string,
  ): Promise<void> {
    return this.runLockedJob(jobId, lockKey, 'Analyze-all job', async () => {
      // Lấy toàn bộ articles từ DB (không phân trang), chỉ lấy field cần thiết
      const allArticles =
        await this.customCrawlerService.getAllRawArticles();

      if (!allArticles || allArticles.length === 0) {
        // markDone([]) được runLockedJob gọi khi work trả về [].
        return [];
      }

      // submittedHashes = phạm vi toàn bộ collection → AI có thể xóa bất kỳ bài nào
      const submittedHashes = allArticles
        .map((a) => a.urlHash)
        .filter(Boolean) as string[];

      const filteredArticles =
        await this.aiFilterService.filterRawArticles(allArticles);

      // Xóa bài nằm trong submittedHashes mà AI không giữ lại
      const keepHashes: string[] = filteredArticles
        ? filteredArticles.map((a: any) => a.urlHash)
        : [];
      await this.customCrawlerService.deleteRawArticlesInSetNotIn(
        submittedHashes,
        keepHashes,
      );

      return filteredArticles;
    });
  }

  @ApiOperation({
    summary: 'Get analyze-raw job status',
    description: 'Poll trạng thái job phân tích AI chạy nền theo jobId.',
  })
  @ApiParam({ name: 'jobId', description: 'ID job trả về từ POST /analyze-raw' })
  @Get('analyze-raw/:jobId')
  getAnalyzeRawJob(@Param('jobId') jobId: string) {
    const job = this.analyzeJobService.getJob(jobId);
    if (!job) {
      return { status: 'not_found' };
    }
    return job;
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
    summary: 'Analyze market trends (async)',
    description:
      'Trả về jobId ngay lập tức, việc gọi AI phân tích thị trường (có thể mất tới 300s) ' +
      'chạy nền. Dùng GET /articles/analyze-market-trends/:jobId để lấy kết quả khi hoàn tất.',
  })
  @Post('articles/analyze-market-trends')
  analyzeMarketTrends(@Body() body: BulkIdsDto) {
    const { ids } = body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return { message: 'No articles to analyze' };
    }

    // Khóa global để chống 2 job phân tích thị trường chạy song song
    // (double-click FE, 2 tab/client) — tránh tốn API cost gấp đôi và job cũ mất track.
    const LOCK_KEY = 'analyze-market-trends:global';
    if (this.idempotencyService.isInFlight(LOCK_KEY)) {
      throw new ConflictException(
        'Đang có job phân tích thị trường khác đang chạy, vui lòng đợi hoàn tất',
      );
    }
    this.idempotencyService.markInFlight(LOCK_KEY);

    const jobId = this.analyzeJobService.createJob();

    // Fire-and-forget: không await trong request handler để HTTP response trả về ngay,
    // tránh phụ thuộc vào thời gian xử lý AI upstream (có thể tới 300s) — giống pattern analyze-raw.
    // `.catch` safety net chống unhandled rejection ngoài dự kiến.
    void this.runAnalyzeMarketTrendsJob(jobId, ids, LOCK_KEY).catch((err: any) =>
      this.logger.error(
        `Analyze market trends fire-and-forget rejected: ${err?.message}`,
        err?.stack,
      ),
    );

    return { message: 'Market trends analysis started', jobId };
  }

  /**
   * Thực thi job phân tích thị trường bằng AI trong nền. Lifecycle (markDone/
   * markError/clearInFlight) delegate cho runLockedJob chung (DRY) — không còn
   * try/catch/finally trùng lặp với runAnalyzeMarketBulkJob.
   */
  private runAnalyzeMarketTrendsJob(
    jobId: string,
    ids: string[],
    lockKey: string,
  ): Promise<void> {
    return this.runLockedJob(
      jobId,
      lockKey,
      'Analyze market trends job',
      () => this.newsArticleService.analyzeMarketTrendsByAI(ids),
    );
  }

  @ApiOperation({
    summary: 'Get analyze-market-trends job status',
    description: 'Poll trạng thái job phân tích thị trường AI chạy nền theo jobId.',
  })
  @ApiParam({
    name: 'jobId',
    description: 'ID job trả về từ POST /articles/analyze-market-trends',
  })
  @Get('articles/analyze-market-trends/:jobId')
  getAnalyzeMarketTrendsJob(@Param('jobId') jobId: string) {
    const job = this.analyzeJobService.getJob(jobId);
    if (!job) {
      return { status: 'not_found' };
    }
    return job;
  }

  @ApiOperation({
    summary: 'Analyze market bulk (async)',
    description:
      'Trả về jobId ngay lập tức, việc crawl/ phân tích thị trường bulk chạy nền. ' +
      'Dùng GET /articles/market-analysis-bulk/:jobId để poll kết quả khi hoàn tất.',
  })
  @Post('articles/market-analysis-bulk')
  analyzeMarketBulk(@Body() body: BulkIdsDto) {
    const { ids } = body;

    if (!Array.isArray(ids) || ids.length === 0) {
      return { message: 'No articles to analyze' };
    }

    // Khóa global dùng chung với manual crawl — chống 2 job thu thập/phân tích
    // chạy song song (double-click FE, 2 tab/client): tránh tốn API cost gấp đôi
    // và job cũ mất track, giống pattern analyze-market-trends.
    const LOCK_KEY = 'crawl:global';
    if (this.idempotencyService.isInFlight(LOCK_KEY)) {
      throw new ConflictException(
        'Đang có tác vụ thu thập/phân tích đang chạy, vui lòng đợi hoàn tất',
      );
    }
    this.idempotencyService.markInFlight(LOCK_KEY);

    const jobId = this.analyzeJobService.createJob();

    // Audit: admin trigger phân tích thị trường bulk — ghi lại ai/ids/jobId ngay
    // khi trigger thành công (fire-and-forget). Job chạy nền có thể fail, nhưng
    // bản thân trigger là sự kiện audit-worthy theo pattern các endpoint admin
    // khác (delete/publish). Chỉ audit khi đã qua lock (không audit khi Conflict).
    void this.auditLogService.log(
      AuditAction.MARKET_ANALYSIS_BULK,
      'news_articles',
      ids,
      'system',
      { jobId, count: ids.length },
    );

    // Fire-and-forget: không await trong request handler để HTTP response trả về ngay,
    // tránh phụ thuộc vào thời gian crawl thực tế (gây Axios 30s timeout phía FE) —
    // giống pattern analyze-raw / analyze-market-trends.
    // `.catch` safety net chống unhandled rejection ngoài dự kiến.
    void this.runAnalyzeMarketBulkJob(jobId, ids, LOCK_KEY).catch((err: any) =>
      this.logger.error(
        `Analyze market bulk fire-and-forget rejected: ${err?.message}`,
        err?.stack,
      ),
    );

    return { jobId, message: 'Bulk market analysis started' };
  }

  /**
   * Thực thi job phân tích thị trường bulk trong nền. Lifecycle delegate cho
   * runLockedJob chung — không còn try/catch/finally trùng lặp với
   * runAnalyzeMarketTrendsJob (QA: DRY).
   */
  private runAnalyzeMarketBulkJob(
    jobId: string,
    ids: string[],
    lockKey: string,
  ): Promise<void> {
    return this.runLockedJob(
      jobId,
      lockKey,
      'Analyze market bulk job',
      () => this.newsArticleService.analyzeMarketBulk(ids),
    );
  }

  /**
   * Chạy background job CÓ global lock (chống double-submit). Lifecycle an toàn:
   * markDone/markError/clearInFlight được bọc try/catch riêng để không bao giờ sinh
   * unhandled rejection từ chính các method lifecycle (QA: robustness).
   * DRY: dùng chung cho mọi job fire-and-forget có lock (market-trends, bulk, all).
   */
  private runLockedJob(
    jobId: string,
    lockKey: string,
    jobLabel: string,
    work: () => Promise<unknown>,
  ): Promise<void> {
    return this.runJob(jobId, jobLabel, work).finally(() => {
      // Giải phóng lock bất kể thành công hay lỗi, tránh block mọi request tiếp theo.
      // Bọc try/catch để clearInFlight ném lỗi cũng không sinh unhandled rejection.
      try {
        this.idempotencyService.clearInFlight(lockKey);
      } catch (err: any) {
        this.logger.error(
          `${jobLabel} ${jobId}: clearInFlight threw — lock có thể stuck`,
          err?.stack,
        );
      }
    });
  }

  /**
   * Chạy background job KHÔNG có lock. Exception-safe toàn vẹn: mọi lỗi từ work
   * VÀ từ lifecycle (markDone/markError) đều được bắt + log, không rethrow →
   * fire-and-forget promise không bao giờ reject (QA: robustness).
   */
  private async runJob(
    jobId: string,
    jobLabel: string,
    work: () => Promise<unknown>,
  ): Promise<void> {
    try {
      const result = await work();
      try {
        this.analyzeJobService.markDone(jobId, result);
      } catch (err: any) {
        this.logger.error(`${jobLabel} ${jobId}: markDone threw`, err?.stack);
      }
    } catch (error: any) {
      this.logger.error(
        `${jobLabel} ${jobId} failed: ${error.message}`,
        error.stack,
      );
      try {
        this.analyzeJobService.markError(
          jobId,
          error.message || 'Lỗi không xác định',
        );
      } catch (err: any) {
        this.logger.error(`${jobLabel} ${jobId}: markError threw`, err?.stack);
      }
    }
  }

  @ApiOperation({
    summary: 'Get market-analysis-bulk job status',
    description: 'Poll trạng thái job phân tích thị trường bulk chạy nền theo jobId.',
  })
  @ApiParam({
    name: 'jobId',
    description: 'ID job trả về từ POST /articles/market-analysis-bulk',
  })
  @Get('articles/market-analysis-bulk/:jobId')
  getAnalyzeMarketBulkJob(@Param('jobId') jobId: string) {
    const job = this.analyzeJobService.getJob(jobId);
    if (!job) {
      return { status: 'not_found' };
    }
    return job;
  }

  /**
   * Giờ hiện tại theo UTC+7 (Việt Nam), định dạng YYYY-MM-DD.
   * Dùng làm giá trị mặc định khi FE không truyền `date` cho workflow.
   */
  private getTodayVNString(): string {
    const now = new Date();
    const vnTime = new Date(now.getTime() + 7 * 60 * 60 * 1000);
    return vnTime.toISOString().split('T')[0];
  }

  @ApiOperation({
    summary: 'Market analysis workflow (async)',
    description:
      'Chạy pipeline 5 bước tự động: crawl → filter → move → crawl content → AI analysis. ' +
      'Trả về jobId ngay — dùng GET /market-analysis-workflow/:jobId để poll.',
  })
  @Post('market-analysis-workflow')
  triggerMarketAnalysisWorkflow(
    @Body() body: TriggerMarketAnalysisWorkflowDto,
  ) {
    const date = body.date || this.getTodayVNString();
    this.logger.log(`Market analysis workflow triggered for date: ${date}`);

    const LOCK_KEY = 'workflow:market-analysis';
    if (this.idempotencyService.isInFlight(LOCK_KEY)) {
      throw new ConflictException(
        'Đang có phân tích thị trường đang chạy, vui lòng đợi hoàn tất',
      );
    }
    this.idempotencyService.markInFlight(LOCK_KEY);

    const jobId = this.analyzeJobService.createJob();

    // Set initial WorkflowJobState vào job result, status='pending' (đang chạy).
    const initialState: WorkflowJobState = {
      currentStep: 0,
      steps: [1, 2, 3, 4, 5].map((step) => ({
        step,
        label: STEP_LABELS[step],
        status: 'pending' as const,
      })),
      date,
    };
    this.analyzeJobService.updateJob(jobId, {
      status: 'pending',
      result: initialState,
    });

    void this.runWorkflow(jobId, date, LOCK_KEY).catch((err: any) =>
      this.logger.error(
        `Workflow fire-and-forget rejected: ${err?.message}`,
        err?.stack,
      ),
    );

    return { message: 'Phân tích thị trường đã bắt đầu', jobId };
  }

  @ApiOperation({
    summary: 'Get market analysis workflow job status',
    description: 'Poll trạng thái pipeline 5 bước theo jobId.',
  })
  @ApiParam({
    name: 'jobId',
    description: 'ID job trả về từ POST /market-analysis-workflow',
  })
  @Get('market-analysis-workflow/:jobId')
  getMarketAnalysisWorkflowJob(@Param('jobId') jobId: string) {
    const job = this.analyzeJobService.getJob(jobId);
    if (!job) {
      return { status: 'not_found' as const };
    }
    // Flatten: currentStep/steps/finalResult nằm lồng trong job.result
    // (WorkflowJobState) — spec mục 2 yêu cầu chúng ở TOP-LEVEL response,
    // ngang hàng với status/error. `finalResult` (nếu có) đổi tên field
    // ra `result` đúng shape spec mô tả cho response khi status='done'.
    const state = job.result as WorkflowJobState | undefined;
    return {
      status: job.status,
      currentStep: state?.currentStep,
      steps: state?.steps,
      date: state?.date,
      ...(state?.finalResult ? { result: state.finalResult } : {}),
      ...(job.error ? { error: job.error } : {}),
    };
  }

  /**
   * Orchestrator: chạy tuần tự 5 bước pipeline market analysis.
   * Mỗi bước: cập nhật job state → gọi service → await → cập nhật result.
   * Lỗi bất kỳ bước nào → dừng pipeline, giữ nguyên steps đã cập nhật tới
   * bước lỗi (KHÔNG dùng markError trực tiếp — nó xoá field result/steps,
   * xem AnalyzeJobService.markError). Lock quản lý thủ công (không qua
   * runLockedJob) vì cần cập nhật progress từng bước — đánh đổi có chủ đích,
   * xem design spec mục 3.5.4.
   */
  private async runWorkflow(
    jobId: string,
    date: string,
    lockKey: string,
  ): Promise<void> {
    const updateStep = (step: number, patch: Partial<WorkflowStepState>) => {
      const job = this.analyzeJobService.getJob(jobId);
      if (!job) return;
      const state = job.result as WorkflowJobState;
      if (!state?.steps) return;
      const idx = step - 1;
      if (idx >= 0 && idx < state.steps.length) {
        state.steps[idx] = { ...state.steps[idx], ...patch };
        state.currentStep = step;
        this.analyzeJobService.updateJob(jobId, { result: state });
      }
    };

    try {
      // ── Step 1: Thu thập tin tức ──
      updateStep(1, { status: 'running' });
      const crawlResult = await this.customCrawlerService.crawlData(
        undefined,
        date,
        date,
      );
      updateStep(1, { status: 'done', result: crawlResult });

      // ── Step 2: Phân tích & lọc ──
      updateStep(2, { status: 'running' });
      const allArticles =
        await this.customCrawlerService.getRawArticlesByDate(date);
      if (!allArticles || allArticles.length === 0) {
        const emptyResult: WorkflowJobState = {
          currentStep: 5,
          steps: [1, 2, 3, 4, 5].map((s) => ({
            step: s,
            label: STEP_LABELS[s],
            status: 'done',
            result:
              s === 1
                ? crawlResult
                : s === 2
                  ? { filteredCount: 0 }
                  : { skipped: true },
          })),
          date,
          finalResult: {
            markdownContent: '',
            newsArticleCount: 0,
            stats: {
              totalArticles: crawlResult?.stats?.totalArticles ?? 0,
              filtered: 0,
              crawledContent: 0,
              failedCrawl: 0,
            },
          },
        };
        this.analyzeJobService.markDone(jobId, emptyResult);
        return;
      }

      // AI filter chỉ trả về { urlHash, title } (xem RAW_ARTICLES_PROMPT) —
      // KHÔNG có _id. Phải map ngược qua urlHash để lấy lại RawArticle đầy đủ
      // (có _id) từ allArticles, đúng field `filteredKeepArticles: RawArticle[]`
      // mô tả ở design spec mục Q1 (KHÔNG dùng filteredArticles thô cho rawIds).
      const filteredArticles =
        await this.aiFilterService.filterRawArticles(allArticles);
      const keepHashes: string[] =
        filteredArticles?.map((a: any) => a.urlHash).filter(Boolean) ?? [];
      const submittedHashes = allArticles
        .map((a) => a.urlHash)
        .filter(Boolean);
      const filteredKeepArticles = allArticles.filter(
        (a: any) => a.urlHash && keepHashes.includes(a.urlHash),
      );
      await this.customCrawlerService.deleteRawArticlesInSetNotIn(
        submittedHashes,
        keepHashes,
      );
      updateStep(2, {
        status: 'done',
        result: {
          filteredCount: filteredKeepArticles.length,
          deletedCount: submittedHashes.length - keepHashes.length,
        },
      });

      // ── Step 3: Chuyển sang bài viết ──
      updateStep(3, { status: 'running' });
      if (filteredKeepArticles.length === 0) {
        const partialState: WorkflowJobState = {
          currentStep: 5,
          steps: [
            {
              step: 1,
              label: STEP_LABELS[1],
              status: 'done',
              result: crawlResult,
            },
            {
              step: 2,
              label: STEP_LABELS[2],
              status: 'done',
              result: { filteredCount: 0 },
            },
            ...[3, 4, 5].map((s) => ({
              step: s,
              label: STEP_LABELS[s],
              status: 'done' as const,
              result: s === 3 ? { savedCount: 0 } : { skipped: true },
            })),
          ],
          date,
          finalResult: {
            markdownContent: '',
            newsArticleCount: 0,
            stats: {
              totalArticles: crawlResult?.stats?.totalArticles ?? 0,
              filtered: 0,
              crawledContent: 0,
              failedCrawl: 0,
            },
          },
        };
        this.analyzeJobService.markDone(jobId, partialState);
        return;
      }

      const rawIds = filteredKeepArticles
        .map((a: any) => a._id?.toString())
        .filter(Boolean);
      const rawArticles =
        await this.customCrawlerService.getRawArticlesByIds(rawIds);
      const saveResult =
        await this.newsArticleService.saveArticles(rawArticles);

      // Xóa raw articles đã move thành công
      const typedRawArticles = rawArticles as Array<{
        _id: { toString: () => string };
        urlHash?: string | null;
      }>;
      const successfulIds = typedRawArticles
        .filter(
          (raw) =>
            raw.urlHash &&
            saveResult.processedUrlHashes.includes(raw.urlHash),
        )
        .map((raw) => raw._id.toString());
      if (successfulIds.length > 0) {
        await this.customCrawlerService.deleteRawArticlesBulk(successfulIds);
      }

      // Map urlHashes → news_article _id
      const newsArticleIds =
        await this.newsArticleService.getArticleIdsByUrlHashes(
          saveResult.processedUrlHashes,
        );
      updateStep(3, {
        status: 'done',
        result: {
          newsArticleIds,
          savedCount: saveResult.savedCount,
          duplicates: saveResult.duplicates,
        },
      });

      if (newsArticleIds.length === 0) {
        const partialState: WorkflowJobState = {
          currentStep: 5,
          steps: [
            {
              step: 1,
              label: STEP_LABELS[1],
              status: 'done',
              result: crawlResult,
            },
            {
              step: 2,
              label: STEP_LABELS[2],
              status: 'done',
              result: { filteredCount: filteredKeepArticles.length },
            },
            {
              step: 3,
              label: STEP_LABELS[3],
              status: 'done',
              result: { savedCount: 0 },
            },
            {
              step: 4,
              label: STEP_LABELS[4],
              status: 'done',
              result: { skipped: true },
            },
            {
              step: 5,
              label: STEP_LABELS[5],
              status: 'done',
              result: { skipped: true },
            },
          ],
          date,
          finalResult: {
            markdownContent: '',
            newsArticleCount: 0,
            stats: {
              totalArticles: crawlResult?.stats?.totalArticles ?? 0,
              filtered: filteredKeepArticles.length,
              crawledContent: 0,
              failedCrawl: 0,
            },
          },
        };
        this.analyzeJobService.markDone(jobId, partialState);
        return;
      }

      // ── Step 4: Crawl nội dung chi tiết ──
      updateStep(4, { status: 'running' });
      const bulkResult =
        await this.newsArticleService.analyzeMarketBulk(newsArticleIds);
      updateStep(4, {
        status: 'done',
        result: {
          processed: bulkResult.processed,
          failed: bulkResult.failed,
        },
      });

      // ── Step 5: Phân tích thị trường ──
      updateStep(5, { status: 'running' });
      const markdownContent =
        await this.newsArticleService.analyzeMarketTrendsByAI(
          newsArticleIds,
        );
      updateStep(5, { status: 'done', result: { content: markdownContent } });

      // ── Hoàn tất ──
      // finalResult flatten ra top-level ở GET endpoint (field `result`) —
      // markdownContent thật nằm ở steps[4].result.content, KHÔNG có sẵn ở
      // top-level nếu không build tường minh (spec mục 2, response khi done).
      const finalJob = this.analyzeJobService.getJob(jobId);
      const finalState: WorkflowJobState = finalJob
        ? (finalJob.result as WorkflowJobState)
        : {
            currentStep: 5,
            steps: [1, 2, 3, 4, 5].map((s) => ({
              step: s,
              label: STEP_LABELS[s],
              status: 'done' as const,
            })),
            date,
          };
      finalState.finalResult = {
        markdownContent,
        newsArticleCount: newsArticleIds.length,
        stats: {
          totalArticles: crawlResult?.stats?.totalArticles ?? 0,
          filtered: filteredKeepArticles.length,
          crawledContent: bulkResult.processed,
          failedCrawl: bulkResult.failed,
        },
      };
      this.analyzeJobService.markDone(jobId, finalState);

      // Audit log
      void this.auditLogService.log(
        AuditAction.WORKFLOW_MARKET_ANALYSIS,
        'news_articles',
        newsArticleIds,
        'system',
        { jobId, date, articleCount: newsArticleIds.length },
      );
    } catch (error: any) {
      const errMsg = error?.message || 'Lỗi không xác định trong pipeline';
      this.logger.error(`Workflow ${jobId} failed at step: ${errMsg}`, error?.stack);

      // KHÔNG dùng markError trực tiếp: nó ghi đè toàn bộ job và XOÁ field
      // result (mất currentStep/steps đã cập nhật tới bước lỗi) — spec yêu
      // cầu response lỗi vẫn phải giữ steps để FE tô đỏ đúng bước lỗi.
      // Thay vào đó: lấy state hiện tại, đánh dấu step đang 'running' (bước
      // vừa throw) thành 'error' + error message, rồi updateJob giữ nguyên
      // result/steps kèm status/error ở top-level.
      const job = this.analyzeJobService.getJob(jobId);
      const state = job?.result as WorkflowJobState | undefined;
      if (state?.steps) {
        const runningIdx = state.steps.findIndex((s) => s.status === 'running');
        if (runningIdx >= 0) {
          state.steps[runningIdx] = {
            ...state.steps[runningIdx],
            status: 'error',
            error: errMsg,
          };
        }
        this.analyzeJobService.updateJob(jobId, {
          status: 'error',
          error: errMsg,
          result: state,
        });
      } else {
        // Không tìm lại được state (job hết TTL / bị xoá giữa chừng) —
        // fallback về markError cũ, chấp nhận mất steps trong trường hợp hiếm này.
        this.analyzeJobService.markError(jobId, errMsg);
      }
    } finally {
      try {
        this.idempotencyService.clearInFlight(lockKey);
      } catch (err: any) {
        this.logger.error(
          `Workflow ${jobId}: clearInFlight threw`,
          err?.stack,
        );
      }
    }
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
