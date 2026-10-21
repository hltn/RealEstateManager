import type {
  KnowledgeArticle,
  NlParseResult,
  PipelineLog,
  PipelineStatus,
} from '../../api/knowledge-articles.api';
import {
  aiImageConfig,
  aiWritingConfig,
  batchIdOf,
  buildDoneSteps,
  buildKnowledgeContent,
  knowledgeArticles,
  knowledgeCronConfig,
  pipelineLogs,
  wpConfig,
} from '../data/knowledge';
import { thumbnailFor } from '../data/news';
import type { MockRoute } from '../types';
import { fail, filterBySearch, mockObjectId, ok, paginate } from '../utils';
import { asRecord, mockJobId, readIds, readString, sortByDate } from './shared';

/**
 * `/knowledge-articles/*` — bài viết kiến thức do AI viết + đăng WordPress.
 * Lưu ý thứ tự route: `config/*`, `bulk/*`, `pipeline/logs*`, `cron/*` phải đứng trước `/:id`.
 */

const KB = '\\/knowledge-articles';
const route = (suffix: string): RegExp => new RegExp(`^${KB}${suffix}$`);

// ── Helpers ──────────────────────────────────────────────

const findArticle = (id: string): KnowledgeArticle | undefined =>
  knowledgeArticles.find((article) => article._id === id);

let nextWpPostId = 5_100;

/** Đăng bài: gán wpPostId (nếu chưa có), chuyển trạng thái PUBLISHED, xoá lỗi cũ. */
const markPublished = (article: KnowledgeArticle): number => {
  if (!article.wpPostId) {
    nextWpPostId += 1;
    article.wpPostId = nextWpPostId;
  }
  article.pipelineState = 'published';
  article.pipelineError = null;
  article.pipelineFailedStep = null;
  article.updatedAt = new Date().toISOString();
  return article.wpPostId;
};

/** Ghi đè các field hợp lệ từ body vào object cấu hình (mutate tại chỗ, chỉ khi cùng kiểu dữ liệu). */
const mergeConfig = <T extends object>(target: T, body: unknown): T => {
  const payload = asRecord(body);
  const record = target as Record<string, unknown>;
  Object.keys(record).forEach((key) => {
    const incoming = payload[key];
    if (incoming === undefined) return;
    const current = record[key];
    const sameKind =
      current === null || (Array.isArray(current) === Array.isArray(incoming) && typeof current === typeof incoming);
    if (sameKind) record[key] = incoming;
  });
  return target;
};

// ── Pipeline giả lập ─────────────────────────────────────

const pipelineJobs = new Map<string, PipelineStatus>();
let batchCounter = 10;

/**
 * Chạy pipeline "tức thì": tạo N bài mới (đã đăng WP), ghi log và lưu trạng thái job `done`
 * để màn hình poll `GET /pipeline/:jobId` dừng ngay ở lần đầu.
 */
const runPipeline = (body: unknown, source: 'cron' | 'manual'): string => {
  const payload = asRecord(body);
  const category = readString(body, 'category') ?? aiWritingConfig.topics[0]?.slug ?? 'phap-ly';
  const requestedCount = typeof payload.articleCount === 'number' ? payload.articleCount : aiWritingConfig.articlesPerBatch;
  const count = Math.min(Math.max(1, requestedCount), 5);
  const topic = aiWritingConfig.topics.find((item) => item.slug === category);
  const now = new Date().toISOString();

  batchCounter += 1;
  const batchId = batchIdOf(batchCounter);
  const created: KnowledgeArticle[] = Array.from({ length: count }, (_, index) => {
    const title = `${topic?.name ?? 'Kiến thức nhà đất'}: Hỏi đáp chuyên sâu số ${batchCounter}.${index + 1}`;
    nextWpPostId += 1;
    return {
      _id: mockObjectId(),
      title,
      content: buildKnowledgeContent(title),
      summary: `Hướng dẫn chi tiết: ${title}.`,
      pipelineState: 'published',
      pipelineError: null,
      pipelineFailedStep: null,
      wpCategoryId: wpConfig.categoryMapping.find((item) => item.slug === category)?.wpCategoryId ?? wpConfig.defaultCategoryId,
      wpTagIds: [...wpConfig.defaultTagIds],
      wpPostId: nextWpPostId,
      featuredImageUrl: thumbnailFor(`${batchId}-${index}`),
      inlineImageUrls: [],
      categorySlug: category,
      batchId,
      createdAt: now,
      updatedAt: now,
    };
  });
  knowledgeArticles.unshift(...created);

  const steps = buildDoneSteps(now);
  const log: PipelineLog = {
    _id: mockObjectId(),
    batchId,
    categorySlug: category,
    source,
    status: 'completed',
    totalArticles: count,
    publishedCount: count,
    failedCount: 0,
    readyCount: 0,
    articleResults: created.map((article) => ({
      articleId: article._id,
      title: article.title ?? '',
      state: 'published',
      wpPostId: article.wpPostId ?? undefined,
      duration: 41_000,
    })),
    steps,
    totalDuration: 41_000 * count,
    errorSummary: null,
    createdAt: now,
  };
  pipelineLogs.unshift(log);
  knowledgeCronConfig.lastRunAt = now;

  const jobId = mockJobId('kb-pipeline');
  pipelineJobs.set(jobId, {
    status: 'done',
    currentStep: steps.length,
    steps,
    result: { batchId, published: count, failed: 0, category },
  });
  return jobId;
};

// ── Cron: parse ngôn ngữ tự nhiên + preview ──────────────

// Không dùng `\b` vì JS coi chữ có dấu (ư, ả...) là non-word → dùng lookahead "khoảng trắng/dấu câu/hết chuỗi".
const END = '(?=[\\s,.;]|$)';
const DAY_WORDS: [RegExp, number][] = [
  [new RegExp(`(chủ nhật|(^|\\s)cn)${END}`), 0],
  [new RegExp(`thứ (2|hai)${END}`), 1],
  [new RegExp(`thứ (3|ba)${END}`), 2],
  [new RegExp(`thứ (4|tư)${END}`), 3],
  [new RegExp(`thứ (5|năm)${END}`), 4],
  [new RegExp(`thứ (6|sáu)${END}`), 5],
  [new RegExp(`thứ (7|bảy)${END}`), 6],
];

const DAY_NAMES = ['Chủ nhật', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7'];

/**
 * Parser NL rất đơn giản cho prototype:
 * - Giờ: "8h", "8 giờ 30", "20:15"; có "chiều/tối" và giờ < 12 → +12.
 * - Tần suất: "mỗi giờ" → hàng giờ; "thứ X"/"chủ nhật" → hàng tuần; "đầu tháng"/"hàng tháng" → ngày 1; còn lại → hàng ngày.
 */
const parseNaturalLanguage = (description: string): NlParseResult => {
  const text = description.toLowerCase();
  const timeMatch = /(\d{1,2})\s*(?:h|giờ|:)\s*(\d{1,2})?/.exec(text);
  let hour = timeMatch ? Math.min(Number(timeMatch[1]), 23) : 8;
  const minute = timeMatch?.[2] ? Math.min(Number(timeMatch[2]), 59) : 0;
  if (/(chiều|tối)/.test(text) && hour < 12) hour += 12;
  const time = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  const schedule = (frequency: string) => ({ frequency, time, timezone: 'Asia/Ho_Chi_Minh' });

  if (/(mỗi|hàng) giờ/.test(text)) {
    return {
      cronExpression: `${minute} * * * *`,
      explanation: `Chạy vào phút thứ ${minute} của mỗi giờ`,
      schedule: { ...schedule('hourly'), time: `--:${String(minute).padStart(2, '0')}` },
    };
  }
  const days = DAY_WORDS.filter(([pattern]) => pattern.test(text)).map(([, day]) => day);
  if (days.length > 0) {
    return {
      cronExpression: `${minute} ${hour} * * ${days.join(',')}`,
      explanation: `Chạy lúc ${time} vào ${days.map((day) => DAY_NAMES[day]).join(', ')} hàng tuần`,
      schedule: schedule('weekly'),
    };
  }
  if (/(đầu tháng|hàng tháng|mỗi tháng)/.test(text)) {
    return {
      cronExpression: `${minute} ${hour} 1 * *`,
      explanation: `Chạy lúc ${time} ngày 1 hàng tháng`,
      schedule: schedule('monthly'),
    };
  }
  return {
    cronExpression: `${minute} ${hour} * * *`,
    explanation: `Chạy lúc ${time} mỗi ngày`,
    schedule: schedule('daily'),
  };
};

/** Mở rộng 1 trường cron (`*`, `*\/n`, `a-b`, `a,b`, số) thành danh sách giá trị. */
const expandCronField = (field: string, min: number, max: number): number[] => {
  const values = new Set<number>();
  field.split(',').forEach((part) => {
    const [rangePart, stepPart] = part.split('/');
    const step = stepPart ? Math.max(1, Number(stepPart)) : 1;
    let start = min;
    let end = max;
    if (rangePart !== '*') {
      const [from, to] = rangePart.split('-').map(Number);
      start = from;
      end = to ?? (stepPart ? max : from);
    }
    for (let value = start; value <= end; value += step) {
      if (value >= min && value <= max) values.add(value);
    }
  });
  return [...values].sort((a, b) => a - b);
};

/** Tính 5 lần chạy kế tiếp (giờ local) — duyệt tối đa 400 ngày tới. */
const previewNextRuns = (cronExpression: string, count = 5): string[] | null => {
  const fields = cronExpression.trim().split(/\s+/);
  if (fields.length !== 5) return null;
  const [minuteField, hourField, domField, monthField, dowField] = fields;
  const minutes = expandCronField(minuteField, 0, 59);
  const hours = expandCronField(hourField, 0, 23);
  const doms = expandCronField(domField, 1, 31);
  const months = expandCronField(monthField, 1, 12);
  const dows = expandCronField(dowField, 0, 6);
  if ([minutes, hours, doms, months, dows].some((list) => list.length === 0)) return null;

  const now = new Date();
  const runs: string[] = [];
  for (let dayOffset = 0; dayOffset < 400 && runs.length < count; dayOffset += 1) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + dayOffset);
    if (!months.includes(day.getMonth() + 1) || !doms.includes(day.getDate()) || !dows.includes(day.getDay())) continue;
    for (const hour of hours) {
      for (const minute of minutes) {
        const run = new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, minute);
        if (run > now && runs.length < count) runs.push(run.toISOString());
      }
    }
  }
  return runs;
};

// ── Routes ───────────────────────────────────────────────

export const knowledgeArticlesRoutes: MockRoute[] = [
  // ----- Cấu hình -----
  { method: 'GET', pattern: route('\\/config\\/wp'), handler: () => ok({ data: wpConfig }) },
  {
    method: 'PUT',
    pattern: route('\\/config\\/wp'),
    handler: ({ body }) => {
      const payload = asRecord(body);
      // UI gửi lại mật khẩu đã che → giữ nguyên, không ghi đè.
      if (typeof payload.appPassword === 'string' && (payload.appPassword.includes('•') || payload.appPassword.includes('*'))) {
        delete payload.appPassword;
      }
      mergeConfig(wpConfig, payload);
      if (typeof payload.appPassword === 'string' && payload.appPassword) wpConfig.appPassword = '••••••••••••';
      return ok({ message: 'Đã lưu cấu hình WordPress', data: wpConfig });
    },
  },
  {
    method: 'POST',
    pattern: route('\\/config\\/wp\\/verify'),
    handler: () =>
      ok({
        data: wpConfig.siteUrl
          ? { valid: true, siteName: 'STND Kiến thức Bất động sản' }
          : { valid: false, error: 'Chưa cấu hình Site URL' },
      }),
  },
  { method: 'GET', pattern: route('\\/config\\/ai-writing'), handler: () => ok({ data: aiWritingConfig }) },
  {
    method: 'PUT',
    pattern: route('\\/config\\/ai-writing'),
    handler: ({ body }) => ok({ message: 'Đã lưu cấu hình AI viết bài', data: mergeConfig(aiWritingConfig, body) }),
  },
  { method: 'GET', pattern: route('\\/config\\/ai-image'), handler: () => ok({ data: aiImageConfig }) },
  {
    method: 'PUT',
    pattern: route('\\/config\\/ai-image'),
    handler: ({ body }) => ok({ message: 'Đã lưu cấu hình AI tạo ảnh', data: mergeConfig(aiImageConfig, body) }),
  },
  {
    method: 'POST',
    pattern: route('\\/config\\/ai-image\\/test'),
    handler: () =>
      ok({
        data: {
          imageUrl: `https://picsum.photos/seed/stnd-test-${Date.now().toString(36)}/${aiImageConfig.width}/${aiImageConfig.height}`,
        },
      }),
  },
  { method: 'GET', pattern: route('\\/config\\/cron'), handler: () => ok({ data: knowledgeCronConfig }) },
  {
    method: 'PUT',
    pattern: route('\\/config\\/cron'),
    handler: ({ body }) => ok({ message: 'Đã lưu cấu hình cron', data: mergeConfig(knowledgeCronConfig, body) }),
  },

  // ----- Cron NL -----
  {
    method: 'POST',
    pattern: route('\\/cron\\/parse-nl'),
    handler: ({ body, path }) => {
      const description = readString(body, 'description')?.trim();
      if (!description) return fail(400, 'Vui lòng nhập mô tả lịch chạy', path);
      return ok({ data: parseNaturalLanguage(description) });
    },
  },
  {
    method: 'POST',
    pattern: route('\\/cron\\/preview'),
    handler: ({ body, path }) => {
      const nextRuns = previewNextRuns(readString(body, 'cronExpression') ?? '');
      return nextRuns ? ok({ data: { nextRuns } }) : fail(400, 'Biểu thức cron không hợp lệ', path);
    },
  },
  {
    method: 'PUT',
    pattern: route('\\/cron\\/activate'),
    handler: ({ body, path }) => {
      const cronExpression = readString(body, 'cronExpression') ?? '';
      const nextRuns = previewNextRuns(cronExpression, 1);
      if (!nextRuns) return fail(400, 'Biểu thức cron không hợp lệ', path);
      knowledgeCronConfig.isActive = true;
      knowledgeCronConfig.frequency = cronExpression;
      knowledgeCronConfig.parsedCron = cronExpression;
      knowledgeCronConfig.nlDescription = readString(body, 'nlDescription') ?? knowledgeCronConfig.nlDescription;
      knowledgeCronConfig.nextRunAt = nextRuns[0] ?? null;
      return ok({ message: 'Đã kích hoạt lịch trình', data: knowledgeCronConfig });
    },
  },
  {
    method: 'POST',
    pattern: route('\\/cron\\/test-run'),
    handler: ({ body }) => ok({ message: 'Đã chạy thử pipeline', jobId: runPipeline(body, 'manual') }),
  },

  // ----- Pipeline -----
  {
    method: 'POST',
    pattern: route('\\/pipeline\\/run'),
    handler: ({ body }) => ok({ message: 'Đã bắt đầu pipeline', jobId: runPipeline(body, 'manual') }),
  },
  {
    method: 'GET',
    pattern: route('\\/pipeline\\/logs'),
    handler: ({ query }) => {
      const status = query.get('status');
      const category = query.get('category');
      let items = pipelineLogs;
      if (status) items = items.filter((log) => log.status === status);
      if (category) items = items.filter((log) => log.categorySlug === category);
      return ok(paginate(sortByDate(items, (log) => log.createdAt, 'newest'), query));
    },
  },
  {
    method: 'GET',
    pattern: route('\\/pipeline\\/logs\\/([^/]+)'),
    handler: ({ params, path }) => {
      const log = pipelineLogs.find((item) => item.batchId === params[0]);
      return log ? ok({ data: log }) : fail(404, 'Không tìm thấy pipeline log', path);
    },
  },
  {
    method: 'POST',
    pattern: route('\\/pipeline\\/([^/]+)\\/retry-failed'),
    handler: ({ params }) => {
      // Thử lại bài lỗi thuộc batch của job (hoặc mọi bài lỗi nếu job lạ) → chuyển sang READY.
      const batchId = pipelineJobs.get(params[0])?.result?.batchId;
      const failed = knowledgeArticles.filter(
        (article) => article.pipelineState === 'failed' && (!batchId || article.batchId === batchId),
      );
      failed.forEach((article) => {
        article.pipelineState = 'ready';
        article.pipelineError = null;
        article.pipelineFailedStep = null;
      });
      return ok({ message: `Đã thử lại ${failed.length} bài lỗi` });
    },
  },
  {
    method: 'GET',
    pattern: route('\\/pipeline\\/([^/]+)'),
    handler: ({ params }) => {
      const status = pipelineJobs.get(params[0]);
      // jobId lạ (vd sau HMR) vẫn trả `done` để UI không poll mãi.
      return ok(status ?? { status: 'done', currentStep: 4, steps: buildDoneSteps(new Date().toISOString()) });
    },
  },

  // ----- Bulk -----
  {
    method: 'POST',
    pattern: route('\\/bulk\\/delete'),
    handler: ({ body }) => {
      const ids = new Set(readIds(body));
      const before = knowledgeArticles.length;
      for (let i = knowledgeArticles.length - 1; i >= 0; i -= 1) {
        if (ids.has(knowledgeArticles[i]._id)) knowledgeArticles.splice(i, 1);
      }
      return ok({ message: `Đã xóa ${before - knowledgeArticles.length} bài viết` });
    },
  },
  {
    method: 'POST',
    pattern: route('\\/bulk\\/publish'),
    handler: ({ body }) => {
      // Chỉ đăng bài đã sẵn sàng (READY) hoặc đã đăng trước đó; bài lỗi/đang xử lý bỏ qua.
      const ids = readIds(body);
      knowledgeArticles
        .filter((article) => ids.includes(article._id) && ['ready', 'content_ready', 'published'].includes(article.pipelineState ?? ''))
        .forEach(markPublished);
      return ok({ message: 'Đã gửi đăng hàng loạt', jobId: mockJobId('kb-bulk-publish') });
    },
  },

  // ----- Danh sách + chi tiết -----
  {
    method: 'GET',
    pattern: route(''),
    handler: ({ query }) => {
      const status = query.get('status');
      const category = query.get('category');
      let items = filterBySearch(knowledgeArticles, query.get('search'), ['title', 'summary']);
      if (status) items = items.filter((article) => article.pipelineState === status);
      if (category) items = items.filter((article) => article.categorySlug === category);
      return ok(paginate(sortByDate(items, (article) => article.createdAt, query.get('sort')), query));
    },
  },
  {
    method: 'POST',
    pattern: route('\\/([^/]+)\\/retry'),
    handler: ({ params, path }) => {
      const article = findArticle(params[0]);
      if (!article) return fail(404, 'Không tìm thấy bài viết', path);
      // Retry "thành công ngay": sinh lại nội dung/ảnh còn thiếu và chuyển sang READY.
      article.content = article.content ?? buildKnowledgeContent(article.title ?? '');
      article.summary = article.summary ?? `Hướng dẫn chi tiết: ${article.title ?? ''}.`;
      article.featuredImageUrl = article.featuredImageUrl ?? thumbnailFor(`kb-retry-${article._id}`);
      article.pipelineState = 'ready';
      article.pipelineError = null;
      article.pipelineFailedStep = null;
      article.updatedAt = new Date().toISOString();
      return ok({ message: 'Đã gửi yêu cầu retry', data: article });
    },
  },
  {
    method: 'POST',
    pattern: route('\\/([^/]+)\\/publish'),
    handler: ({ params, path }) => {
      const article = findArticle(params[0]);
      if (!article) return fail(404, 'Không tìm thấy bài viết', path);
      if (article.pipelineState === 'failed') return fail(400, 'Bài viết đang lỗi, vui lòng retry trước khi đăng', path);
      return ok({ message: 'Đã đăng bài lên WordPress', data: { wpPostId: markPublished(article) } });
    },
  },
  {
    method: 'POST',
    pattern: route('\\/([^/]+)\\/republish'),
    handler: ({ params, path }) => {
      const article = findArticle(params[0]);
      if (!article) return fail(404, 'Không tìm thấy bài viết', path);
      return ok({ message: 'Đã cập nhật bài trên WordPress', data: { wpPostId: markPublished(article) } });
    },
  },
  {
    method: 'GET',
    pattern: route('\\/([^/]+)'),
    handler: ({ params, path }) => {
      const article = findArticle(params[0]);
      return article ? ok({ data: article }) : fail(404, 'Không tìm thấy bài viết', path);
    },
  },
  {
    method: 'DELETE',
    pattern: route('\\/([^/]+)'),
    handler: ({ params, path }) => {
      const index = knowledgeArticles.findIndex((article) => article._id === params[0]);
      if (index < 0) return fail(404, 'Không tìm thấy bài viết', path);
      knowledgeArticles.splice(index, 1);
      return ok({ message: 'Đã xóa bài viết' });
    },
  },
];
