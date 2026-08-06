/**
 * Trạng thái pipeline 5 bước của workflow phân tích thị trường.
 * Nested trong `AnalyzeJob.result` (xem services/analyze-job.service.ts) —
 * không đụng đến type AnalyzeJob hiện có, chỉ định nghĩa shape riêng cho workflow.
 */
export interface WorkflowStepState {
  step: number; // 1-5
  label: string; // "Thu thập tin tức" | "Phân tích & lọc" | ...
  status: 'pending' | 'running' | 'done' | 'error';
  result?: unknown; // output của step đó
  error?: string; // message nếu status='error'
}

export interface WorkflowJobState {
  currentStep: number; // 0-5 (0 = chưa bắt đầu, 5 = hoàn tất)
  steps: WorkflowStepState[]; // luôn đủ 5 phần tử, khởi tạo all pending
  date: string; // ngày phân tích (YYYY-MM-DD)
  /**
   * Kết quả cuối cùng khi pipeline markDone — flatten ra top-level response
   * của GET /market-analysis-workflow/:jobId (field `result`, xem design spec
   * mục 2 "Poll endpoint response shape"). Chỉ có khi status='done'.
   */
  finalResult?: {
    markdownContent: string;
    newsArticleCount: number;
    stats: {
      totalArticles: number;
      filtered: number;
      crawledContent: number;
      failedCrawl: number;
    };
  };
}

/** Map step (1-5) → nhãn tiếng Việt hiển thị cho FE. */
export const STEP_LABELS: Record<number, string> = {
  1: 'Thu thập tin tức',
  2: 'Phân tích & lọc',
  3: 'Chuyển sang bài viết',
  4: 'Crawl nội dung chi tiết',
  5: 'Phân tích thị trường',
};
