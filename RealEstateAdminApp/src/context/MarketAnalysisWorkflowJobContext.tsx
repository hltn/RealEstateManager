import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import apiAxios from "../api/axios";

/** Trạng thái 1 bước trong pipeline 5 bước (mirror BE `WorkflowStepState`). */
export interface WorkflowStepState {
  step: number;
  label: string;
  status: "pending" | "running" | "done" | "error";
  result?: unknown;
  error?: string;
}

/** Kết quả cuối cùng khi pipeline hoàn tất (status='done'). */
export interface WorkflowFinalResult {
  markdownContent?: string;
  newsArticleCount?: number;
  stats?: {
    totalArticles?: number;
    filtered?: number;
    crawledContent?: number;
    failedCrawl?: number;
  };
}

/**
 * Phản hồi từ `GET /news-manager/market-analysis-workflow/:jobId`.
 * Theo đúng shape mô tả ở design doc mục 2 (Poll endpoint response shape):
 * `currentStep`/`steps` nằm ở top-level, KHÔNG lồng trong `result`.
 */
export interface WorkflowJobResponse {
  status: "pending" | "done" | "error" | "not_found";
  currentStep?: number;
  steps?: WorkflowStepState[];
  result?: WorkflowFinalResult;
  error?: string;
}

/** Nhãn tiếng Việt cho từng bước — dùng làm placeholder trước khi có dữ liệu poll đầu tiên. */
export const STEP_LABELS: Record<number, string> = {
  1: "Thu thập tin tức",
  2: "Phân tích & lọc",
  3: "Chuyển sang bài viết",
  4: "Crawl nội dung chi tiết",
  5: "Phân tích thị trường",
};

/** 5 step card mặc định (trạng thái pending) — hiển thị trước khi user bấm "Phân tích". */
export const DEFAULT_STEPS: WorkflowStepState[] = [1, 2, 3, 4, 5].map((step) => ({
  step,
  label: STEP_LABELS[step],
  status: "pending" as const,
}));

interface MarketAnalysisWorkflowJobContextType {
  /** Trạng thái job hiện tại (null nếu chưa từng bắt đầu job nào trong phiên này). */
  jobState: WorkflowJobResponse | null;
  /** true khi job đang chạy (status === 'pending'). */
  isRunning: boolean;
  /** Lỗi khi gọi POST để bắt đầu job (vd: 409 lock conflict). */
  startError: string | null;
  /** Bắt đầu 1 job mới — gọi POST /news-manager/market-analysis-workflow. */
  startJob: (date?: string) => Promise<void>;
  /** Retry đúng bước lỗi của job hiện tại, không tạo/reset job mới. */
  retryFailedStep: () => Promise<void>;
  /** true trong lúc POST retry đang pending. */
  isRetrying: boolean;
  /** Lỗi riêng của thao tác retry; progress hiện tại vẫn được giữ nguyên. */
  retryError: string | null;
  /** Reset toàn bộ trạng thái về ban đầu (dùng cho nút "Chạy lại"). */
  resetJob: () => void;
}

const MarketAnalysisWorkflowJobContext = createContext<
  MarketAnalysisWorkflowJobContextType | undefined
>(undefined);

export const useMarketAnalysisWorkflowJob = () => {
  const context = useContext(MarketAnalysisWorkflowJobContext);
  if (!context) {
    throw new Error(
      "useMarketAnalysisWorkflowJob must be used within a MarketAnalysisWorkflowJobProvider",
    );
  }
  return context;
};

/**
 * Poll trạng thái pipeline 5 bước "Phân tích thị trường" (workflow orchestration).
 *
 * Pattern giống `ManualCrawlJobContext`/`MarketAnalysisJobContext`: Provider sống ở
 * AppLayout nên poll độc lập với màn hình hiện tại — user chuyển tab/màn hình khác
 * rồi quay lại vẫn thấy đúng tiến độ (miễn không reload cứng trang, vì job state
 * chỉ nằm trong React context, không có localStorage).
 */
export const MarketAnalysisWorkflowJobProvider: React.FC<{
  children: React.ReactNode;
}> = ({ children }) => {
  const queryClient = useQueryClient();
  const [jobId, setJobId] = useState<string | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const [retryError, setRetryError] = useState<string | null>(null);

  const { data } = useQuery<WorkflowJobResponse>({
    queryKey: ["market-analysis-workflow-job", jobId],
    queryFn: async ({ signal }) => {
      try {
        const { data } = await apiAxios.get<WorkflowJobResponse>(
          `/news-manager/market-analysis-workflow/${jobId}`,
          { signal },
        );
        return data;
      } catch {
        throw new Error("Không lấy được trạng thái job phân tích thị trường");
      }
    },
    enabled: !!jobId,
    refetchInterval: (query) => {
      const currentStatus = query.state.data?.status;
      return currentStatus === "pending" || currentStatus === undefined ? 3000 : false;
    },
  });

  // Khi pipeline hoàn tất, làm mới danh sách lịch sử phân tích để hiển thị bản ghi mới.
  const previousStatusRef = useRef<WorkflowJobResponse["status"] | null>(null);
  useEffect(() => {
    if (data?.status === "done" && previousStatusRef.current !== "done") {
      void queryClient.invalidateQueries({ queryKey: ["market-analysis-history"] });
    }
    previousStatusRef.current = data?.status ?? null;
  }, [data?.status, queryClient]);

  const startJob = useCallback(async (date?: string) => {
    setStartError(null);
    setRetryError(null);
    try {
      const { data } = await apiAxios.post<{ message: string; jobId: string }>(
        "/news-manager/market-analysis-workflow",
        date ? { date } : {},
      );
      setJobId(data.jobId);
    } catch (err: any) {
      const message =
        err?.response?.status === 409
          ? err?.response?.data?.message ?? "Đang có phân tích thị trường đang chạy"
          : err?.response?.data?.message ?? "Không thể bắt đầu phân tích thị trường";
      setStartError(message);
      throw err;
    }
  }, []);

  const retryMutation = useMutation({
    mutationFn: async (currentJobId: string) => {
      await apiAxios.post(`/news-manager/market-analysis-workflow/${currentJobId}/retry`);
    },
    onSuccess: (_data, currentJobId) => {
      setRetryError(null);
      // Giữ jobId và progress của job cũ; chỉ chuyển step lỗi sang running để
      // query tiếp tục poll ngay trong lúc backend chạy lại phần còn lại.
      queryClient.setQueryData<WorkflowJobResponse>(
        ["market-analysis-workflow-job", currentJobId],
        (previous) =>
          previous
            ? {
                ...previous,
                status: "pending",
                error: undefined,
                steps: previous.steps?.map((step) =>
                  step.status === "error"
                    ? { ...step, status: "running" as const, error: undefined }
                    : step,
                ),
              }
            : previous,
      );
      void queryClient.refetchQueries({
        queryKey: ["market-analysis-workflow-job", currentJobId],
        exact: true,
      });
    },
    onError: (err: any) => {
      setRetryError(
        err?.response?.data?.message ?? "Không thể thử lại bước phân tích bị lỗi",
      );
    },
  });

  const retryFailedStep = useCallback(async () => {
    if (!jobId) return;
    setRetryError(null);
    await retryMutation.mutateAsync(jobId);
  }, [jobId, retryMutation]);

  const resetJob = useCallback(() => {
    setJobId(null);
    setStartError(null);
    setRetryError(null);
  }, []);

  const jobState: WorkflowJobResponse | null = jobId ? data ?? { status: "pending" } : null;
  const isRunning = jobState?.status === "pending";

  return (
    <MarketAnalysisWorkflowJobContext.Provider
      value={{
        jobState,
        isRunning,
        startError,
        startJob,
        retryFailedStep,
        isRetrying: retryMutation.isPending,
        retryError,
        resetJob,
      }}
    >
      {children}
    </MarketAnalysisWorkflowJobContext.Provider>
  );
};
