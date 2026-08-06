# Market Analysis Workflow Orchestration — Design Spec

**Date:** 2026-08-06
**Author:** Architect Agent
**Status:** Approved
**Depends on plan:** `docs/superpowers/plans/2026-08-06-market-analysis-workflow.md`

---

## 1. Open Questions — Answered

### Q1: Data flow between 5 steps

| Step | Input | Service call | Output shape | Field passed to next step |
|------|-------|-------------|--------------|--------------------------|
| 1. Thu thập tin tức | `date: string` (YYYY-MM-DD) | `customCrawlerService.crawlData(undefined, date, date)` | `{ filePath, stats: { totalArticles, ... } }` | `date` (cho step 2), `stats` (hiển thị UI) |
| 2. Phân tích & lọc | `date: string` | `customCrawlerService.getRawArticlesByDate(date)` → `aiFilterService.filterRawArticles(allArticles)` → `customCrawlerService.deleteRawArticlesInSetNotIn(submittedHashes, keepHashes)` | `FilteredArticlesResult { filteredKeepArticles: any[], filteredDeletedHashes: string[] }` | `filteredKeepArticles` (cho step 3 move-bulk) |
| 3. Chuyển sang bài viết | `filteredArticles: any[]` | `customCrawlerService.getRawArticlesByIds(rawIds)` → `newsArticleService.saveArticles(rawArticles)` → `newsArticleService.getArticleIdsByUrlHashes(processedUrlHashes)` | `MoveBulkResult { newsArticleIds: string[], savedCount: number, duplicates: number }` | `newsArticleIds: string[]` (cho step 4 & 5) |
| 4. Crawl nội dung chi tiết | `ids: string[]` (news_article _id) | `newsArticleService.analyzeMarketBulk(ids)` | `{ processed: number, failed: number }` | `ids` (giữ nguyên, step 5 dùng lại) |
| 5. Phân tích thị trường | `ids: string[]` (news_article _id) | `newsArticleService.analyzeMarketTrendsByAI(ids)` | `string` (markdown — service tự save vào MarketAnalysisHistory) | — (kết quả cuối) |

**Chi tiết data flow:**

```
Step 1: crawlData(date)
  → filePath, stats
  → raw_articles đã được upsert vào DB bởi crawlData

Step 2: filter + clean raw_articles
  2a. customCrawlerService.getRawArticlesByDate(date)
      → RawArticle[] (tất cả raw_articles trong ngày, không phân trang)
  2b. aiFilterService.filterRawArticles(allArticles)
      → any[] (các bài AI giữ lại, có field urlHash)
  2c. Xác định submittedHashes = allArticles.map(a => a.urlHash)
      keepHashes = filteredArticles.map(a => a.urlHash)
  2d. customCrawlerService.deleteRawArticlesInSetNotIn(submittedHashes, keepHashes)
      → xóa bài không được giữ
  Output: { filteredKeepArticles: RawArticle[] từ keepHashes, filteredDeletedHashes }

Step 3: move raw → news_articles
  3a. customCrawlerService.getRawArticlesByIds(filteredIds)
      → rawArticles (full raw_article objects)
  3b. newsArticleService.saveArticles(rawArticles)
      → { savedCount, duplicates, processedUrlHashes, newlySavedUrlHashes }
  3c. customCrawlerService.deleteRawArticlesBulk(filteredIds)
      (xóa raw sau khi move thành công)
  3d. newsArticleService.getArticleIdsByUrlHashes(processedUrlHashes)
      → string[] (news_article _id mới tạo/đã tồn tại)
  Output: { newsArticleIds: string[], savedCount, duplicates }

Step 4: crawl content
  4a. newsArticleService.analyzeMarketBulk(newsArticleIds)
      → { processed, failed, processedArticles }
      (tự update content + status CRAWLED cho từng article)
  Output: { processed, failed }

Step 5: AI analysis
  5a. newsArticleService.analyzeMarketTrendsByAI(newsArticleIds)
      → markdown string
      (tự save MarketAnalysisHistory{ content, articleIds })
  Output: markdown string
```

### Q2: Lock strategy

**Quyết định: Dùng lock riêng `workflow:market-analysis`, KHÔNG tái dụng lock của từng bước con.**

Lý do:

1. **Tránh deadlock:** Workflow gọi service method trực tiếp (DI), không qua controller → controller lock (`crawl:global`, `analyze-raw-all:global`, `analyze-market-trends:global`) không được kích hoạt. Nếu workflow cố acquire `crawl:global` ở step 1 trong khi manual crawl đang giữ lock đó → deadlock hoặc conflict không cần thiết.

2. **Single-entry protection:** Lock `workflow:market-analysis` chống double-submit workflow (click 2 lần). Đây là mối nguy chính — user vô tình trigger 2 pipeline cùng lúc gây tốn kép AI cost.

3. **Race condition acceptable:** Trường hợp user chạy manual crawl (POST /crawl) đồng thời workflow step 1 cũng đang crawl → cả 2 cùng upsert raw_articles theo urlHash. Mongoose `findOneAndUpdate` với `upsert: true` (trong `crawlData`) đủ an toàn. Rủi ro trùng lặp thấp và không gây mất dữ liệu.

4. **Pattern nhất quán:** Tất cả endpoint async hiện có (analyze-raw-all, analyze-market-trends, crawl) đều dùng lock riêng cho từng endpoint. Workflow là 1 endpoint mới → lock riêng là tự nhiên.

**Triển khai cụ thể:**

```
POST /news-manager/market-analysis-workflow:
  lockKey = "workflow:market-analysis"
  if (idempotencyService.isInFlight(lockKey)) → 409 ConflictException
  idempotencyService.markInFlight(lockKey)
  // ... fire-and-forget runWorkflow
  // runLockedJob tự clearInFlight trong finally
```

### Q3: MarketAnalysisHistory API

**ĐÃ CÓ SẴN.** Không cần thêm endpoint mới.

| Endpoint | Method | Vị trí (controller.ts) | Response |
|----------|--------|------------------------|----------|
| `/news-manager/articles/market-analysis-history` | GET | line 568-575 | `{ message, data: MarketAnalysisHistory[] }` |
| `/news-manager/articles/market-analysis-history/:id` | GET | line 582-590 | `{ message, data: MarketAnalysisHistory }` |

Service method: `newsArticleService.getMarketAnalysisHistory()` (line 431-436) — trả về tất cả records sorted `createdAt: -1`.

FE-5 dùng `GET /news-manager/articles/market-analysis-history` với TanStack Query key `['market-analysis-history']`.

### Q4: DI vs HTTP internal

**Quyết định: Gọi thẳng service method qua DI (dependency injection).**

Lý do:

1. **Pattern hiện tại đã làm vậy:**
   - `runAnalyzeMarketTrendsJob` → `this.newsArticleService.analyzeMarketTrendsByAI(ids)` (controller line 654-659)
   - `runAnalyzeMarketBulkJob` → `this.newsArticleService.analyzeMarketBulk(ids)` (controller line 742-747)
   - `runManualCrawlJob` → `this.customCrawlerService.crawlData(...)` (controller line 307-318)
   - `moveRawArticlesBulk` → `this.newsArticleService.saveArticles(...)` (controller line 182)

2. **HTTP nội bộ vô nghĩa:** Thêm latency network loopback, serialize/deserialize JSON, và auth overhead (JWT guard) mà không có lợi ích gì.

3. **Controller đã inject đủ tất cả service cần thiết:**
   - `customCrawlerService`
   - `aiFilterService`
   - `newsArticleService`
   - `analyzeJobService`
   - `idempotencyService`
   - `auditLogService`

4. **Type safety:** Gọi thẳng service giữ nguyên TypeScript type-checking, không mất type qua HTTP boundary.

---

## 2. Kiến trúc tổng thể

### Module responsibility

Tất cả code mới nằm trong **`news-fire-crawl-manager`** module hiện có. Không tạo module mới — pattern single-module nhất quán với toàn bộ module này.

```
news-fire-crawl-manager/
├── news-fire-crawl-manager.controller.ts  ← thêm 2 endpoint + private runWorkflow
├── dtos/news-manager.dto.ts               ← thêm TriggerMarketAnalysisWorkflowDto
├── services/
│   ├── custom-crawler.service.ts           ← thêm getRawArticlesByDate(date)
│   ├── news-article.service.ts             ← thêm getArticleIdsByUrlHashes(hashes)
│   └── analyze-job.service.ts              ← mở rộng AnalyzeJob type (thêm WorkflowJobState)
├── schemas/
│   └── market-analysis-history.schema.ts   ← giữ nguyên (đã đủ)
```

### Job State mở rộng

`AnalyzeJob.result` hiện là `unknown`. Với workflow, `result` sẽ chứa `WorkflowJobState`:

```typescript
// types/workflow-job-state.ts (file mới)
export interface WorkflowStepState {
  step: number;                // 1-5
  label: string;               // "Thu thập tin tức" | "Phân tích & lọc" | ...
  status: 'pending' | 'running' | 'done' | 'error';
  result?: unknown;            // output của step đó
  error?: string;              // message nếu status='error'
}

export interface WorkflowJobState {
  currentStep: number;         // 0-5 (0 = chưa bắt đầu, 5 = hoàn tất)
  steps: WorkflowStepState[];  // luôn đủ 5 phần tử, khởi tạo all pending
  date: string;                // ngày phân tích
}
```

### Poll endpoint response shape

```typescript
// GET /news-manager/market-analysis-workflow/:jobId

// Khi job đang chạy:
{
  "status": "pending",
  "currentStep": 2,
  "steps": [
    { "step": 1, "label": "Thu thập tin tức", "status": "done", "result": { "totalArticles": 45 } },
    { "step": 2, "label": "Phân tích & lọc", "status": "running" },
    { "step": 3, "label": "Chuyển sang bài viết", "status": "pending" },
    { "step": 4, "label": "Crawl nội dung chi tiết", "status": "pending" },
    { "step": 5, "label": "Phân tích thị trường", "status": "pending" }
  ]
}

// Khi job hoàn tất:
{
  "status": "done",
  "currentStep": 5,
  "steps": [ /* 5 steps all 'done' with results */ ],
  "result": {
    "markdownContent": "...",
    "newsArticleCount": 12,
    "stats": { "totalArticles": 45, "filtered": 12, "crawledContent": 11, "failedCrawl": 1 }
  }
}

// Khi job lỗi (dừng ở step 3):
{
  "status": "error",
  "error": "Failed to save articles: ...",
  "currentStep": 3,
  "steps": [
    { "step": 1, "status": "done", ... },
    { "step": 2, "status": "done", ... },
    { "step": 3, "status": "error", "error": "Failed to save articles: ..." },
    { "step": 4, "status": "pending" },
    { "step": 5, "status": "pending" }
  ]
}

// Job không tồn tại (TTL 1h / server restart):
{ "status": "not_found" }
```

---

## 3. Thay đổi Backend

### 3.1 File mới: `types/workflow-job-state.ts`

```
RealEstateBackendApp/src/modules/news-fire-crawl-manager/types/workflow-job-state.ts
```

Định nghĩa `WorkflowStepState`, `WorkflowJobState`, `STEP_LABELS` (map step → label tiếng Việt).

### 3.2 `services/custom-crawler.service.ts` — thêm method

**Method: `getRawArticlesByDate(date: string): Promise<RawArticle[]>`**

```typescript
// Thêm vào class CustomCrawlerService (sau getRawArticlesByIds, line ~567)

/**
 * Lấy toàn bộ raw articles trong 1 ngày (YYYY-MM-DD) — không phân trang.
 * Dùng cho workflow pipeline step 2 (cần toàn bộ, không chỉ 1 trang).
 */
async getRawArticlesByDate(date: string): Promise<RawArticle[]> {
  const startDate = startOfDayUtc(date);
  const endDate = endOfDayUtc(date);
  return this.rawArticleModel
    .find({
      createdAt: { $gte: startDate, $lte: endDate },
    })
    .lean()
    .exec();
}
```

**Import cần thêm:** `startOfDayUtc`, `endOfDayUtc` đã import sẵn (line 23-27) — không cần thêm.

### 3.3 `services/news-article.service.ts` — thêm method

**Method: `getArticleIdsByUrlHashes(urlHashes: string[]): Promise<string[]>`**

```typescript
// Thêm vào class NewsArticleService (sau deleteArticlesByUrlHashes, line ~536)

/**
 * Map urlHashes → news_article _id.
 * Dùng sau saveArticles để lấy _id của các bài vừa tạo/đã tồn tại.
 */
async getArticleIdsByUrlHashes(urlHashes: string[]): Promise<string[]> {
  if (!urlHashes || urlHashes.length === 0) return [];
  const articles = await this.newsArticleModel
    .find({ urlHash: { $in: urlHashes } })
    .select('_id')
    .lean()
    .exec();
  return articles.map((a: any) => a._id.toString());
}
```

### 3.4 `dtos/news-manager.dto.ts` — thêm DTO

**Thêm DTO: `TriggerMarketAnalysisWorkflowDto`**

```typescript
// Thêm vào cuối file, sau AiPromptDto (line ~122)

export class TriggerMarketAnalysisWorkflowDto {
  @ApiPropertyOptional({
    description: 'Ngày phân tích (YYYY-MM-DD). Mặc định: hôm nay (UTC+7).',
    example: '2026-08-06',
  })
  @IsOptional()
  @IsString()
  date?: string;
}
```

**Import cần thêm:** `IsOptional`, `IsString`, `ApiPropertyOptional` đã có sẵn — không cần thêm import.

### 3.5 `news-fire-crawl-manager.controller.ts` — thêm endpoint + private method

#### 3.5.1 Import thêm

```typescript
// Thêm vào block import đầu controller (sau TriggerManualAnalyzeDto, line ~22)
import { TriggerMarketAnalysisWorkflowDto } from './dtos/news-manager.dto';

// Thêm type import
import { WorkflowJobState, STEP_LABELS } from './types/workflow-job-state';
```

(Import `TriggerMarketAnalysisWorkflowDto` từ cùng file DTO — chỉ cần thêm tên vào destructure hiện có.)

#### 3.5.2 `POST /news-manager/market-analysis-workflow`

```typescript
// Thêm vào controller, sau getAnalyzeMarketBulkJob (line ~824)
// Vị trí: trước deleteBulkArticles (line ~826)

@ApiOperation({
  summary: 'Market analysis workflow (async)',
  description:
    'Chạy pipeline 5 bước tự động: crawl → filter → move → crawl content → AI analysis. ' +
    'Trả về jobId ngay — dùng GET /market-analysis-workflow/:jobId để poll.',
})
@Post('market-analysis-workflow')
triggerMarketAnalysisWorkflow(@Body() body: TriggerMarketAnalysisWorkflowDto) {
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

  // Set initial WorkflowJobState vào job result
  const initialState: WorkflowJobState = {
    currentStep: 0,
    steps: [1, 2, 3, 4, 5].map((step) => ({
      step,
      label: STEP_LABELS[step],
      status: 'pending' as const,
    })),
    date,
  };
  this.analyzeJobService.markDone(jobId, initialState);
  // Override status về 'pending' — markDone set status='done' nhưng ta cần 'pending'
  // Cách sạch hơn: thêm method setJobResult vào AnalyzeJobService
  // Tạm thời: patch lại status sau markDone
  const job = this.analyzeJobService.getJob(jobId);
  if (job) {
    (job as any).status = 'pending';
    (job as any).result = initialState;
  }

  void this.runWorkflow(jobId, date, LOCK_KEY).catch((err: any) =>
    this.logger.error(
      `Workflow fire-and-forget rejected: ${err?.message}`,
      err?.stack,
    ),
  );

  return { message: 'Phân tích thị trường đã bắt đầu', jobId };
}
```

**Lưu ý:** Cần thêm method `getTodayVNString()` hoặc tính date mặc định. Pattern hiện tại trong `TriggerManualCrawlDto` không có default date. Đề xuất:

```typescript
// Helper private method trong controller
private getTodayVNString(): string {
  // UTC+7 Vietnam time
  const now = new Date();
  const vnTime = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  return vnTime.toISOString().split('T')[0];
}
```

**Lưu ý 2:** `AnalyzeJobService` hiện chỉ có `markDone(jobId, result)` set status='done'. Cần thêm method:

```typescript
// Thêm vào AnalyzeJobService (line 43, sau markError)
updateJob(jobId: string, patch: Partial<AnalyzeJob>): void {
  const job = this.jobs.get(jobId);
  if (job) {
    Object.assign(job, patch, { updatedAt: Date.now() });
  }
}
```

#### 3.5.3 `GET /news-manager/market-analysis-workflow/:jobId`

```typescript
// Thêm vào controller, sau POST endpoint trên

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
  // Trả về nguyên job object — FE nhận { status, currentStep, steps, result?, error? }
  return job;
}
```

#### 3.5.4 `private runWorkflow()` — orchestrator chính

```typescript
// Thêm vào controller, sau runLockedJob/runJob (line ~807)

/**
 * Orchestrator: chạy tuần tự 5 bước pipeline market analysis.
 * Mỗi bước: cập nhật job state → gọi service → await → cập nhật result.
 * Lỗi bất kỳ bước nào → dừng pipeline, markError.
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
      undefined, date, date,
    );
    updateStep(1, { status: 'done', result: crawlResult });

    // ── Step 2: Phân tích & lọc ──
    updateStep(2, { status: 'running' });
    const allArticles = await this.customCrawlerService.getRawArticlesByDate(date);
    if (!allArticles || allArticles.length === 0) {
      updateStep(2, { status: 'done', result: { filteredCount: 0 } });
      // Không có bài → vẫn chạy tiếp (step 3-5 sẽ nhận mảng rỗng → skip)
      const emptyResult: WorkflowJobState = {
        currentStep: 5,
        steps: [1, 2, 3, 4, 5].map((s) => ({
          step: s,
          label: STEP_LABELS[s],
          status: 'done',
          result: s <= 2 ? (s === 1 ? crawlResult : { filteredCount: 0 }) : { skipped: true },
        })),
        date,
      };
      this.analyzeJobService.markDone(jobId, emptyResult);
      return;
    }

    const filteredArticles = await this.aiFilterService.filterRawArticles(allArticles);
    const keepHashes: string[] = filteredArticles?.map((a: any) => a.urlHash).filter(Boolean) ?? [];
    const submittedHashes = allArticles.map((a) => a.urlHash).filter(Boolean);
    await this.customCrawlerService.deleteRawArticlesInSetNotIn(submittedHashes, keepHashes);
    updateStep(2, {
      status: 'done',
      result: { filteredCount: filteredArticles?.length ?? 0, deletedCount: submittedHashes.length - keepHashes.length },
    });

    // ── Step 3: Chuyển sang bài viết ──
    updateStep(3, { status: 'running' });
    if (!filteredArticles || filteredArticles.length === 0) {
      updateStep(3, { status: 'done', result: { savedCount: 0 } });
      // Step 4-5 cũng skip
      const skippedSteps = [3, 4, 5].map((s) => ({
        step: s,
        label: STEP_LABELS[s],
        status: 'done' as const,
        result: { skipped: true },
      }));
      const partialState: WorkflowJobState = {
        currentStep: 5,
        steps: [
          { step: 1, label: STEP_LABELS[1], status: 'done', result: crawlResult },
          { step: 2, label: STEP_LABELS[2], status: 'done', result: { filteredCount: 0 } },
          ...skippedSteps,
        ],
        date,
      };
      this.analyzeJobService.markDone(jobId, partialState);
      return;
    }

    const rawIds = filteredArticles.map((a: any) => a._id?.toString()).filter(Boolean);
    const rawArticles = await this.customCrawlerService.getRawArticlesByIds(rawIds);
    const saveResult = await this.newsArticleService.saveArticles(rawArticles);

    // Xóa raw articles đã move
    const typedRawArticles = rawArticles as Array<{ _id: { toString: () => string }; urlHash?: string | null }>;
    const successfulIds = typedRawArticles
      .filter((raw) => raw.urlHash && saveResult.processedUrlHashes.includes(raw.urlHash))
      .map((raw) => raw._id.toString());
    if (successfulIds.length > 0) {
      await this.customCrawlerService.deleteRawArticlesBulk(successfulIds);
    }

    // Map urlHashes → news_article _id
    const newsArticleIds = await this.newsArticleService.getArticleIdsByUrlHashes(
      saveResult.processedUrlHashes,
    );
    updateStep(3, {
      status: 'done',
      result: { newsArticleIds, savedCount: saveResult.savedCount, duplicates: saveResult.duplicates },
    });

    if (newsArticleIds.length === 0) {
      // Step 4-5 skip
      const partialState: WorkflowJobState = {
        currentStep: 5,
        steps: [
          { step: 1, label: STEP_LABELS[1], status: 'done', result: crawlResult },
          { step: 2, label: STEP_LABELS[2], status: 'done', result: { filteredCount: filteredArticles.length } },
          { step: 3, label: STEP_LABELS[3], status: 'done', result: { savedCount: 0 } },
          { step: 4, label: STEP_LABELS[4], status: 'done', result: { skipped: true } },
          { step: 5, label: STEP_LABELS[5], status: 'done', result: { skipped: true } },
        ],
        date,
      };
      this.analyzeJobService.markDone(jobId, partialState);
      return;
    }

    // ── Step 4: Crawl nội dung chi tiết ──
    updateStep(4, { status: 'running' });
    const bulkResult = await this.newsArticleService.analyzeMarketBulk(newsArticleIds);
    updateStep(4, { status: 'done', result: { processed: bulkResult.processed, failed: bulkResult.failed } });

    // ── Step 5: Phân tích thị trường ──
    updateStep(5, { status: 'running' });
    const markdownContent = await this.newsArticleService.analyzeMarketTrendsByAI(newsArticleIds);
    updateStep(5, { status: 'done', result: { content: markdownContent } });

    // ── Hoàn tất ──
    const finalState: WorkflowJobState = {
      currentStep: 5,
      steps: [1, 2, 3, 4, 5].map((s) => ({
        step: s,
        label: STEP_LABELS[s],
        status: 'done',
        result: (() => {
          const job = this.analyzeJobService.getJob(jobId);
          return job ? (job.result as WorkflowJobState).steps[s - 1].result : undefined;
        })(),
      })),
      date,
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
    this.logger.error(
      `Workflow ${jobId} failed at step: ${error.message}`,
      error.stack,
    );
    this.analyzeJobService.markError(
      jobId,
      error.message || 'Lỗi không xác định trong pipeline',
    );
    throw error; // rethrow để runLockedJob bắt
  } finally {
    try {
      this.idempotencyService.clearInFlight(lockKey);
    } catch (err: any) {
      this.logger.error(`Workflow ${jobId}: clearInFlight threw`, err?.stack);
    }
  }
}
```

**Thiết kế lại — dùng pattern `runJob` hiện có:**

Code trên tự quản lý try/catch/finally. Nhưng pattern hiện tại dùng `runLockedJob`/`runJob` để DRY lifecycle. Tuy nhiên `runJob` bọc toàn bộ work trong 1 try/catch và gọi `markDone`/`markError` 1 lần duy nhất — không phù hợp với việc cập nhật progress từng bước. **Do đó `runWorkflow` cần try/catch riêng** như trên. Lock được quản lý thủ công (không qua `runLockedJob`). Đây là sự đánh đổi có chủ đích: progress tracking real-time > DRY với `runLockedJob`.

### 3.6 `services/analyze-job.service.ts` — thêm method

```typescript
// Thêm vào AnalyzeJobService (sau markError, line ~43)

/**
 * Cập nhật partial fields của job (dùng cho progress tracking của workflow).
 * Không thay đổi updatedAt nếu không truyền.
 */
updateJob(jobId: string, patch: Partial<AnalyzeJob>): void {
  const job = this.jobs.get(jobId);
  if (job) {
    Object.assign(job, patch, { updatedAt: Date.now() });
  }
}
```

### 3.7 `schemas/audit-log.schema.ts` — thêm AuditAction (nếu chưa có)

Kiểm tra xem `WORKFLOW_MARKET_ANALYSIS` đã có trong enum `AuditAction` chưa. Nếu chưa, thêm vào.

---

## 4. Thay đổi Frontend

### 4.1 Route + Sidebar

**`AppSidebar.tsx`:** Thêm mục "Phân tích thị trường" sau mục "Phân tích tin tức" (route: `/market-analysis-workflow`).

**Router config:** Thêm route `/market-analysis-workflow` → `MarketAnalysisWorkflowScreen`.

### 4.2 `MarketAnalysisWorkflowJobContext.tsx`

Pattern giống `ManualCrawlJobContext.tsx`:

```typescript
// Key types
interface WorkflowJobResponse {
  status: 'pending' | 'done' | 'error' | 'not_found';
  currentStep?: number;
  steps?: WorkflowStepState[];
  result?: unknown;
  error?: string;
}

// Provider expose:
// - startJob(date: string): gọi POST /news-manager/market-analysis-workflow → lấy jobId, set jobId
// - jobState: WorkflowJobResponse | null
// - isRunning: boolean (status === 'pending')
// - resetJob(): xóa jobId

// React Query: useQuery key ['market-analysis-workflow-job', jobId]
// queryFn: GET /news-manager/market-analysis-workflow/${jobId}
// refetchInterval: 3000 khi isRunning
// onSuccess: nếu done/error → stop polling, invalidate ['market-analysis-history']
```

### 4.3 `MarketAnalysisWorkflowScreen.tsx`

Layout (top → bottom):
1. Row: DatePicker (default hôm nay UTC+7) + Button "Phân tích" (disabled khi `isRunning`)
2. Workflow visualization: 5 step cards với connector ngang, màu theo status:
   - pending: gray
   - running: blue + spinner
   - done: green + check
   - error: red + X
3. Kết quả: khi done → hiển thị `content` (markdown) từ step 5 result
4. Lịch sử: table `MarketAnalysisHistory` fetch từ `GET /news-manager/articles/market-analysis-history`

---

## 5. Error handling & Edge cases

| Trường hợp | Xử lý |
|---|---|
| Double-submit workflow | Lock `workflow:market-analysis` → ConflictException 409 → FE toast "Đang có phân tích đang chạy" |
| Step lỗi giữa chừng | `runWorkflow` catch → `markError` + `clearInFlight`. Step error status + message hiển thị trong UI |
| Ngày không có raw_articles | Step 2 returns `[]` → step 3-5 skip, markDone sớm |
| Filter AI trả về rỗng | Step 2 `filteredCount=0` → step 3-5 skip |
| Server restart giữa chừng | In-memory job mất → poll `not_found` → FE toast lỗi, reset UI |
| Tab switch/refresh | Provider ở AppLayout → jobId lưu trong state → mở lại tab vẫn thấy progress |
| 5 bước chạy > axios timeout | FE dùng poll (không await POST) → không timeout. BE fire-and-forget → không giới hạn thời gian |
| Crawl rate limit (step 1/4) | Exception throw → catch trong step → dừng pipeline với step error |

---

## 6. Testing

### Backend unit tests (`controller.spec.ts`)

- `POST /market-analysis-workflow` → trả `{ jobId }`, status 200
- Lock conflict → 409
- `GET /market-analysis-workflow/:jobId` → trả job state với steps
- Job not found → `{ status: 'not_found' }`

### Integration test (manual)

1. Gọi POST workflow với date có dữ liệu → poll → xác nhận 5 steps progress 1→5
2. Gọi POST workflow lần 2 khi đang chạy → 409
3. Đóng tab → mở lại → vẫn thấy progress
4. Step error → UI hiển thị step error + message

---

## 7. File manifest

| File | Action | Nội dung |
|------|--------|----------|
| `types/workflow-job-state.ts` | **NEW** | `WorkflowStepState`, `WorkflowJobState`, `STEP_LABELS` |
| `dtos/news-manager.dto.ts` | EDIT | Thêm `TriggerMarketAnalysisWorkflowDto` |
| `services/analyze-job.service.ts` | EDIT | Thêm `updateJob(jobId, patch)` |
| `services/custom-crawler.service.ts` | EDIT | Thêm `getRawArticlesByDate(date)` |
| `services/news-article.service.ts` | EDIT | Thêm `getArticleIdsByUrlHashes(hashes)` |
| `news-fire-crawl-manager.controller.ts` | EDIT | Thêm `triggerMarketAnalysisWorkflow`, `getMarketAnalysisWorkflowJob`, `runWorkflow`, `getTodayVNString` |
| `schemas/audit-log.schema.ts` | EDIT (maybe) | Thêm `WORKFLOW_MARKET_ANALYSIS` vào enum `AuditAction` |
| FE `MarketAnalysisWorkflowJobContext.tsx` | **NEW** | Provider poll pattern |
| FE `MarketAnalysisWorkflowScreen.tsx` | **NEW** | Full UI |
| FE `AppSidebar.tsx` | EDIT | Thêm nav entry |
| FE `AppLayout.tsx` | EDIT | Thêm Provider |
| FE router config | EDIT | Thêm route |

---

## 8. Handoff

```
design doc này → coder-backend-agent (BE-1 → BE-5)
               → coder-frontend-agent (FE-1 → FE-5)
               → qa-agent (review + audit)
```
