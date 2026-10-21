import type { MockRoute } from '../types';
import { fail, isoMinutesAgo, ok, paginate } from '../utils';
import { filterByDateRange, sortByDate } from './shared';
import { seedId } from '../data/news';

/** Bản ghi log request gửi ra ngoài (mirror ExternalRequestLog mà ExternalLogsScreen đọc). */
interface MockExternalLog {
  _id: string;
  type: 'CRAWL_OUTGOING' | 'AI_OUTGOING';
  targetService: string;
  method: string;
  url: string;
  statusCode: number;
  durationMs: number;
  sourceModule: string;
  createdAt: string;
  request?: { headers?: Record<string, string>; query?: Record<string, string>; body?: unknown; prompt?: string };
  response?: { headers?: Record<string, string>; body?: unknown; usage?: unknown };
  error?: { message?: string; code?: string };
  metadata?: Record<string, unknown>;
}

const crawlLog = (
  index: number,
  minutesAgo: number,
  targetService: string,
  url: string,
  statusCode: number,
  durationMs: number,
  articleCount: number,
): MockExternalLog => ({
  _id: seedId('66f1', index),
  type: 'CRAWL_OUTGOING',
  targetService,
  method: 'GET',
  url,
  statusCode,
  durationMs,
  sourceModule: 'CustomCrawlerService',
  createdAt: isoMinutesAgo(minutesAgo),
  request: { headers: { 'user-agent': 'STND-Crawler/1.0', accept: 'text/html' } },
  response:
    statusCode < 400
      ? { headers: { 'content-type': 'text/html; charset=utf-8' }, body: `<html>… ${articleCount} bài viết được trích xuất …</html>` }
      : undefined,
  error:
    statusCode >= 400
      ? { message: statusCode === 403 ? 'Request bị chặn bởi Cloudflare' : 'Máy chủ nguồn không phản hồi', code: `HTTP_${statusCode}` }
      : undefined,
  metadata: { articleCount, jobType: 'manual-crawl' },
});

const aiLog = (
  index: number,
  minutesAgo: number,
  model: string,
  sourceModule: string,
  prompt: string,
  statusCode: number,
  durationMs: number,
): MockExternalLog => ({
  _id: seedId('66f1', index),
  type: 'AI_OUTGOING',
  targetService: 'OpenRouter',
  method: 'POST',
  url: 'https://openrouter.ai/api/v1/chat/completions',
  statusCode,
  durationMs,
  sourceModule,
  createdAt: isoMinutesAgo(minutesAgo),
  request: {
    headers: { 'content-type': 'application/json', authorization: 'Bearer ••••••••' },
    body: { model, temperature: 0.3, max_tokens: 4096 },
    prompt,
  },
  response:
    statusCode < 400
      ? {
          body: { id: `gen-${index}${minutesAgo}`, model, choices: [{ finish_reason: 'stop' }] },
          usage: { prompt_tokens: 3_200 + index * 117, completion_tokens: 850 + index * 41, total_tokens: 4_050 + index * 158 },
        }
      : undefined,
  error:
    statusCode >= 400
      ? { message: statusCode === 429 ? 'Rate limit exceeded, vui lòng thử lại sau' : 'Upstream provider timeout', code: `HTTP_${statusCode}` }
      : undefined,
  metadata: { model },
});

/** Dữ liệu mẫu trộn CRAWL + AI, có cả lỗi 4xx/5xx để test filter status code. */
const externalLogs: MockExternalLog[] = [
  crawlLog(1, 12, 'cafeland.vn', 'https://cafeland.vn/tin-tuc', 200, 1_840, 24),
  crawlLog(2, 13, 'vnexpress.net', 'https://vnexpress.net/bat-dong-san', 200, 960, 30),
  crawlLog(3, 14, 'batdongsan.com.vn', 'https://batdongsan.com.vn/tin-tuc', 403, 420, 0),
  aiLog(4, 16, 'openai/gpt-4o-mini', 'NewsAnalyzerService', 'Chấm điểm mức độ liên quan của 30 tin bất động sản…', 200, 8_420),
  aiLog(5, 40, 'openai/gpt-4o-mini', 'MarketAnalysisService', 'Viết báo cáo phân tích thị trường từ 12 bài viết…', 200, 21_300),
  crawlLog(6, 95, 'reatimes.vn', 'https://reatimes.vn/thi-truong', 200, 2_310, 18),
  crawlLog(7, 96, 'tuoitre.vn', 'https://tuoitre.vn/nha-dat.htm', 504, 30_000, 0),
  aiLog(8, 120, 'anthropic/claude-3.5-sonnet', 'ArticleCleanerService', 'Làm sạch markdown bài "Giá căn hộ Thủ Đức tăng 8% quý III"…', 200, 5_120),
  aiLog(9, 180, 'anthropic/claude-3.5-sonnet', 'ArticleCleanerService', 'Làm sạch markdown bài "Lãi suất cho vay mua nhà giảm về 7,5%/năm"…', 429, 310),
  crawlLog(10, 600, 'baoxaydung.vn', 'https://baoxaydung.vn/bat-dong-san', 200, 1_270, 12),
  aiLog(11, 610, 'google/gemini-2.5-flash', 'KnowledgeArticleWriter', 'Viết bài kiến thức: "Thủ tục sang tên sổ hồng 2026"…', 200, 14_880),
  aiLog(12, 1_500, 'openai/gpt-4o-mini', 'NewsAnalyzerService', 'Trích xuất danh sách tin từ HTML trang CafeLand…', 502, 12_000),
  crawlLog(13, 1_520, 'dantri.com.vn', 'https://dantri.com.vn/bat-dong-san.htm', 200, 1_650, 20),
  aiLog(14, 2_900, 'openai/gpt-4o', 'MarketAnalysisService', 'Viết báo cáo phân tích thị trường từ 9 bài viết…', 200, 19_640),
  crawlLog(15, 4_300, 'cafeland.vn', 'https://cafeland.vn/tin-tuc/page-2', 200, 1_990, 22),
];

/** `/external-logs` — nhật ký request ra ngoài, phân trang `{ data, meta }` + filter phía server. */
export const externalLogsRoutes: MockRoute[] = [
  {
    method: 'GET',
    pattern: /^\/external-logs$/,
    handler: ({ query }) => {
      const type = query.get('type');
      const statusCode = query.get('statusCode')?.trim();
      const targetService = query.get('targetService')?.trim().toLowerCase();
      let items = externalLogs;
      if (type) items = items.filter((log) => log.type === type);
      // Cho phép gõ tiền tố: "4" → mọi mã 4xx, "429" → đúng mã 429.
      if (statusCode) items = items.filter((log) => String(log.statusCode).startsWith(statusCode));
      if (targetService) items = items.filter((log) => log.targetService.toLowerCase().includes(targetService));
      items = filterByDateRange(items, (log) => log.createdAt, query.get('startDate'), query.get('endDate'));
      return ok(paginate(sortByDate(items, (log) => log.createdAt, query.get('sort')), query));
    },
  },
  {
    method: 'GET',
    pattern: /^\/external-logs\/([^/]+)$/,
    handler: ({ params, path }) => {
      const log = externalLogs.find((item) => item._id === params[0]);
      return log ? ok({ data: log }) : fail(404, 'Không tìm thấy log', path);
    },
  },
];
