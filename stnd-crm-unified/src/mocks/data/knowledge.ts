import type {
  AiImageConfig,
  AiWritingConfig,
  KnowledgeArticle,
  KnowledgeArticleState,
  KnowledgeCronConfig,
  PipelineLog,
  PipelineStep,
  WpConfig,
} from '../../api/knowledge-articles.api';
import { isoMinutesAgo } from '../utils';
import { seedId, thumbnailFor } from './news';

// ── Cấu hình ─────────────────────────────────────────────

export const wpConfig: WpConfig = {
  siteUrl: 'https://kienthuc.stnd.vn',
  username: 'stnd-bot',
  appPassword: '••••••••••••',
  defaultCategoryId: 12,
  categoryMapping: [
    { slug: 'phap-ly', wpCategoryId: 21, wpCategoryName: 'Pháp lý nhà đất' },
    { slug: 'tai-chinh', wpCategoryId: 22, wpCategoryName: 'Tài chính & vay mua nhà' },
    { slug: 'kinh-nghiem-mua-nha', wpCategoryId: 23, wpCategoryName: 'Kinh nghiệm mua nhà' },
    { slug: 'dau-tu', wpCategoryId: 24, wpCategoryName: 'Đầu tư bất động sản' },
    { slug: 'phong-thuy', wpCategoryId: 25, wpCategoryName: 'Phong thuỷ nhà ở' },
  ],
  defaultTagIds: [101, 102],
  tagMapping: [
    { name: 'sổ hồng', wpTagId: 101 },
    { name: 'vay mua nhà', wpTagId: 102 },
    { name: 'căn hộ', wpTagId: 103 },
    { name: 'đất nền', wpTagId: 104 },
  ],
};

export const aiWritingConfig: AiWritingConfig = {
  promptTemplate:
    'Bạn là biên tập viên chuyên mảng bất động sản. Hãy viết một bài kiến thức chuẩn SEO (1.200–1.500 từ) về chủ đề "{{topic}}" thuộc danh mục {{category}}.\nYêu cầu: có mở bài, 4–6 mục H2, ví dụ thực tế tại Việt Nam, kết luận và 3 câu hỏi thường gặp.',
  model: 'google/gemini-2.5-flash',
  provider: 'OpenRouter',
  maxTokens: 4_096,
  temperature: 0.7,
  topics: [
    { slug: 'phap-ly', name: 'Pháp lý nhà đất', description: 'Sổ hồng, sang tên, hợp đồng mua bán, thuế phí chuyển nhượng.' },
    { slug: 'tai-chinh', name: 'Tài chính & vay mua nhà', description: 'Lãi suất, cách tính khả năng chi trả, gói vay ưu đãi.' },
    { slug: 'kinh-nghiem-mua-nha', name: 'Kinh nghiệm mua nhà', description: 'Kiểm tra dự án, nhận bàn giao, mua nhà lần đầu.' },
    { slug: 'dau-tu', name: 'Đầu tư bất động sản', description: 'Chiến lược đầu tư căn hộ cho thuê, đất nền, shophouse.' },
  ],
  articlesPerBatch: 3,
};

export const aiImageConfig: AiImageConfig = {
  enabled: true,
  promptTemplate: 'Ảnh minh hoạ hiện đại cho bài viết "{{title}}", phong cách {{style}}, ánh sáng tự nhiên, không chữ.',
  model: 'stable-diffusion-xl',
  provider: 'ComfyUI',
  width: 1_200,
  height: 630,
  style: 'photorealistic',
};

export const knowledgeCronConfig: KnowledgeCronConfig = {
  isActive: true,
  frequency: '0 9 * * 1,3,5',
  nlDescription: 'Chạy lúc 9 giờ sáng thứ 2, thứ 4 và thứ 6 hàng tuần',
  parsedCron: '0 9 * * 1,3,5',
  lastRunAt: isoMinutesAgo(1_500),
  nextRunAt: isoMinutesAgo(-1_380),
};

// ── Bài viết kiến thức ───────────────────────────────────

interface KnowledgeSeed {
  title: string;
  categorySlug: string;
  state: KnowledgeArticleState;
  minutesAgo: number;
  batchIndex: number;
  error?: { message: string; step: number };
}

const KNOWLEDGE_SEEDS: KnowledgeSeed[] = [
  { title: 'Thủ tục sang tên sổ hồng năm 2026: Hồ sơ, phí và thời gian', categorySlug: 'phap-ly', state: 'published', minutesAgo: 60, batchIndex: 1 },
  { title: 'Cách tính khả năng vay mua nhà theo thu nhập hàng tháng', categorySlug: 'tai-chinh', state: 'published', minutesAgo: 62, batchIndex: 1 },
  { title: '7 điều cần kiểm tra khi nhận bàn giao căn hộ chung cư', categorySlug: 'kinh-nghiem-mua-nha', state: 'ready', minutesAgo: 64, batchIndex: 1 },
  { title: 'Đầu tư căn hộ cho thuê: Tính tỷ suất lợi nhuận thế nào cho đúng', categorySlug: 'dau-tu', state: 'failed', minutesAgo: 1_440, batchIndex: 2, error: { message: 'WordPress trả về 401 Unauthorized', step: 4 } },
  { title: 'Phân biệt sổ đỏ, sổ hồng và giấy chứng nhận mới theo Luật Đất đai 2024', categorySlug: 'phap-ly', state: 'published', minutesAgo: 1_445, batchIndex: 2 },
  { title: 'Mua nhà lần đầu: Lộ trình tài chính 5 năm cho người trẻ', categorySlug: 'tai-chinh', state: 'content_ready', minutesAgo: 1_450, batchIndex: 2 },
  { title: 'Hợp đồng đặt cọc mua bán nhà đất: Những điều khoản bắt buộc', categorySlug: 'phap-ly', state: 'generating_image', minutesAgo: 5, batchIndex: 3 },
  { title: 'Có nên mua đất nền vùng ven thời điểm này?', categorySlug: 'dau-tu', state: 'pending', minutesAgo: 4, batchIndex: 3 },
  { title: 'Hướng nhà hợp tuổi: Hiểu đúng để không mất tiền oan', categorySlug: 'phong-thuy', state: 'failed', minutesAgo: 2_900, batchIndex: 4, error: { message: 'AI trả về nội dung rỗng (finish_reason=length)', step: 2 } },
  { title: 'Thuế thu nhập cá nhân khi bán nhà: Ai phải nộp, nộp bao nhiêu?', categorySlug: 'phap-ly', state: 'published', minutesAgo: 2_905, batchIndex: 4 },
  { title: 'Lãi suất thả nổi là gì? Cách đọc biên độ trong hợp đồng vay', categorySlug: 'tai-chinh', state: 'ready', minutesAgo: 2_910, batchIndex: 4 },
];

export const batchIdOf = (index: number): string => `kb-batch-2026-${String(index).padStart(4, '0')}`;

/** Nội dung bài kiến thức dạng text (màn chi tiết hiển thị `content` với whitespace-pre-wrap). */
export const buildKnowledgeContent = (title: string): string =>
  [
    title,
    '',
    'Mở bài',
    `Trong bối cảnh thị trường bất động sản đang phục hồi, nhiều người quan tâm tới chủ đề "${title.toLowerCase()}". Bài viết dưới đây tổng hợp những thông tin cần thiết, cập nhật theo quy định mới nhất.`,
    '',
    '1. Khái niệm và căn cứ pháp lý',
    'Trình bày định nghĩa, văn bản pháp luật liên quan và phạm vi áp dụng.',
    '',
    '2. Các bước thực hiện',
    '- Bước 1: Chuẩn bị hồ sơ, giấy tờ tuỳ thân.',
    '- Bước 2: Nộp hồ sơ tại cơ quan có thẩm quyền.',
    '- Bước 3: Theo dõi tiến độ và nhận kết quả.',
    '',
    '3. Chi phí tham khảo',
    'Tuỳ địa phương và giá trị tài sản, tổng chi phí thường dao động 1–3% giá trị giao dịch.',
    '',
    'Kết luận',
    'Nắm rõ quy trình giúp người mua nhà tiết kiệm thời gian và hạn chế rủi ro pháp lý.',
  ].join('\n');

const WP_POST_BASE = 4_820;

export const knowledgeArticles: KnowledgeArticle[] = KNOWLEDGE_SEEDS.map((seed, index) => {
  const hasContent = !['pending', 'generating_content'].includes(seed.state);
  const isPublished = seed.state === 'published';
  return {
    _id: seedId('66a7', index + 1),
    title: seed.title,
    content: hasContent ? buildKnowledgeContent(seed.title) : undefined,
    summary: hasContent ? `Hướng dẫn chi tiết: ${seed.title}.` : undefined,
    pipelineState: seed.state,
    pipelineError: seed.error?.message ?? null,
    pipelineFailedStep: seed.error?.step ?? null,
    wpCategoryId: wpConfig.categoryMapping.find((item) => item.slug === seed.categorySlug)?.wpCategoryId ?? null,
    wpTagIds: [...wpConfig.defaultTagIds],
    wpPostId: isPublished ? WP_POST_BASE + index : null,
    featuredImageUrl: ['ready', 'publishing', 'published'].includes(seed.state) ? thumbnailFor(`kb-${index + 1}`) : null,
    inlineImageUrls: [],
    categorySlug: seed.categorySlug,
    batchId: batchIdOf(seed.batchIndex),
    createdAt: isoMinutesAgo(seed.minutesAgo),
    updatedAt: isoMinutesAgo(Math.max(0, seed.minutesAgo - 3)),
  };
});

// ── Pipeline logs ────────────────────────────────────────

export const PIPELINE_STEP_LABELS = ['Chọn chủ đề', 'AI viết nội dung', 'Tạo ảnh minh hoạ', 'Đăng WordPress'];

/** Tạo danh sách bước đã hoàn tất (có thể đánh dấu 1 bước lỗi). */
export const buildDoneSteps = (createdAt: string, errorStep?: { step: number; message: string }): PipelineStep[] =>
  PIPELINE_STEP_LABELS.map((label, index) => {
    const step = index + 1;
    const isError = errorStep?.step === step;
    return {
      step,
      label,
      status: isError ? 'error' : 'done',
      error: isError ? errorStep?.message : undefined,
      startedAt: createdAt,
      completedAt: createdAt,
    };
  });

/** Gom bài theo batch để dựng log tương ứng với dữ liệu bài viết ở trên. */
const buildLogForBatch = (batchIndex: number, source: 'cron' | 'manual'): PipelineLog => {
  const batchId = batchIdOf(batchIndex);
  const articles = knowledgeArticles.filter((article) => article.batchId === batchId);
  const publishedCount = articles.filter((article) => article.pipelineState === 'published').length;
  const failedCount = articles.filter((article) => article.pipelineState === 'failed').length;
  const readyCount = articles.length - publishedCount - failedCount;
  const createdAt = articles[articles.length - 1]?.createdAt ?? new Date().toISOString();
  const firstFailed = articles.find((article) => article.pipelineState === 'failed');
  const isRunning = articles.some((article) => ['pending', 'generating_content', 'generating_image'].includes(article.pipelineState ?? ''));
  return {
    _id: seedId('66a8', batchIndex),
    batchId,
    categorySlug: articles[0]?.categorySlug ?? 'phap-ly',
    source,
    status: isRunning ? 'running' : failedCount === 0 ? 'completed' : publishedCount + readyCount > 0 ? 'partial' : 'failed',
    totalArticles: articles.length,
    publishedCount,
    failedCount,
    readyCount,
    articleResults: articles.map((article) => ({
      articleId: article._id,
      title: article.title ?? '',
      state: article.pipelineState ?? 'pending',
      error: article.pipelineError ?? undefined,
      failedStep: article.pipelineFailedStep ?? undefined,
      wpPostId: article.wpPostId ?? undefined,
      duration: 38_000 + (article.title ?? '').length * 310,
    })),
    steps: firstFailed
      ? buildDoneSteps(createdAt, { step: firstFailed.pipelineFailedStep ?? 2, message: firstFailed.pipelineError ?? 'Lỗi' })
      : buildDoneSteps(createdAt),
    totalDuration: 95_000 + batchIndex * 12_345,
    errorSummary: firstFailed?.pipelineError ?? null,
    createdAt,
  };
};

export const pipelineLogs: PipelineLog[] = [
  buildLogForBatch(3, 'manual'),
  buildLogForBatch(1, 'cron'),
  buildLogForBatch(2, 'cron'),
  buildLogForBatch(4, 'cron'),
];
