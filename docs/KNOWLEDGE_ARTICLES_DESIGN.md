# Knowledge Articles — Architecture Design Spec

**Date:** 2026-08-16
**Author:** Architect Agent
**Status:** Draft
**Depends on:** `docs/intent/knowledge-articles-auto-publish.md`

---

## 1. Architecture Decisions

### D1: Reuse `news_articles` collection with `type='knowledge'`

Knowledge articles live in the **same `news_articles` collection** as crawled news articles, differentiated by a `type` field.

Rationale:
- Avoids a parallel collection with duplicate schema/CRUD logic
- Existing fields (`title`, `content`, `urlHash`, `wpPostId`, `status[]`) are reusable
- Knowledge-specific fields (`pipelineState`, `wpCategoryId`, `wpTagIds`, etc.) are added as optional props — `type='knowledge'` documents populate them, `type='news'` (or undefined) documents ignore them
- Querying: `db.news_articles.find({ type: 'knowledge' })` isolates knowledge articles cleanly

Migration: Existing documents have no `type` field → treated as `type='news'` (default). No data migration needed.

### D2: MongoDB for all configs (not .env)

WP Connection, AI Writing, AI Image, and Cron configs stored in a `knowledge_configs` collection with `type` field, not `.env` file.

Rationale:
- Structured data (WP category/tag mapping, AI prompt templates) doesn't fit key-value .env
- Queryable, versionable, supports multiple config records
- Avoids race conditions from concurrent .env writes (existing pattern in `SettingsService` and `CronjobService`)
- API-friendly: GET/PUT per config type

### D3: Separate module `knowledge-articles`

New NestJS module alongside `news-fire-crawl-manager`, not added to it.

Rationale:
- `news-fire-crawl-manager` is already 1600 lines in controller alone
- Knowledge articles have a distinct domain (auto-write, auto-publish) vs. news crawling/analysis
- Separate module allows independent testing, clearer DI boundaries
- Shared services (`IdempotencyService`, `AuditLogService`, `EmbeddingService`) imported from `common/` or via `imports` in module

### D4: Real WordPress REST API client

Replace the mock `WordPressService` (currently returns random IDs after 1s delay) with a real WP REST API client. Knowledge articles use this directly; news articles' `publishToWordPress` can be refactored later.

### D5: Pipeline orchestration follows existing fire-and-forget + lock pattern

Same pattern as `runWorkflow` in `news-fire-crawl-manager.controller.ts`:
- Acquire lock (`knowledge-pipeline:global`)
- Create job via `AnalyzeJobService`
- Run steps sequentially with `updateStep` progress tracking
- Return `{ jobId }` immediately; FE polls `GET /knowledge-articles/pipeline/:jobId`

---

## 2. Module Structure

```
RealEstateBackendApp/src/modules/knowledge-articles/
├── knowledge-articles.module.ts
├── knowledge-articles.controller.ts
├── dtos/
│   ├── knowledge-config.dto.ts        ← WP, AI Writing, AI Image, Cron config DTOs
│   ├── knowledge-article.dto.ts       ← List query, manual control DTOs
│   └── nl-cron.dto.ts                 ← NL → cron parsing DTO
├── schemas/
│   ├── knowledge-article.schema.ts    ← extends NewsArticle with type='knowledge' fields
│   ├── knowledge-config.schema.ts     ← WP/AI/Cron config documents
│   └── pipeline-log.schema.ts         ← Per-batch execution log
├── services/
│   ├── knowledge-article.service.ts   ← CRUD + state machine + manual controls
│   ├── knowledge-config.service.ts    ← Config CRUD (WP, AI Writing, AI Image, Cron)
│   ├── wp-client.service.ts           ← Real WP REST API client
│   ├── ai-writing.service.ts          ← AI content generation
│   ├── ai-image.service.ts            ← AI image generation
│   ├── pipeline.service.ts            ← Batch pipeline orchestration
│   └── nl-cron.service.ts             ← NL → cron expression parsing
└── types/
    └── knowledge-pipeline-state.ts    ← Pipeline step types
```

**Shared imports from other modules:**
- `IdempotencyService` from `../../common/services/idempotency.service`
- `AuditLogService` from `../news-fire-crawl-manager/services/audit-log.service`
- `AiPromptConfigService` from `../news-fire-crawl-manager/services/ai-prompt-config.service`
- `AnalyzeJobService` from `../news-fire-crawl-manager/services/analyze-job.service`

**Mongoose models registered:**
- `NewsArticle` (shared from `news-fire-crawl-manager`)
- `KnowledgeConfig`
- `PipelineLog`

---

## 3. Schema Definitions

### 3.1 Knowledge Article — Extension on `news_articles`

No new schema file needed. Additional fields added to the existing `NewsArticle` schema as **optional props**. Documents with `type='knowledge'` populate these; documents without `type` (or `type='news'`) ignore them.

**Additions to `NewsArticle` schema** (`news-fire-crawl-manager/schemas/news-article.schema.ts`):

```typescript
// ── Knowledge Articles Fields ──────────────────────────
// Only populated when type === 'knowledge'. All optional.

/** Discriminator: 'news' (default) | 'knowledge' */
@Prop({ default: 'news', index: true })
type: string;

/** Current pipeline state for knowledge articles */
@Prop({ type: String, enum: KnowledgeArticleState, default: null })
pipelineState: KnowledgeArticleState | null;

/** Error message from the last failed pipeline step */
@Prop({ default: null })
pipelineError: string | null;

/** Which pipeline step failed (1-5) */
@Prop({ default: null })
pipelineFailedStep: number | null;

/** WordPress category ID this article belongs to */
@Prop({ default: null })
wpCategoryId: number | null;

/** WordPress tag IDs applied to this article */
@Prop({ type: [Number], default: [] })
wpTagIds: number[];

/** ID of the AI writing prompt config used */
@Prop({ default: null })
aiWritingPromptId: string | null;

/** WordPress post ID (already exists — reused for knowledge articles) */
// wpPostId: number | null;  ← already in schema

/** Featured image URL after generation */
@Prop({ default: null })
featuredImageUrl: string | null;

/** WordPress media ID of the featured image */
@Prop({ default: null })
wpMediaId: number | null;

/** Array of inline image URLs generated for the article */
@Prop({ type: [String], default: [] })
inlineImageUrls: string[];

/** Category slug used for rotation tracking */
@Prop({ default: null })
categorySlug: string | null;

/** Batch ID linking articles generated in the same pipeline run */
@Prop({ index: true, default: null })
batchId: string | null;
```

**Indexes to add:**
```typescript
NewsArticleSchema.index({ type: 1, pipelineState: 1 });
NewsArticleSchema.index({ type: 1, batchId: 1 });
NewsArticleSchema.index({ type: 1, categorySlug: 1, createdAt: -1 });
```

### 3.2 Knowledge Article State Enum

```typescript
// types/knowledge-article-state.ts (NEW FILE)

export enum KnowledgeArticleState {
  PENDING = 'pending',
  GENERATING_CONTENT = 'generating_content',
  CONTENT_READY = 'content_ready',
  GENERATING_IMAGE = 'generating_image',
  READY = 'ready',
  PUBLISHING = 'publishing',
  PUBLISHED = 'published',
  FAILED = 'failed',
}
```

### 3.3 Knowledge Config Schema

```typescript
// schemas/knowledge-config.schema.ts (NEW FILE)

import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export enum KnowledgeConfigType {
  WP_CONNECTION = 'wp_connection',
  AI_WRITING = 'ai_writing',
  AI_IMAGE = 'ai_image',
  CRON = 'cron',
}

@Schema({ timestamps: true })
export class KnowledgeConfig extends Document {
  @Prop({ required: true, enum: KnowledgeConfigType, unique: true, index: true })
  type: KnowledgeConfigType;

  /** Flexible config payload — shape depends on `type` */
  @Prop({ type: Object, required: true })
  config: Record<string, any>;
}

export const KnowledgeConfigSchema =
  SchemaFactory.createForClass(KnowledgeConfig);
```

**Config shapes by type:**

#### `wp_connection`
```typescript
{
  siteUrl: string;              // e.g. "https://example.com"
  username: string;             // WP username
  appPassword: string;          // WP Application Password
  defaultCategoryId: number;    // Default WP category
  categoryMapping: Array<{
    slug: string;               // Internal category slug
    wpCategoryId: number;       // WP category ID
    wpCategoryName: string;     // Display name
  }>;
  defaultTagIds: number[];      // Default WP tag IDs
  tagMapping: Array<{
    name: string;               // Tag name
    wpTagId: number;            // WP tag ID
  }>;
}
```

#### `ai_writing`
```typescript
{
  promptTemplate: string;       // Template with {{topic}}, {{category}} placeholders
  model: string;                // AI model ID (e.g. "google/gemini-2.5-flash")
  provider: string;             // "OpenRouter" | "Must1c" | "9Router"
  maxTokens: number;            // Max output tokens
  temperature: number;          // 0.0 - 2.0
  // Topics/categories for rotation
  topics: Array<{
    slug: string;               // Internal slug
    name: string;               // Display name (e.g. "Bất động sản Hà Nội")
    description: string;        // Topic context for AI
  }>;
  articlesPerBatch: number;     // Default: 3
}
```

#### `ai_image`
```typescript
{
  enabled: boolean;             // Skip image generation if false
  promptTemplate: string;       // Template with {{title}}, {{content_summary}} placeholders
  model: string;                // Image generation model
  provider: string;             // "OpenRouter" | "ComfyUI" | etc.
  width: number;                // Image width (default: 1024)
  height: number;               // Image height (default: 1024)
  style: string;                // e.g. "realistic", "illustration"
}
```

#### `cron`
```typescript
{
  isActive: boolean;
  frequency: string;            // Cron expression (e.g. "0 8 * * 1-5")
  nlDescription: string;        // Original NL input from user
  parsedCron: string;           // AI-parsed cron expression
  lastRunAt: string | null;     // ISO timestamp
  nextRunAt: string | null;     // ISO timestamp
}
```

### 3.4 Pipeline Log Schema

```typescript
// schemas/pipeline-log.schema.ts (NEW FILE)

import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export enum PipelineRunStatus {
  RUNNING = 'running',
  COMPLETED = 'completed',
  FAILED = 'failed',
  PARTIAL = 'partial',     // Some articles succeeded, some failed
}

@Schema({ timestamps: true })
export class PipelineLog extends Document {
  /** Unique batch/pipeline run ID */
  @Prop({ required: true, unique: true, index: true })
  batchId: string;

  /** Category slug for this run */
  @Prop({ required: true })
  categorySlug: string;

  /** Trigger source */
  @Prop({ required: true, enum: ['cron', 'manual'] })
  source: string;

  /** Overall status */
  @Prop({ required: true, enum: PipelineRunStatus, index: true })
  status: PipelineRunStatus;

  /** Total articles attempted */
  @Prop({ default: 0 })
  totalArticles: number;

  /** Articles that reached 'published' */
  @Prop({ default: 0 })
  publishedCount: number;

  /** Articles that reached 'failed' */
  @Prop({ default: 0 })
  failedCount: number;

  /** Articles in 'ready' state (generated but not yet published) */
  @Prop({ default: 0 })
  readyCount: number;

  /** Per-article results */
  @Prop({ type: [Object], default: [] })
  articleResults: Array<{
    articleId: Types.ObjectId;
    title: string;
    state: string;              // Final state
    error?: string;             // Error message if failed
    failedStep?: number;        // Which step failed (1-5)
    wpPostId?: number;          // WP post ID if published
    duration: number;           // Processing time in ms
  }>;

  /** Pipeline step-level results */
  @Prop({ type: [Object], default: [] })
  steps: Array<{
    step: number;               // 1-5
    label: string;
    status: 'pending' | 'running' | 'done' | 'error';
    result?: unknown;
    error?: string;
    startedAt?: string;
    completedAt?: string;
  }>;

  /** Total pipeline duration in ms */
  @Prop({ default: 0 })
  totalDuration: number;

  /** Error summary if overall status is failed */
  @Prop({ default: null })
  errorSummary: string | null;
}

export const PipelineLogSchema =
  SchemaFactory.createForClass(PipelineLog);
PipelineLogSchema.index({ createdAt: -1 });
PipelineLogSchema.index({ categorySlug: 1, createdAt: -1 });
PipelineLogSchema.index({ status: 1, createdAt: -1 });
```

---

## 4. State Machine

```
                    ┌─────────────────────────────────────────────┐
                    │                                             │
                    ▼                                             │
              ┌──────────┐                                        │
              │ pending  │  (topic picked, pipeline started)      │
              └────┬─────┘                                        │
                   │                                              │
                   ▼                                              │
         ┌─────────────────────┐                                  │
         │ generating_content  │  (AI writing in progress)        │
         └────────┬────────────┘                                  │
                  │                                               │
                  ▼                                               │
          ┌───────────────┐                                       │
          │ content_ready │  (content done, no image yet)         │
          └───────┬───────┘                                       │
                  │                                               │
                  ▼                                               │
         ┌────────────────────┐                                   │
         │ generating_image   │  (AI image in progress)           │
         └────────┬───────────┘                                   │
                  │                                               │
                  ▼                                               │
          ┌───────────┐                                           │
          │   ready   │  (content + image done, ready to publish) │
          └─────┬─────┘                                           │
                │                                                 │
                ▼                                                 │
         ┌────────────┐                                           │
         │ publishing │  (WP upload in progress)                  │
         └──────┬─────┘                                           │
                │                                                 │
                ▼                                                 │
         ┌───────────┐                                            │
         │ published │  (done)                                    │
         └───────────┘                                            │
                                                                  │
  ANY STEP ──error──▶ ┌──────────┐                                │
                      │  failed  │──retry──▶ (back to failed step)│
                      └──────────┘                                │
                                                                  │
  NOTE: from 'published', republish → 'publishing' → 'published' ┘
```

**State transitions:**

| From | To | Trigger |
|------|----|---------|
| `pending` | `generating_content` | Pipeline step 1 starts |
| `generating_content` | `content_ready` | AI writing succeeds |
| `generating_content` | `failed` | AI writing fails |
| `content_ready` | `generating_image` | Pipeline step 2 starts |
| `content_ready` | `ready` | Image generation skipped (disabled) |
| `generating_image` | `ready` | AI image succeeds |
| `generating_image` | `failed` | AI image fails |
| `ready` | `publishing` | Manual publish or auto-publish |
| `publishing` | `published` | WP post succeeds |
| `publishing` | `failed` | WP post fails |
| `failed` | `generating_content` | Retry (from content step failure) |
| `failed` | `generating_image` | Retry (from image step failure) |
| `failed` | `publishing` | Retry (from publish step failure) |
| `published` | `publishing` | Republish (update existing WP post) |

---

## 5. Pipeline Flow Design

### 5.1 Batch Pipeline (5 Steps)

Triggered by: cron job (daily) or manual `POST /knowledge-articles/pipeline/run`.

```
┌─────────────────────────────────────────────────────────────┐
│                    PIPELINE ORCHESTRATOR                     │
│                                                              │
│  1. Pick Topics (per category rotation)                      │
│     └─ Select next category (round-robin by day)             │
│     └─ Create N knowledge_articles (state=pending)           │
│                                                              │
│  2. AI Writing (per article, sequential)                     │
│     └─ state → generating_content                            │
│     └─ Call AI API with writing prompt template               │
│     └─ Save content to article                               │
│     └─ state → content_ready                                 │
│                                                              │
│  3. AI Image Generation (per article, sequential)            │
│     └─ state → generating_image                              │
│     └─ Call AI image API with image prompt template           │
│     └─ Save featuredImageUrl                                 │
│     └─ state → ready                                         │
│                                                              │
│  4. Upload Media to WP (per article)                         │
│     └─ Upload featured image via WP REST API                 │
│     └─ Upload inline images                                  │
│     └─ Store wpMediaId                                       │
│                                                              │
│  5. Post to WP (per article)                                 │
│     └─ state → publishing                                    │
│     └─ Create WP post with content + media + category + tags │
│     └─ Store wpPostId                                        │
│     └─ state → published                                     │
│                                                              │
│  PipelineLog created/updated after each step                 │
└─────────────────────────────────────────────────────────────┘
```

### 5.2 Category Rotation Logic

```typescript
// Pseudocode
async function pickCategory(topics: Topic[]): Promise<Topic> {
  // Get last N pipeline logs to determine which categories were used recently
  const recentLogs = await pipelineLogModel
    .find({ status: { $ne: 'running' } })
    .sort({ createdAt: -1 })
    .limit(topics.length)
    .select('categorySlug')
    .lean();

  const recentlyUsed = recentLogs.map(l => l.categorySlug);

  // Find first topic NOT in recentlyUsed (round-robin)
  const nextTopic = topics.find(t => !recentlyUsed.includes(t.slug));

  // If all categories used recently, pick the oldest
  return nextTopic ?? topics[topics.length - 1];
}
```

### 5.3 Error Handling + Retry

**Per-article retry logic:**
```typescript
async function retryArticle(articleId: string): Promise<void> {
  const article = await knowledgeArticleService.getById(articleId);
  
  if (article.pipelineState !== 'failed') {
    throw new BadRequestException('Only failed articles can be retried');
  }

  const failedStep = article.pipelineFailedStep;

  // Resume from the failed step
  if (failedStep <= 2) {
    // Content generation failed → retry writing
    await generateContent(article);
  }
  
  if (article.pipelineState === 'content_ready' && failedStep <= 3) {
    // Image generation failed → retry image
    await generateImage(article);
  }
  
  if (article.pipelineState === 'ready' && failedStep <= 5) {
    // Publish failed → retry publish
    await publishToWP(article);
  }
}
```

**Batch retry:** `POST /knowledge-articles/pipeline/:batchId/retry-failed` — retries all `failed` articles in a batch.

---

## 6. API Endpoint Contracts

### 6.1 Config Endpoints

All under `/api/v1/knowledge-articles/config`.

| Method | Path | Description | Request Body | Response |
|--------|------|-------------|-------------|----------|
| `GET` | `/config/wp` | Get WP connection config | — | `{ data: WpConfig }` |
| `PUT` | `/config/wp` | Update WP connection config | `UpdateWpConfigDto` | `{ message, data: WpConfig }` |
| `GET` | `/config/ai-writing` | Get AI writing config | — | `{ data: AiWritingConfig }` |
| `PUT` | `/config/ai-writing` | Update AI writing config | `UpdateAiWritingConfigDto` | `{ message, data: AiWritingConfig }` |
| `GET` | `/config/ai-image` | Get AI image config | — | `{ data: AiImageConfig }` |
| `PUT` | `/config/ai-image` | Update AI image config | `UpdateAiImageConfigDto` | `{ message, data: AiImageConfig }` |
| `GET` | `/config/cron` | Get cron config | — | `{ data: CronConfig }` |
| `PUT` | `/config/cron` | Update cron config | `UpdateCronConfigDto` | `{ message, data: CronConfig }` |

**Response shapes:**

```typescript
// GET /config/wp
{
  data: {
    siteUrl: "https://example.com",
    username: "admin",
    appPassword: "***",           // Masked on read
    defaultCategoryId: 15,
    categoryMapping: [
      { slug: "ha-noi", wpCategoryId: 16, wpCategoryName: "BĐS Hà Nội" },
      { slug: "hcm", wpCategoryId: 17, wpCategoryName: "BĐS HCM" }
    ],
    defaultTagIds: [1, 2, 3],
    tagMapping: [
      { name: "chung cư", wpTagId: 1 },
      { name: "nhà phố", wpTagId: 2 }
    ]
  }
}
```

```typescript
// GET /config/ai-writing
{
  data: {
    promptTemplate: "Viết bài kiến thức về {{topic}} với chủ đề {{category}}...",
    model: "google/gemini-2.5-flash",
    provider: "OpenRouter",
    maxTokens: 4096,
    temperature: 0.7,
    topics: [
      { slug: "ha-noi", name: "BĐS Hà Nội", description: "..." },
      { slug: "hcm", name: "BĐS HCM", description: "..." }
    ],
    articlesPerBatch: 3
  }
}
```

### 6.2 Knowledge Article Endpoints

All under `/api/v1/knowledge-articles`.

| Method | Path | Description | Request | Response |
|--------|------|-------------|---------|----------|
| `GET` | `/` | List knowledge articles (paginated) | Query: `page, limit, status, category, search, sort` | `{ data: KnowledgeArticle[], meta: PaginationMeta }` |
| `GET` | `/:id` | Get article detail | — | `{ data: KnowledgeArticle }` |
| `POST` | `/:id/retry` | Retry failed article | — | `{ message, data: KnowledgeArticle }` |
| `POST` | `/:id/publish` | Publish ready article to WP | — | `{ message, data: { wpPostId } }` |
| `POST` | `/:id/republish` | Republish (update) existing WP post | — | `{ message, data: { wpPostId } }` |
| `DELETE` | `/:id` | Soft delete knowledge article | — | `{ message }` |
| `POST` | `/bulk/delete` | Bulk soft delete | `{ ids: string[] }` | `{ message }` |
| `POST` | `/bulk/publish` | Bulk publish | `{ ids: string[] }` | `{ message, jobId? }` |

**List query DTO:**
```typescript
class GetKnowledgeArticlesQueryDto extends PaginationQueryDto {
  status?: KnowledgeArticleState;    // Filter by state
  category?: string;                  // Filter by category slug
  search?: string;                    // Search in title
  sort?: 'newest' | 'oldest';        // Default: 'newest'
}
```

### 6.3 Pipeline Endpoints

| Method | Path | Description | Request | Response |
|--------|------|-------------|---------|----------|
| `POST` | `/pipeline/run` | Start batch pipeline | `{ category?: string, articleCount?: number }` | `{ message, jobId }` |
| `GET` | `/pipeline/:jobId` | Poll pipeline status | — | `{ status, currentStep, steps, result?, error? }` |
| `POST` | `/pipeline/:jobId/retry-failed` | Retry all failed articles | — | `{ message, jobId }` |
| `GET` | `/pipeline/logs` | List pipeline logs (paginated) | Query: `page, limit, status, category` | `{ data: PipelineLog[], meta: PaginationMeta }` |
| `GET` | `/pipeline/logs/:batchId` | Get pipeline log detail | — | `{ data: PipelineLog }` |

**Pipeline run response (same pattern as market-analysis-workflow):**
```typescript
// POST /pipeline/run
{
  message: "Pipeline started",
  jobId: "uuid-string"
}

// GET /pipeline/:jobId (while running)
{
  status: "pending",
  currentStep: 2,
  steps: [
    { step: 1, label: "Chọn topics", status: "done", result: { articleCount: 3 } },
    { step: 2, label: "AI viết bài", status: "running" },
    { step: 3, label: "AI sinh ảnh", status: "pending" },
    { step: 4, label: "Upload media", status: "pending" },
    { step: 5, label: "Đăng WP", status: "pending" }
  ]
}

// GET /pipeline/:jobId (when done)
{
  status: "done",
  currentStep: 5,
  steps: [ ... all done ... ],
  result: {
    batchId: "uuid",
    published: 3,
    failed: 0,
    category: "ha-noi"
  }
}
```

### 6.4 NL Cron Endpoints

| Method | Path | Description | Request | Response |
|--------|------|-------------|---------|----------|
| `POST` | `/cron/parse-nl` | Parse NL to cron expression | `{ description: string }` | `{ cronExpression, explanation, schedule }` |
| `POST` | `/cron/preview` | Preview next 5 run times | `{ cronExpression: string }` | `{ nextRuns: string[] }` |
| `PUT` | `/cron/activate` | Save and activate cron | `{ cronExpression, nlDescription }` | `{ message, data: CronConfig }` |
| `POST` | `/cron/test-run` | Manual test run (no schedule) | `{ category?: string, articleCount?: number }` | `{ message, jobId }` |

**NL parse response:**
```typescript
// POST /cron/parse-nl
{
  cronExpression: "0 8 * * 1-5",
  explanation: "Chạy vào 8:00 sáng, từ Thứ 2 đến Thứ 6, hàng tuần",
  schedule: {
    frequency: "weekdays",
    time: "08:00",
    timezone: "Asia/Ho_Chi_Minh"
  }
}
```

---

## 7. Service Method Signatures

### 7.1 KnowledgeArticleService

```typescript
@Injectable()
export class KnowledgeArticleService {
  constructor(
    @InjectModel(NewsArticle.name)
    private readonly newsArticleModel: Model<NewsArticle>,
  ) {}

  // ── CRUD ──
  listArticles(query: GetKnowledgeArticlesQueryDto): Promise<PaginatedResult<KnowledgeArticle>>
  getArticleById(id: string): Promise<KnowledgeArticle>
  deleteArticle(id: string): Promise<void>
  deleteBulkArticles(ids: string[]): Promise<{ deletedCount: number }>

  // ── State machine ──
  updateState(id: string, state: KnowledgeArticleState, extra?: Partial<NewsArticle>): Promise<void>
  markFailed(id: string, step: number, error: string): Promise<void>

  // ── Manual controls ──
  publishToWordPress(id: string): Promise<{ wpPostId: number }>
  republishToWordPress(id: string): Promise<{ wpPostId: number }>

  // ── Batch creation ──
  createBatchArticles(
    batchId: string,
    topics: Array<{ title: string; categorySlug: string; wpCategoryId: number }>
  ): Promise<KnowledgeArticle[]>
}
```

### 7.2 KnowledgeConfigService

```typescript
@Injectable()
export class KnowledgeConfigService {
  constructor(
    @InjectModel(KnowledgeConfig.name)
    private readonly configModel: Model<KnowledgeConfig>,
  ) {}

  getConfig(type: KnowledgeConfigType): Promise<KnowledgeConfig | null>
  updateConfig(type: KnowledgeConfigType, config: Record<string, any>): Promise<KnowledgeConfig>
  getWpConfig(): Promise<WpConfigShape>
  getAiWritingConfig(): Promise<AiWritingConfigShape>
  getAiImageConfig(): Promise<AiImageConfigShape>
  getCronConfig(): Promise<CronConfigShape>
}
```

### 7.3 WpClientService

```typescript
@Injectable()
export class WpClientService {
  constructor(
    private readonly configService: KnowledgeConfigService,
    private readonly logger: Logger,
  ) {}

  /** Create a new WP post. Returns { postId, postUrl } */
  async createPost(post: {
    title: string;
    content: string;         // HTML
    status: 'publish' | 'draft';
    categories: number[];
    tags: number[];
    featuredMedia?: number;  // WP media ID
  }): Promise<{ postId: number; postUrl: string }>

  /** Update an existing WP post. Returns { postId, postUrl } */
  async updatePost(postId: number, post: Partial<{
    title: string;
    content: string;
    categories: number[];
    tags: number[];
    featuredMedia: number;
  }>): Promise<{ postId: number; postUrl: string }>

  /** Upload media to WP. Returns { mediaId, mediaUrl } */
  async uploadMedia(file: Buffer, filename: string, mimeType: string): Promise<{ mediaId: number; mediaUrl: string }>

  /** Get all categories from WP */
  async getCategories(): Promise<Array<{ id: number; name: string; slug: string }>>

  /** Get or create tag by name. Returns tag ID */
  async getOrCreateTag(name: string): Promise<number>

  /** Verify WP connection (health check) */
  async verifyConnection(): Promise<{ valid: boolean; siteName?: string; error?: string }>
}
```

**Authentication:** WordPress Application Passwords via Basic Auth header:
```
Authorization: Basic base64(username:app_password)
```

### 7.4 AiWritingService

```typescript
@Injectable()
export class AiWritingService {
  constructor(
    private readonly configService: KnowledgeConfigService,
    // Uses same AI API patterns as existing AIFilterService
  ) {}

  /** Generate article content for a topic */
  async generateContent(params: {
    topic: string;
    category: string;
    topicDescription: string;
  }): Promise<{
    title: string;
    content: string;          // Markdown
    htmlContent: string;      // Rendered HTML for WP
    summary: string;
    tags: string[];
  }>
}
```

### 7.5 AiImageService

```typescript
@Injectable()
export class AiImageService {
  constructor(
    private readonly configService: KnowledgeConfigService,
  ) {}

  /** Generate featured image for an article */
  async generateFeaturedImage(params: {
    title: string;
    contentSummary: string;
  }): Promise<{ imageUrl: string; buffer: Buffer }>

  /** Generate inline images for content sections */
  async generateInlineImages(params: {
    sections: Array<{ heading: string; description: string }>;
  }): Promise<Array<{ imageUrl: string; buffer: Buffer; forSection: string }>>
}
```

### 7.6 PipelineService

```typescript
@Injectable()
export class PipelineService {
  constructor(
    private readonly knowledgeArticleService: KnowledgeArticleService,
    private readonly knowledgeConfigService: KnowledgeConfigService,
    private readonly aiWritingService: AiWritingService,
    private readonly aiImageService: AiImageService,
    private readonly wpClientService: WpClientService,
    private readonly pipelineLogService: PipelineLogService,
    private readonly idempotencyService: IdempotencyService,
    private readonly auditLogService: AuditLogService,
    private readonly analyzeJobService: AnalyzeJobService,
  ) {}

  /** Start batch pipeline — returns immediately with jobId */
  startPipeline(params?: {
    category?: string;
    articleCount?: number;
  }): { message: string; jobId: string }

  /** Internal: run the 5-step pipeline */
  private async runPipeline(
    jobId: string,
    batchId: string,
    categorySlug: string | undefined,
    articleCount: number,
    lockKey: string,
  ): Promise<void>

  /** Retry all failed articles in a batch */
  retryFailedArticles(batchId: string): Promise<{ retriedCount: number }>
}
```

### 7.7 NlCronService

```typescript
@Injectable()
export class NlCronService {
  constructor(
    private readonly knowledgeConfigService: KnowledgeConfigService,
    // Uses AI API to parse NL → cron
  ) {}

  /** Parse natural language description to cron expression */
  async parseDescription(description: string): Promise<{
    cronExpression: string;
    explanation: string;
    schedule: Record<string, string>;
  }>

  /** Preview next N execution times from cron expression */
  previewSchedule(cronExpression: string, count?: number): string[]

  /** Activate schedule: save to config + register with SchedulerRegistry */
  async activateSchedule(cronExpression: string, nlDescription: string): Promise<void>
}
```

---

## 8. NL → Cron Parsing Approach

### 8.1 Flow

```
User writes: "Chạy hàng ngày lúc 8h sáng từ thứ 2 đến thứ 6"
         │
         ▼
  ┌─────────────────────────┐
  │  AI Prompt:             │
  │  "Convert this Vietnamese│
  │   schedule description  │
  │   to a cron expression. │
  │   Return JSON:          │
  │   { cron, explanation }"│
  └────────┬────────────────┘
           │
           ▼
  AI Response:
  {
    cron: "0 8 * * 1-5",
    explanation: "Thứ 2-6, 8:00 sáng"
  }
         │
         ▼
  ┌─────────────────────────┐
  │  Preview: Show next 5   │
  │  execution times        │
  └────────┬────────────────┘
           │
           ▼
  ┌─────────────────────────┐
  │  Confirm → Activate     │
  └─────────────────────────┘
```

### 8.2 AI Prompt for NL → Cron

```typescript
const NL_TO_CRON_PROMPT = `You are a cron expression parser. Convert the user's natural language schedule description into a standard Unix cron expression.

Rules:
- Default timezone: Asia/Ho_Chi_Minh (UTC+7)
- If no time specified, default to 08:00
- "hàng ngày" = every day (0 * * * *)
- "ngày làm việc" / "thứ 2 đến thứ 6" = Mon-Fri (0 * * * 1-5)
- "mỗi tuần" = once a week
- "mỗi tháng" = once a month
- Support Vietnamese and English input

Return ONLY a JSON object:
{
  "cron": "<cron expression>",
  "explanation": "<human-readable explanation in Vietnamese>",
  "schedule": {
    "frequency": "daily|weekdays|weekly|monthly",
    "time": "HH:MM",
    "timezone": "Asia/Ho_Chi_Minh"
  }
}`;
```

### 8.3 Scheduler Integration

The cron job is registered with `@nestjs/schedule`'s `SchedulerRegistry`, same pattern as existing `CronjobService`:

```typescript
private startCronJob(cronExpression: string) {
  const job = new CronJob(cronExpression, async () => {
    await this.pipelineService.startPipeline();
  });
  this.schedulerRegistry.addCronJob('knowledge_articles_daily', job);
  job.start();
}
```

On `updateConfig`, the old job is deleted and a new one is registered (same pattern as `CronjobService.updateConfig`).

---

## 9. Frontend Structure

### 9.1 Screens

```
RealEstateAdminApp/src/screens/
├── KnowledgeArticlesScreen.tsx     ← Main list + detail + manual controls
├── KnowledgeConfigScreen.tsx       ← WP, AI Writing, AI Image config tabs
└── KnowledgeCronScreen.tsx         ← NL cron config + pipeline logs
```

### 9.2 Component/Hook Breakdown

#### KnowledgeArticlesScreen.tsx
```typescript
// State management
- useQuery(['knowledge-articles', { page, limit, status, category }])  // Article list
- useMutation (retry)                                                  // POST /:id/retry
- useMutation (publish)                                                // POST /:id/publish
- useMutation (republish)                                              // POST /:id/republish
- useMutation (bulk delete)                                            // POST /bulk/delete
- useMutation (bulk publish)                                           // POST /bulk/publish

// Local state (useState)
- searchTerm, statusFilter, categoryFilter, page, limit
- selectedIds, notification

// Components
- ArticleTable            ← Paginated table with status badges
- ArticleDetailModal      ← Full article view (content + images)
- StatusBadge             ← Color-coded pipeline state indicator
- RetryButton / PublishButton / RepublishButton
```

#### KnowledgeConfigScreen.tsx
```typescript
// State management
- useQuery(['knowledge-config', 'wp'])         // WP config
- useQuery(['knowledge-config', 'ai-writing'])  // AI writing config
- useQuery(['knowledge-config', 'ai-image'])    // AI image config
- useMutation (save wp config)
- useMutation (save ai writing config)
- useMutation (save ai image config)
- useMutation (verify WP connection)

// Tab layout: [WP Connection] [AI Writing] [AI Image]
// Each tab: form fields + Save button
```

#### KnowledgeCronScreen.tsx
```typescript
// State management
- useQuery(['knowledge-config', 'cron'])        // Cron config
- useQuery(['knowledge-pipeline-logs', { page }]) // Pipeline logs
- useMutation (parse NL)
- useMutation (activate cron)
- useMutation (manual test run)

// Components
- NlInput               ← Textarea for NL description
- CronPreview           ← Show parsed cron + next run times
- CronStatus            ← Active/inactive toggle + schedule display
- PipelineLogTable      ← Paginated list of pipeline runs
- PipelineLogDetail     ← Expandable row showing per-article results
```

### 9.3 API Layer

```
RealEstateAdminApp/src/api/
└── knowledge-articles.api.ts    ← All API calls for knowledge articles
```

```typescript
// knowledge-articles.api.ts

// Config
export async function getWpConfig(signal?: AbortSignal): Promise<WpConfig>
export async function saveWpConfig(payload: UpdateWpConfigPayload): Promise<void>
export async function getAiWritingConfig(signal?: AbortSignal): Promise<AiWritingConfig>
export async function saveAiWritingConfig(payload: UpdateAiWritingPayload): Promise<void>
export async function getAiImageConfig(signal?: AbortSignal): Promise<AiImageConfig>
export async function saveAiImageConfig(payload: UpdateAiImagePayload): Promise<void>
export async function getCronConfig(signal?: AbortSignal): Promise<KnowledgeCronConfig>
export async function saveCronConfig(payload: UpdateCronPayload): Promise<void>

// Articles
export async function getKnowledgeArticles(params: ListParams, signal?: AbortSignal): Promise<PaginatedResponse<KnowledgeArticle>>
export async function getKnowledgeArticle(id: string, signal?: AbortSignal): Promise<KnowledgeArticle>
export async function retryArticle(id: string): Promise<void>
export async function publishArticle(id: string): Promise<{ wpPostId: number }>
export async function republishArticle(id: string): Promise<{ wpPostId: number }>
export async function deleteKnowledgeArticle(id: string): Promise<void>
export async function bulkDeleteKnowledgeArticles(ids: string[]): Promise<void>
export async function bulkPublishKnowledgeArticles(ids: string[]): Promise<{ jobId?: string }>

// Pipeline
export async function startPipeline(params?: { category?: string; articleCount?: number }): Promise<{ jobId: string }>
export async function getPipelineStatus(jobId: string, signal?: AbortSignal): Promise<PipelineStatus>
export async function retryFailedArticles(batchId: string): Promise<void>
export async function getPipelineLogs(params: ListParams, signal?: AbortSignal): Promise<PaginatedResponse<PipelineLog>>
export async function getPipelineLogDetail(batchId: string, signal?: AbortSignal): Promise<PipelineLog>

// NL Cron
export async function parseNlSchedule(description: string): Promise<NlParseResult>
export async function previewSchedule(cronExpression: string): Promise<{ nextRuns: string[] }>
export async function activateSchedule(payload: ActivateSchedulePayload): Promise<void>
export async function testRunPipeline(params?: { category?: string; articleCount?: number }): Promise<{ jobId: string }>
```

---

## 10. Controller Method Signatures

```typescript
@ApiTags('Knowledge Articles')
@Controller('knowledge-articles')
export class KnowledgeArticlesController {
  constructor(
    private readonly knowledgeArticleService: KnowledgeArticleService,
    private readonly knowledgeConfigService: KnowledgeConfigService,
    private readonly pipelineService: PipelineService,
    private readonly nlCronService: NlCronService,
    private readonly wpClientService: WpClientService,
    private readonly idempotencyService: IdempotencyService,
    private readonly auditLogService: AuditLogService,
    private readonly analyzeJobService: AnalyzeJobService,
  ) {}

  // ── Config ──
  @Get('config/wp')
  getWpConfig()

  @Put('config/wp')
  updateWpConfig(@Body() body: UpdateWpConfigDto)

  @Get('config/ai-writing')
  getAiWritingConfig()

  @Put('config/ai-writing')
  updateAiWritingConfig(@Body() body: UpdateAiWritingConfigDto)

  @Get('config/ai-image')
  getAiImageConfig()

  @Put('config/ai-image')
  updateAiImageConfig(@Body() body: UpdateAiImageConfigDto)

  @Get('config/cron')
  getCronConfig()

  @Put('config/cron')
  updateCronConfig(@Body() body: UpdateKnowledgeCronConfigDto)

  @Post('config/wp/verify')
  verifyWpConnection()

  // ── Articles ──
  @Get('/')
  getKnowledgeArticles(@Query() query: GetKnowledgeArticlesQueryDto)

  @Get('/:id')
  getKnowledgeArticleById(@Param('id') id: string)

  @Post('/:id/retry')
  retryArticle(@Param('id') id: string)

  @Post('/:id/publish')
  publishArticle(@Param('id') id: string, @Headers('x-idempotency-key') idempotencyKey?: string)

  @Post('/:id/republish')
  republishArticle(@Param('id') id: string, @Headers('x-idempotency-key') idempotencyKey?: string)

  @Delete('/:id')
  deleteKnowledgeArticle(@Param('id') id: string)

  @Post('/bulk/delete')
  bulkDeleteArticles(@Body() body: BulkIdsDto)

  @Post('/bulk/publish')
  bulkPublishArticles(@Body() body: BulkIdsDto, @Headers('x-idempotency-key') idempotencyKey?: string)

  // ── Pipeline ──
  @Post('/pipeline/run')
  startPipeline(@Body() body?: RunPipelineDto)

  @Get('/pipeline/:jobId')
  getPipelineStatus(@Param('jobId') jobId: string)

  @Post('/pipeline/:jobId/retry-failed')
  retryFailedArticles(@Param('jobId') jobId: string)

  @Get('/pipeline/logs')
  getPipelineLogs(@Query() query: GetPipelineLogsQueryDto)

  @Get('/pipeline/logs/:batchId')
  getPipelineLogDetail(@Param('batchId') batchId: string)

  // ── NL Cron ──
  @Post('/cron/parse-nl')
  parseNlSchedule(@Body() body: ParseNlDto)

  @Post('/cron/preview')
  previewSchedule(@Body() body: PreviewScheduleDto)

  @Put('/cron/activate')
  activateSchedule(@Body() body: ActivateScheduleDto)

  @Post('/cron/test-run')
  testRunPipeline(@Body() body?: RunPipelineDto)
}
```

---

## 11. Pipeline Log Design

### 11.1 What Gets Logged

Every pipeline execution (cron or manual) creates one `PipelineLog` document:

```typescript
{
  batchId: "knowledge-batch-2026-08-16-001",
  categorySlug: "ha-noi",
  source: "cron",                  // "cron" | "manual"
  status: "completed",             // "running" | "completed" | "failed" | "partial"
  totalArticles: 3,
  publishedCount: 2,
  failedCount: 1,
  readyCount: 0,
  articleResults: [
    {
      articleId: ObjectId("..."),
      title: "Xu hướng chung cư Hà Nội 2026",
      state: "published",
      wpPostId: 12345,
      duration: 45000
    },
    {
      articleId: ObjectId("..."),
      title: "Giá nhà quận Cầu Giấy",
      state: "published",
      wpPostId: 12346,
      duration: 38000
    },
    {
      articleId: ObjectId("..."),
      title: "Dự án mới Long Biên",
      state: "failed",
      error: "WP API returned 500: Internal Server Error",
      failedStep: 5,
      duration: 52000
    }
  ],
  steps: [
    { step: 1, label: "Chọn topics", status: "done", startedAt: "...", completedAt: "..." },
    { step: 2, label: "AI viết bài", status: "done", startedAt: "...", completedAt: "..." },
    { step: 3, label: "AI sinh ảnh", status: "done", startedAt: "...", completedAt: "..." },
    { step: 4, label: "Upload media", status: "done", startedAt: "...", completedAt: "..." },
    { step: 5, label: "Đăng WP", status: "done", startedAt: "...", completedAt: "..." }
  ],
  totalDuration: 135000,
  errorSummary: null
}
```

### 11.2 Pipeline Log Service

```typescript
@Injectable()
export class PipelineLogService {
  constructor(
    @InjectModel(PipelineLog.name)
    private readonly logModel: Model<PipelineLog>,
  ) {}

  /** Create a new pipeline run log */
  async createLog(params: {
    batchId: string;
    categorySlug: string;
    source: 'cron' | 'manual';
  }): Promise<PipelineLog>

  /** Update article result in the log */
  async addArticleResult(batchId: string, result: {
    articleId: Types.ObjectId;
    title: string;
    state: string;
    error?: string;
    failedStep?: number;
    wpPostId?: number;
    duration: number;
  }): Promise<void>

  /** Update step status */
  async updateStep(batchId: string, step: number, patch: {
    status: 'pending' | 'running' | 'done' | 'error';
    result?: unknown;
    error?: string;
  }): Promise<void>

  /** Mark pipeline as completed/failed */
  async finalizeLog(batchId: string, status: PipelineRunStatus, summary?: {
    publishedCount: number;
    failedCount: number;
    readyCount: number;
    errorSummary?: string;
  }): Promise<void>

  /** Paginated list */
  async listLogs(query: { page: number; limit: number; status?: string; category?: string }):
    Promise<PaginatedResult<PipelineLog>>

  /** Get detail by batchId */
  async getLogByBatchId(batchId: string): Promise<PipelineLog | null>
}
```

---

## 12. File Manifest

| File | Action | Description |
|------|--------|-------------|
| `RealEstateBackendApp/src/modules/knowledge-articles/knowledge-articles.module.ts` | NEW | Module definition |
| `RealEstateBackendApp/src/modules/knowledge-articles/knowledge-articles.controller.ts` | NEW | Controller with all endpoints |
| `RealEstateBackendApp/src/modules/knowledge-articles/dtos/knowledge-config.dto.ts` | NEW | Config DTOs |
| `RealEstateBackendApp/src/modules/knowledge-articles/dtos/knowledge-article.dto.ts` | NEW | Article list/detail DTOs |
| `RealEstateBackendApp/src/modules/knowledge-articles/dtos/nl-cron.dto.ts` | NEW | NL cron DTOs |
| `RealEstateBackendApp/src/modules/knowledge-articles/schemas/knowledge-config.schema.ts` | NEW | Config schema |
| `RealEstateBackendApp/src/modules/knowledge-articles/schemas/pipeline-log.schema.ts` | NEW | Pipeline log schema |
| `RealEstateBackendApp/src/modules/knowledge-articles/services/knowledge-article.service.ts` | NEW | Article CRUD + state machine |
| `RealEstateBackendApp/src/modules/knowledge-articles/services/knowledge-config.service.ts` | NEW | Config CRUD |
| `RealEstateBackendApp/src/modules/knowledge-articles/services/wp-client.service.ts` | NEW | WP REST API client |
| `RealEstateBackendApp/src/modules/knowledge-articles/services/ai-writing.service.ts` | NEW | AI content generation |
| `RealEstateBackendApp/src/modules/knowledge-articles/services/ai-image.service.ts` | NEW | AI image generation |
| `RealEstateBackendApp/src/modules/knowledge-articles/services/pipeline.service.ts` | NEW | Pipeline orchestration |
| `RealEstateBackendApp/src/modules/knowledge-articles/services/pipeline-log.service.ts` | NEW | Pipeline log CRUD |
| `RealEstateBackendApp/src/modules/knowledge-articles/services/nl-cron.service.ts` | NEW | NL → cron parsing |
| `RealEstateBackendApp/src/modules/knowledge-articles/types/knowledge-article-state.ts` | NEW | State enum |
| `RealEstateBackendApp/src/modules/knowledge-articles/types/knowledge-pipeline-state.ts` | NEW | Pipeline step types |
| `RealEstateBackendApp/src/modules/news-fire-crawl-manager/schemas/news-article.schema.ts` | EDIT | Add `type` and knowledge-specific fields |
| `RealEstateBackendApp/src/app.module.ts` | EDIT | Register `KnowledgeArticlesModule` |
| `RealEstateAdminApp/src/screens/KnowledgeArticlesScreen.tsx` | NEW | Article list + detail screen |
| `RealEstateAdminApp/src/screens/KnowledgeConfigScreen.tsx` | NEW | Config tabs screen |
| `RealEstateAdminApp/src/screens/KnowledgeCronScreen.tsx` | NEW | NL cron + pipeline logs screen |
| `RealEstateAdminApp/src/api/knowledge-articles.api.ts` | NEW | API layer |

---

## 13. Cross-Cutting Concerns

### 13.1 Lock Strategy

| Lock Key | Used By | Purpose |
|----------|---------|---------|
| `knowledge-pipeline:global` | POST /pipeline/run, POST /cron/test-run | Prevents concurrent pipeline runs |
| `knowledge-publish:{id}` | POST /:id/publish, POST /:id/republish | Prevents double-publish of same article |

Follows existing `IdempotencyService` pattern from `news-fire-crawl-manager`.

### 13.2 Idempotency

Publish/republish endpoints use `x-idempotency-key` header, same pattern as existing `publishBulkArticles`.

### 13.3 Audit Logging

All destructive/writes operations logged via existing `AuditLogService`:

```typescript
enum AuditAction {
  // ... existing values ...
  KNOWLEDGE_ARTICLE_PUBLISH = 'KNOWLEDGE_ARTICLE_PUBLISH',
  KNOWLEDGE_ARTICLE_REPUBLISH = 'KNOWLEDGE_ARTICLE_REPUBLISH',
  KNOWLEDGE_ARTICLE_DELETE = 'KNOWLEDGE_ARTICLE_DELETE',
  KNOWLEDGE_PIPELINE_RUN = 'KNOWLEDGE_PIPELINE_RUN',
}
```

### 13.4 Error Handling

| Scenario | Handling |
|----------|----------|
| WP API down during publish | Article → `failed`, error logged, retry available |
| AI API timeout during writing | Article → `failed` at `generating_content` step, retry available |
| AI API timeout during image gen | Article → `failed` at `generating_image` step, retry available |
| WP media upload fails | Article → `failed` at step 4, retry available |
| Config not set (WP/AI) | Throw `BadRequestException('Chưa cấu hình WP/AI')` before pipeline start |
| Pipeline lock conflict | Throw `ConflictException('Đang có pipeline chạy')` |
| Invalid cron expression | Throw `BadRequestException` with validation message |

---

## 14. Dependencies

**Backend:**
- `@nestjs/schedule` + `cron` — already in project (used by `CronjobService`)
- `node-fetch` or built-in `fetch` — WP REST API HTTP calls
- `axios` — reuse existing `apiAxios` pattern for AI API calls

**Frontend:**
- `@tanstack/react-query` — data fetching (existing)
- `react-router-dom` — routing (existing)
- `lucide-react` — icons (existing)

**No new npm packages required.**

---

## 15. Migration & Backward Compatibility

1. **No data migration needed.** Existing `news_articles` documents have no `type` field → query `find({ type: 'knowledge' })` returns only new documents.

2. **Schema addition is backward compatible.** All new fields on `NewsArticle` are optional with defaults. Existing documents are unaffected.

3. **Existing news article publishing is untouched.** The `publishToWordPress` method in `NewsArticleService` remains as-is. Knowledge articles use the new `WpClientService` directly (injected into `KnowledgeArticleService`).

4. **The mock `WordPressService` stays for news articles** until explicitly migrated. Knowledge articles bypass it entirely.

---

## 16. Verification Checklist

- [ ] All intent requirements from `knowledge-articles-auto-publish.md` covered
- [ ] State machine matches intent doc exactly (7 states + failed)
- [ ] Manual controls (retry/publish/republish) match intent spec
- [ ] Config CRUD supports all 4 config types
- [ ] NL → cron flow includes parse + preview + activate
- [ ] Pipeline log design supports per-article detail
- [ ] API contracts follow existing `{ data, meta }` convention
- [ ] Lock strategy prevents concurrent pipeline runs
- [ ] All new files listed in File Manifest
- [ ] No changes to existing news article functionality
- [ ] Frontend structure follows existing React Query patterns
