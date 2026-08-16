import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { KnowledgeArticleService } from './services/knowledge-article.service';
import { KnowledgeConfigService } from './services/knowledge-config.service';
import { PipelineLogService } from './services/pipeline-log.service';
import { PipelineService } from './services/pipeline.service';
import { NlCronService } from './services/nl-cron.service';
import {
  GetKnowledgeArticlesQueryDto,
  BulkIdsDto,
  RunPipelineDto,
  GetPipelineLogsQueryDto,
} from './dtos/knowledge-article.dto';
import {
  UpdateWpConfigDto,
  UpdateAiWritingConfigDto,
  UpdateAiImageConfigDto,
  UpdateKnowledgeCronConfigDto,
} from './dtos/knowledge-config.dto';
import {
  ParseNlDto,
  PreviewScheduleDto,
  ActivateScheduleDto,
} from './dtos/nl-cron.dto';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../common/enums/user-role.enum';

@ApiTags('Knowledge Articles')
@Controller('knowledge-articles')
export class KnowledgeArticlesController {
  constructor(
    private readonly knowledgeArticleService: KnowledgeArticleService,
    private readonly knowledgeConfigService: KnowledgeConfigService,
    private readonly pipelineLogService: PipelineLogService,
    private readonly pipelineService: PipelineService,
    private readonly nlCronService: NlCronService,
  ) {}

  // ── Config Endpoints ────────────────────────────────────

  @Roles(UserRole.ADMIN)
  @Get('config/wp')
  @ApiOperation({ summary: 'Get WordPress connection config' })
  async getWpConfig() {
    const data = await this.knowledgeConfigService.getWpConfig();
    return { data };
  }

  @Roles(UserRole.ADMIN)
  @Put('config/wp')
  @ApiOperation({ summary: 'Update WordPress connection config' })
  async updateWpConfig(@Body() body: UpdateWpConfigDto) {
    const doc = await this.knowledgeConfigService.updateWpConfig(
      body as Record<string, unknown>,
    );
    return { message: 'WP config updated', data: doc.config };
  }

  @Roles(UserRole.ADMIN)
  @Get('config/ai-writing')
  @ApiOperation({ summary: 'Get AI writing config' })
  async getAiWritingConfig() {
    const data = await this.knowledgeConfigService.getAiWritingConfig();
    return { data };
  }

  @Roles(UserRole.ADMIN)
  @Put('config/ai-writing')
  @ApiOperation({ summary: 'Update AI writing config' })
  async updateAiWritingConfig(@Body() body: UpdateAiWritingConfigDto) {
    const doc = await this.knowledgeConfigService.updateAiWritingConfig(
      body as Record<string, unknown>,
    );
    return { message: 'AI writing config updated', data: doc.config };
  }

  @Roles(UserRole.ADMIN)
  @Get('config/ai-image')
  @ApiOperation({ summary: 'Get AI image config' })
  async getAiImageConfig() {
    const data = await this.knowledgeConfigService.getAiImageConfig();
    return { data };
  }

  @Roles(UserRole.ADMIN)
  @Put('config/ai-image')
  @ApiOperation({ summary: 'Update AI image config' })
  async updateAiImageConfig(@Body() body: UpdateAiImageConfigDto) {
    const doc = await this.knowledgeConfigService.updateAiImageConfig(
      body as Record<string, unknown>,
    );
    return { message: 'AI image config updated', data: doc.config };
  }

  @Roles(UserRole.ADMIN)
  @Get('config/cron')
  @ApiOperation({ summary: 'Get cron config' })
  async getCronConfig() {
    const data = await this.knowledgeConfigService.getCronConfig();
    return { data };
  }

  @Roles(UserRole.ADMIN)
  @Put('config/cron')
  @ApiOperation({ summary: 'Update cron config' })
  async updateCronConfig(@Body() body: UpdateKnowledgeCronConfigDto) {
    const doc = await this.knowledgeConfigService.updateCronConfig(
      body as Record<string, unknown>,
    );
    return { message: 'Cron config updated', data: doc.config };
  }

  // ── Knowledge Article Endpoints ─────────────────────────

  @Roles(UserRole.ADMIN)
  @Get('/')
  @ApiOperation({ summary: 'List knowledge articles (paginated)' })
  async getKnowledgeArticles(
    @Query() query: GetKnowledgeArticlesQueryDto,
  ) {
    return this.knowledgeArticleService.listArticles(query);
  }

  @Roles(UserRole.ADMIN)
  @Get('/:id')
  @ApiOperation({ summary: 'Get knowledge article detail' })
  @ApiParam({ name: 'id', description: 'Knowledge article ID' })
  async getKnowledgeArticleById(@Param('id') id: string) {
    const data = await this.knowledgeArticleService.getArticleById(id);
    return { data };
  }

  @Roles(UserRole.ADMIN)
  @Post('/:id/retry')
  @ApiOperation({ summary: 'Retry a failed knowledge article' })
  @ApiParam({ name: 'id', description: 'Knowledge article ID' })
  async retryArticle(@Param('id') id: string) {
    const result = await this.knowledgeArticleService.retryArticle(id);
    return { message: 'Retry initiated', data: result };
  }

  @Roles(UserRole.ADMIN)
  @Post('/:id/publish')
  @ApiOperation({ summary: 'Publish a ready knowledge article to WordPress' })
  @ApiParam({ name: 'id', description: 'Knowledge article ID' })
  async publishArticle(@Param('id') id: string) {
    const result = await this.knowledgeArticleService.publishToWordPress(id);
    return { message: 'Article published', data: result };
  }

  @Roles(UserRole.ADMIN)
  @Post('/:id/republish')
  @ApiOperation({ summary: 'Republish (update) an existing WordPress post' })
  @ApiParam({ name: 'id', description: 'Knowledge article ID' })
  async republishArticle(@Param('id') id: string) {
    const result =
      await this.knowledgeArticleService.republishToWordPress(id);
    return { message: 'Article republished', data: result };
  }

  @Roles(UserRole.ADMIN)
  @Delete('/:id')
  @ApiOperation({ summary: 'Soft delete a knowledge article' })
  @ApiParam({ name: 'id', description: 'Knowledge article ID' })
  async deleteKnowledgeArticle(@Param('id') id: string) {
    await this.knowledgeArticleService.deleteArticle(id);
    return { message: 'Article deleted' };
  }

  @Roles(UserRole.ADMIN)
  @Post('bulk/delete')
  @ApiOperation({ summary: 'Bulk soft delete knowledge articles' })
  async bulkDeleteArticles(@Body() body: BulkIdsDto) {
    const result =
      await this.knowledgeArticleService.deleteBulkArticles(body.ids);
    return {
      message: `${result.deletedCount} articles deleted`,
      data: result,
    };
  }

  @Roles(UserRole.ADMIN)
  @Post('bulk/publish')
  @ApiOperation({ summary: 'Bulk publish knowledge articles' })
  async bulkPublishArticles(@Body() body: BulkIdsDto) {
    // Start pipeline for each article — collect results
    const results: Array<{ id: string; success: boolean; error?: string }> = [];
    for (const id of body.ids) {
      try {
        await this.knowledgeArticleService.publishToWordPress(id);
        results.push({ id, success: true });
      } catch (error: any) {
        results.push({ id, success: false, error: error.message });
      }
    }
    return {
      message: `${results.filter((r) => r.success).length}/${body.ids.length} articles published`,
      data: results,
    };
  }

  // ── Pipeline Endpoints ──────────────────────────────────

  @Roles(UserRole.ADMIN)
  @Post('pipeline/run')
  @ApiOperation({ summary: 'Start batch pipeline' })
  async startPipeline(@Body() body?: RunPipelineDto) {
    return this.pipelineService.startPipeline({
      category: body?.category,
      articleCount: body?.articleCount,
      source: 'manual',
    });
  }

  @Roles(UserRole.ADMIN)
  @Get('pipeline/:jobId')
  @ApiOperation({ summary: 'Poll pipeline status' })
  @ApiParam({ name: 'jobId', description: 'Pipeline job ID' })
  async getPipelineStatus(@Param('jobId') jobId: string) {
    const status = this.pipelineService.getJobStatus(jobId);
    if (!status) {
      return { status: 'not_found', currentStep: 0, steps: [] };
    }
    return status;
  }

  @Roles(UserRole.ADMIN)
  @Post('pipeline/:batchId/retry-failed')
  @ApiOperation({ summary: 'Retry all failed articles in a pipeline batch' })
  @ApiParam({ name: 'batchId', description: 'Batch ID' })
  async retryFailedArticles(@Param('batchId') batchId: string) {
    const result = await this.pipelineService.retryFailedArticles(batchId);
    return {
      message: `${result.retriedCount} articles queued for retry`,
      data: result,
    };
  }

  @Roles(UserRole.ADMIN)
  @Get('pipeline/logs')
  @ApiOperation({ summary: 'List pipeline logs (paginated)' })
  async getPipelineLogs(@Query() query: GetPipelineLogsQueryDto) {
    return this.pipelineLogService.listLogs({
      page: query.page ?? 1,
      limit: query.limit ?? 20,
      status: query.status,
      category: query.category,
    });
  }

  @Roles(UserRole.ADMIN)
  @Get('pipeline/logs/:batchId')
  @ApiOperation({ summary: 'Get pipeline log detail' })
  @ApiParam({ name: 'batchId', description: 'Batch ID' })
  async getPipelineLogDetail(@Param('batchId') batchId: string) {
    const data = await this.pipelineLogService.getLogByBatchId(batchId);
    return { data };
  }

  // ── NL Cron Endpoints ───────────────────────────────────

  @Roles(UserRole.ADMIN)
  @Post('cron/parse-nl')
  @ApiOperation({ summary: 'Parse natural language to cron expression' })
  async parseNlSchedule(@Body() body: ParseNlDto) {
    return this.nlCronService.parseDescription(body.description);
  }

  @Roles(UserRole.ADMIN)
  @Post('cron/preview')
  @ApiOperation({ summary: 'Preview next 5 run times for a cron expression' })
  async previewSchedule(@Body() body: PreviewScheduleDto) {
    return this.nlCronService.previewSchedule(body.cronExpression);
  }

  @Roles(UserRole.ADMIN)
  @Put('cron/activate')
  @ApiOperation({ summary: 'Save and activate cron schedule' })
  async activateSchedule(@Body() body: ActivateScheduleDto) {
    return this.nlCronService.activateSchedule(
      body.cronExpression,
      body.nlDescription,
    );
  }

  @Roles(UserRole.ADMIN)
  @Post('cron/test-run')
  @ApiOperation({ summary: 'Manual test run (no schedule)' })
  async testRun(@Body() body?: RunPipelineDto) {
    return this.pipelineService.startPipeline({
      category: body?.category,
      articleCount: body?.articleCount,
      source: 'manual',
    });
  }
}
