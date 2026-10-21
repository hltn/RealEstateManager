import type { CronConfig, PromptConfig } from '../../api/news-manager.api';
import {
  CRAWL_POOL,
  buildMarketAnalysisMarkdown,
  buildRawArticle,
  marketAnalysisHistory,
  newsArticleFromRaw,
  newsArticles,
  rawArticles,
  type MockNewsArticle,
} from '../data/news';
import type { MockRoute } from '../types';
import { fail, filterBySearch, mockObjectId, ok, paginate, readPositiveInt } from '../utils';
import {
  asRecord,
  filterByDateRange,
  mockJobId,
  readIds,
  readString,
  sortByDate,
  toLocalDateKey,
} from './shared';

/**
 * `/news-manager/*` — tin thô, bài viết đã duyệt, phân tích thị trường, cron, prompt AI.
 * Dữ liệu là mảng module-level nên mọi thao tác ghi đều "sống" trong phiên làm việc.
 */

// ── Job giả lập ──────────────────────────────────────────

/** Kết quả job đơn giản (crawl / analyze / bulk crawl / market trends) — luôn `done` ngay. */
const simpleJobs = new Map<string, unknown>();

const startSimpleJob = (prefix: string, result: unknown): string => {
  const jobId = mockJobId(prefix);
  simpleJobs.set(jobId, result);
  return jobId;
};

/** Poll job đơn giản: trả `done` (jobId lạ — vd sau HMR — vẫn coi là xong để UI không kẹt). */
const pollSimpleJob = (jobId: string, fallbackResult: unknown) =>
  ok({ status: 'done', result: simpleJobs.has(jobId) ? simpleJobs.get(jobId) : fallbackResult });

// ── Workflow 5 bước ──────────────────────────────────────

const WORKFLOW_LABELS = [
  'Thu thập tin tức',
  'Phân tích & lọc',
  'Chuyển sang bài viết',
  'Crawl nội dung chi tiết',
  'Phân tích thị trường',
];

/** Thời gian giả lập cho mỗi bước — 5 bước xong sau ~6 giây (2–3 lần poll). */
const WORKFLOW_STEP_MS = 1_200;

interface WorkflowJob {
  startedAt: number;
  dateLabel: string;
  historySaved: boolean;
}

const workflowJobs = new Map<string, WorkflowJob>();

const WORKFLOW_STEP_RESULTS: unknown[] = [
  { totalArticles: 42, newArticles: 18 },
  { kept: 12, discarded: 30 },
  { converted: 12 },
  { crawledContent: 11, failedCrawl: 1 },
  { reportLength: 'ok' },
];

/**
 * Tính trạng thái workflow theo thời gian đã trôi qua kể từ khi bắt đầu:
 * bước i chạy trong khoảng [i*STEP, (i+1)*STEP). Hết 5 bước → `done` + lưu lịch sử 1 lần.
 */
const buildWorkflowState = (jobId: string) => {
  const job = workflowJobs.get(jobId) ?? {
    // jobId không còn trong bộ nhớ (vd reload module) → coi như đã chạy xong.
    startedAt: Date.now() - WORKFLOW_STEP_MS * WORKFLOW_LABELS.length,
    dateLabel: new Date().toLocaleDateString('vi-VN'),
    historySaved: true,
  };
  const elapsedSteps = Math.floor((Date.now() - job.startedAt) / WORKFLOW_STEP_MS);
  const isDone = elapsedSteps >= WORKFLOW_LABELS.length;
  const currentStep = Math.min(elapsedSteps + 1, WORKFLOW_LABELS.length);

  const steps = WORKFLOW_LABELS.map((label, index) => {
    const step = index + 1;
    if (isDone || step < currentStep) {
      return { step, label, status: 'done' as const, result: WORKFLOW_STEP_RESULTS[index] };
    }
    return { step, label, status: step === currentStep ? ('running' as const) : ('pending' as const) };
  });

  if (!isDone) return { status: 'pending', currentStep, steps };

  const markdownContent = buildMarketAnalysisMarkdown(job.dateLabel, 12);
  if (!job.historySaved) {
    job.historySaved = true;
    marketAnalysisHistory.unshift({
      _id: mockObjectId(),
      content: markdownContent,
      articleIds: newsArticles.slice(0, 12).map((article) => article._id),
      createdAt: new Date().toISOString(),
      googleDriveExport: null,
    });
  }
  return {
    status: 'done',
    currentStep: WORKFLOW_LABELS.length,
    steps,
    result: {
      markdownContent,
      newsArticleCount: 12,
      stats: { totalArticles: 42, filtered: 12, crawledContent: 11, failedCrawl: 1 },
    },
  };
};

// ── Cron & prompt ────────────────────────────────────────

let cronConfig: CronConfig = { isActive: true, frequency: '0 8 * * *' };

let prompts: PromptConfig[] = [
  {
    api_ai_name: 'MARKET_ANALYSIS_PROMPT',
    api_ai_path: '/api/news-manager/articles/analyze-market-trends',
    prompt:
      'Từ bây giờ, hãy đóng vai một Chief Real Estate Intelligence Analyst với hơn 20 năm kinh nghiệm về bất động sản Việt Nam.\n\nDựa trên danh sách bài viết bên dưới, hãy viết báo cáo phân tích thị trường bằng Markdown gồm: Tổng quan, Diễn biến giá theo khu vực (bảng), Yếu tố tác động, Rủi ro và Khuyến nghị.\n\n{{articles}}',
  },
  {
    api_ai_name: 'RAW_ARTICLES_PROMPT',
    api_ai_path: '/api/news-manager/articles/raw-filter',
    prompt:
      'Bạn là chuyên gia phân tích tin tức bất động sản. Hãy chấm điểm mức độ liên quan (0–10) của từng tin dưới đây với thị trường nhà ở Hà Nội và TP.HCM, chỉ giữ lại tin có điểm >= 6. Trả về JSON array gồm urlHash và score.\n\n{{articles}}',
  },
  {
    api_ai_name: 'FILTER_AND_RANK_PROMPT',
    api_ai_path: '/api/news-manager/articles/filter-and-rank',
    prompt:
      'Analyze the following real estate news articles. For each significant news item, extract: title, summary (Vietnamese, max 60 words), location, segment and impact score (1-5). Return ONLY a JSON array.\n\n{{content}}',
  },
  {
    api_ai_name: 'CLEAN_ARTICLE_PROMPT',
    api_ai_path: '/api/news-manager/articles/clean-content',
    prompt:
      'You are a specialized markdown cleaner. Extract ONLY the main article body from the raw markdown below. Remove navigation, ads, related links and author boxes. Keep headings, lists and tables.\n\n{{markdown}}',
  },
  {
    api_ai_name: 'EXTRACT_LISTING_PROMPT',
    api_ai_path: '/api/news-manager/articles/extract-listing',
    prompt:
      'You are a data extraction assistant. Extract a list of news articles from the given HTML snippet. Return ONLY a JSON array of objects with keys: title, url, description, publishedAt, thumbnailUrl.\n\n{{html}}',
  },
];

// ── Helpers riêng domain ─────────────────────────────────

const findNewsArticle = (id: string): MockNewsArticle | undefined =>
  newsArticles.find((article) => article._id === id);

/** Thêm 1 trạng thái vào mảng status (không trùng), bỏ `ERROR` khi thao tác thành công. */
const addStatus = (article: MockNewsArticle, status: string): void => {
  article.status = [...new Set([...article.status.filter((item) => item !== 'ERROR'), status])];
};

/** Xoá phần tử khỏi mảng module-level theo danh sách id (mutate tại chỗ). */
const removeByIds = <T extends { _id: string }>(items: T[], ids: string[]): number => {
  const idSet = new Set(ids);
  let removed = 0;
  for (let i = items.length - 1; i >= 0; i -= 1) {
    if (idSet.has(items[i]._id)) {
      items.splice(i, 1);
      removed += 1;
    }
  }
  return removed;
};

/**
 * "Phân tích AI" tin thô: tin chưa trùng + chưa lưu → tạo NewsArticle mới và gắn `savedArticleId`.
 * Trả số bài được chuyển (để kết quả job trông thật).
 */
const promoteRawArticles = (urlHashes: string[] | null): unknown[] => {
  const targets = rawArticles.filter(
    (raw) => !raw.isDuplicate && !raw.savedArticleId && (urlHashes === null || urlHashes.includes(raw.urlHash)),
  );
  return targets.map((raw) => {
    const article = newsArticleFromRaw(raw);
    newsArticles.unshift(article);
    raw.savedArticleId = article._id;
    return { urlHash: raw.urlHash, savedArticleId: article._id, score: 7 + Math.round(Math.random() * 3) };
  });
};

let crawlPoolCursor = 0;

/** Giả lập crawl: lấy 3 tin tiếp theo trong pool, thêm vào đầu danh sách tin thô. */
const crawlNewRawArticles = (): number => {
  const batch = Array.from({ length: 3 }, () => {
    const seed = CRAWL_POOL[crawlPoolCursor % CRAWL_POOL.length];
    crawlPoolCursor += 1;
    // Thêm hậu tố lần crawl để URL/urlHash không trùng khi pool quay vòng.
    const round = Math.floor((crawlPoolCursor - 1) / CRAWL_POOL.length);
    const title = round === 0 ? seed.title : `${seed.title} (cập nhật ${round + 1})`;
    return buildRawArticle({ ...seed, title }, mockObjectId(), new Date().toISOString());
  });
  rawArticles.unshift(...batch);
  return batch.length;
};

// ── Routes ───────────────────────────────────────────────

export const newsManagerRoutes: MockRoute[] = [
  // ----- Tin thô (raw-articles) -----
  {
    method: 'GET',
    pattern: /^\/news-manager\/raw-articles$/,
    handler: ({ query }) => {
      const searched = filterBySearch(rawArticles, query.get('search'), ['title', 'description', 'source']);
      const ranged = filterByDateRange(searched, (raw) => raw.publishedAt, query.get('startDate'), query.get('endDate'));
      return ok(paginate(sortByDate(ranged, (raw) => raw.publishedAt, query.get('sort')), query));
    },
  },
  {
    method: 'POST',
    pattern: /^\/news-manager\/raw-articles\/delete-bulk$/,
    handler: ({ body }) => {
      const deleted = removeByIds(rawArticles, readIds(body));
      return ok({ message: `Đã xóa ${deleted} bài viết`, deletedCount: deleted });
    },
  },
  {
    method: 'POST',
    pattern: /^\/news-manager\/raw-articles\/move-bulk$/,
    handler: ({ body }) => {
      // Chuyển sang bài viết chính: tạo NewsArticle cho tin chưa lưu, sau đó bỏ khỏi danh sách tin thô.
      const ids = readIds(body);
      const moved = rawArticles.filter((raw) => ids.includes(raw._id));
      moved
        .filter((raw) => !raw.savedArticleId)
        .forEach((raw) => newsArticles.unshift(newsArticleFromRaw(raw)));
      removeByIds(rawArticles, ids);
      return ok({ message: `Đã di chuyển ${moved.length} bài viết`, movedCount: moved.length });
    },
  },
  {
    method: 'PATCH',
    pattern: /^\/news-manager\/raw-articles\/([^/]+)\/override-duplicate$/,
    handler: ({ params, path }) => {
      const raw = rawArticles.find((item) => item._id === params[0]);
      if (!raw) return fail(404, 'Không tìm thấy bài viết thô', path);
      raw.isDuplicate = false;
      raw.duplicateOfArticleId = null;
      raw.duplicateScore = null;
      return ok({ message: 'Đã bỏ đánh dấu trùng lặp', data: raw });
    },
  },
  {
    method: 'GET',
    pattern: /^\/news-manager\/raw-articles\/([^/]+)$/,
    handler: ({ params, path }) => {
      const raw = rawArticles.find((item) => item._id === params[0]);
      return raw ? ok({ message: 'OK', data: raw }) : fail(404, 'Không tìm thấy bài viết thô', path);
    },
  },
  {
    method: 'DELETE',
    pattern: /^\/news-manager\/raw-articles\/([^/]+)$/,
    handler: ({ params, path }) => {
      const deleted = removeByIds(rawArticles, [params[0]]);
      return deleted ? ok({ message: 'Đã xóa bài viết' }) : fail(404, 'Không tìm thấy bài viết thô', path);
    },
  },

  // ----- Thu thập thủ công -----
  {
    method: 'POST',
    pattern: /^\/news-manager\/crawl$/,
    handler: () => {
      const count = crawlNewRawArticles();
      const jobId = startSimpleJob('crawl', {
        count,
        stats: {
          successfulSources: 4,
          failedSources: 1,
          totalArticles: count,
          successfulDetails: [
            { url: 'https://cafeland.vn/tin-tuc', count: 1 },
            { url: 'https://vnexpress.net/bat-dong-san', count: 1 },
            { url: 'https://batdongsan.com.vn/tin-tuc', count: 1 },
            { url: 'https://reatimes.vn/thi-truong', count: 0 },
          ],
          failedDetails: [{ url: 'https://tuoitre.vn/nha-dat.htm' }],
        },
      });
      return ok({ message: 'Đã bắt đầu thu thập dữ liệu', jobId });
    },
  },
  {
    method: 'GET',
    pattern: /^\/news-manager\/crawl\/([^/]+)$/,
    handler: ({ params }) => pollSimpleJob(params[0], { count: 0 }),
  },

  // ----- Phân tích AI tin thô -----
  {
    method: 'POST',
    pattern: /^\/news-manager\/analyze-raw$/,
    handler: ({ body }) => {
      const articles = asRecord(body).articles;
      const urlHashes = Array.isArray(articles)
        ? articles.map((item) => readString(item, 'urlHash')).filter((hash): hash is string => Boolean(hash))
        : [];
      if (urlHashes.length === 0) return ok({ message: 'Không có bài viết nào để phân tích' });
      return ok({ message: 'Đã gửi yêu cầu phân tích', jobId: startSimpleJob('analyze', promoteRawArticles(urlHashes)) });
    },
  },
  {
    method: 'POST',
    pattern: /^\/news-manager\/analyze-raw-all$/,
    handler: () => ok({ message: 'Đã gửi yêu cầu phân tích tất cả', jobId: startSimpleJob('analyze-all', promoteRawArticles(null)) }),
  },
  {
    method: 'GET',
    pattern: /^\/news-manager\/analyze-raw\/([^/]+)$/,
    handler: ({ params }) => pollSimpleJob(params[0], []),
  },

  // ----- Bài viết đã duyệt (articles) — route cụ thể trước `:id` -----
  {
    method: 'GET',
    pattern: /^\/news-manager\/articles$/,
    handler: ({ query }) => {
      const status = query.get('status');
      const date = query.get('date');
      let items = newsArticles;
      if (status === 'pending') items = items.filter((article) => article.status.length === 0);
      else if (status) items = items.filter((article) => article.status.includes(status));
      if (date) items = items.filter((article) => toLocalDateKey(article.publishDate || article.createdAt) === date);
      return ok(paginate(sortByDate(items, (article) => article.createdAt, query.get('sort')), query));
    },
  },
  {
    method: 'GET',
    pattern: /^\/news-manager\/articles\/market-analysis-history$/,
    handler: ({ query }) => {
      // Phân trang theo cursor (MarketAnalysisWorkflowScreen dùng infinite query): cursor = _id bản ghi cuối trang trước.
      const limit = readPositiveInt(query, 'limit', 5);
      const cursor = query.get('cursor');
      const sorted = sortByDate(marketAnalysisHistory, (item) => item.createdAt, 'newest');
      const startIndex = cursor ? sorted.findIndex((item) => item._id === cursor) + 1 : 0;
      const pageItems = sorted.slice(startIndex, startIndex + limit);
      const hasMore = startIndex + limit < sorted.length;
      return ok({
        message: 'OK',
        data: pageItems,
        meta: {
          hasMore,
          nextCursor: hasMore ? pageItems[pageItems.length - 1]._id : null,
          total: sorted.length,
        },
      });
    },
  },
  {
    method: 'POST',
    pattern: /^\/news-manager\/articles\/publish-bulk$/,
    handler: ({ body }) => {
      const ids = readIds(body);
      newsArticles.filter((article) => ids.includes(article._id)).forEach((article) => addStatus(article, 'POSTED_WP'));
      return ok({ message: `Đã đăng ${ids.length} bài lên WordPress` });
    },
  },
  {
    method: 'POST',
    pattern: /^\/news-manager\/articles\/delete-bulk$/,
    handler: ({ body }) => {
      const deleted = removeByIds(newsArticles, readIds(body));
      return ok({ message: `Đã xóa ${deleted} bài viết`, deletedCount: deleted });
    },
  },
  {
    method: 'POST',
    pattern: /^\/news-manager\/articles\/market-analysis-bulk$/,
    handler: ({ body }) => {
      // Crawl nội dung chi tiết cho các bài được chọn → gắn trạng thái CRAWLED.
      const ids = readIds(body);
      const targets = newsArticles.filter((article) => ids.includes(article._id));
      targets.forEach((article) => addStatus(article, 'CRAWLED'));
      return ok({
        message: 'Đã bắt đầu crawl tin tức',
        jobId: startSimpleJob('bulk-crawl', { crawled: targets.length, failed: 0 }),
      });
    },
  },
  {
    method: 'GET',
    pattern: /^\/news-manager\/articles\/market-analysis-bulk\/([^/]+)$/,
    handler: ({ params }) => pollSimpleJob(params[0], { crawled: 0, failed: 0 }),
  },
  {
    method: 'POST',
    pattern: /^\/news-manager\/articles\/analyze-market-trends$/,
    handler: ({ body }) => {
      const ids = readIds(body);
      if (ids.length === 0) return fail(400, 'Vui lòng chọn ít nhất 1 bài viết');
      const content = buildMarketAnalysisMarkdown(new Date().toLocaleDateString('vi-VN'), ids.length);
      marketAnalysisHistory.unshift({
        _id: mockObjectId(),
        content,
        articleIds: ids,
        createdAt: new Date().toISOString(),
        googleDriveExport: null,
      });
      return ok({ message: 'Đã bắt đầu phân tích thị trường', jobId: startSimpleJob('market-trends', content) });
    },
  },
  {
    method: 'GET',
    pattern: /^\/news-manager\/articles\/analyze-market-trends\/([^/]+)$/,
    handler: ({ params }) =>
      pollSimpleJob(params[0], buildMarketAnalysisMarkdown(new Date().toLocaleDateString('vi-VN'), 10)),
  },
  {
    method: 'POST',
    pattern: /^\/news-manager\/articles\/([^/]+)\/publish$/,
    handler: ({ params, path }) => {
      const article = findNewsArticle(params[0]);
      if (!article) return fail(404, 'Không tìm thấy bài viết', path);
      addStatus(article, 'POSTED_WP');
      return ok({ message: 'Đã đăng bài lên WordPress', data: article });
    },
  },
  {
    method: 'POST',
    pattern: /^\/news-manager\/articles\/([^/]+)\/clean$/,
    handler: ({ params, path }) => {
      const article = findNewsArticle(params[0]);
      if (!article) return fail(404, 'Không tìm thấy bài viết', path);
      // "Làm sạch": bỏ dòng trích nguồn cuối bài, chuẩn hoá khoảng trắng.
      article.content = article.content.replace(/\n+_Nguồn:.*_$/, '').replace(/\n{3,}/g, '\n\n');
      addStatus(article, 'CRAWLED');
      return ok({ message: 'Đã làm sạch dữ liệu', data: article });
    },
  },
  {
    method: 'GET',
    pattern: /^\/news-manager\/articles\/([^/]+)$/,
    handler: ({ params, path }) => {
      const article = findNewsArticle(params[0]);
      return article ? ok({ message: 'OK', data: article }) : fail(404, 'Không tìm thấy bài viết', path);
    },
  },
  {
    method: 'DELETE',
    pattern: /^\/news-manager\/articles\/([^/]+)$/,
    handler: ({ params, path }) =>
      removeByIds(newsArticles, [params[0]]) ? ok({ message: 'Đã xóa bài viết' }) : fail(404, 'Không tìm thấy bài viết', path),
  },

  // ----- Workflow phân tích thị trường 5 bước -----
  {
    method: 'POST',
    pattern: /^\/news-manager\/market-analysis-workflow$/,
    handler: ({ body, path }) => {
      // Mô phỏng khoá 409 như backend: chỉ cho chạy 1 workflow tại 1 thời điểm.
      const running = [...workflowJobs.keys()].some((jobId) => buildWorkflowState(jobId).status === 'pending');
      if (running) return fail(409, 'Đang có phân tích thị trường đang chạy, vui lòng đợi hoàn tất', path);
      const jobId = mockJobId('workflow');
      // Body `{ date: 'YYYY-MM-DD' }` (tuỳ chọn) → hiển thị trong tiêu đề báo cáo dạng dd/MM/yyyy.
      const requestedDate = readString(body, 'date');
      workflowJobs.set(jobId, {
        startedAt: Date.now(),
        dateLabel: requestedDate
          ? requestedDate.split('-').reverse().join('/')
          : new Date().toLocaleDateString('vi-VN'),
        historySaved: false,
      });
      return ok({ message: 'Đã bắt đầu phân tích thị trường', jobId });
    },
  },
  {
    method: 'POST',
    pattern: /^\/news-manager\/market-analysis-workflow\/([^/]+)\/retry$/,
    handler: () => ok({ message: 'Đã thử lại bước bị lỗi' }),
  },
  {
    method: 'GET',
    pattern: /^\/news-manager\/market-analysis-workflow\/([^/]+)$/,
    handler: ({ params }) => ok(buildWorkflowState(params[0])),
  },

  // ----- Cronjob -----
  { method: 'GET', pattern: /^\/news-manager\/cron$/, handler: () => ok(cronConfig) },
  {
    method: 'POST',
    pattern: /^\/news-manager\/cron$/,
    handler: ({ body }) => {
      const payload = asRecord(body);
      cronConfig = {
        isActive: typeof payload.isActive === 'boolean' ? payload.isActive : cronConfig.isActive,
        frequency: readString(body, 'frequency') ?? cronConfig.frequency,
      };
      return ok({ message: 'Đã lưu cấu hình cronjob', data: cronConfig });
    },
  },

  // ----- Prompt AI -----
  { method: 'GET', pattern: /^\/news-manager\/prompts$/, handler: () => ok({ success: true, data: prompts }) },
  {
    method: 'PUT',
    pattern: /^\/news-manager\/prompts$/,
    handler: ({ body, path }) => {
      if (!Array.isArray(body)) return fail(400, 'Dữ liệu prompt không hợp lệ', path);
      prompts = body.map((item) => ({
        api_ai_name: readString(item, 'api_ai_name') ?? '',
        api_ai_path: readString(item, 'api_ai_path') ?? '',
        prompt: readString(item, 'prompt') ?? '',
      }));
      return ok({ success: true, message: 'Đã lưu prompt' });
    },
  },
];
