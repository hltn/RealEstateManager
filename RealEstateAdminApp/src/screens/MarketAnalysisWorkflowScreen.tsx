import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import ReactMarkdown from "react-markdown";
import { CheckCircle2, XCircle, Loader2, Circle, History, RotateCcw, Eye } from "lucide-react";
import { DatePicker } from "../components/ui/DatePicker";
import apiAxios from "../api/axios";
import {
  useMarketAnalysisWorkflowJob,
  DEFAULT_STEPS,
  type WorkflowStepState,
} from "../context/MarketAnalysisWorkflowJobContext";

/** Bản ghi lịch sử phân tích thị trường (mirror `MarketAnalysisHistory` schema). */
interface MarketAnalysisHistoryItem {
  _id: string;
  content: string;
  articleIds: string[];
  createdAt: string;
}

interface MarketAnalysisHistoryPage {
  data: MarketAnalysisHistoryItem[];
  meta: {
    hasMore: boolean;
    nextCursor: string | null;
  };
}

/** Hiển thị thống nhất theo định dạng dd/MM/yyyy HH:mm:ss tại Việt Nam. */
function formatHistoryTimestamp(timestamp: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return timestamp;

  const parts = new Intl.DateTimeFormat("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return `${value("day")}/${value("month")}/${value("year")} ${value("hour")}:${value("minute")}:${value("second")}`;
}

/** Lấy ngày hôm nay dạng YYYY-MM-DD theo giờ Việt Nam (UTC+7). */
function getTodayVNString(): string {
  const now = new Date();
  const vnTime = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  return vnTime.toISOString().split("T")[0];
}

/** 1 card trong workflow visualization — màu/icon theo status. */
const StepCard: React.FC<{
  step: WorkflowStepState;
  isLast: boolean;
  onRetry?: () => void;
  isRetrying?: boolean;
}> = ({ step, isLast, onRetry, isRetrying = false }) => {
  const config = {
    pending: {
      icon: <Circle className="w-5 h-5 text-gray-400" />,
      cardClass: "border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/30",
      textClass: "text-gray-500 dark:text-gray-400",
    },
    running: {
      icon: <Loader2 className="w-5 h-5 text-blue-500 animate-spin" />,
      cardClass: "border-blue-400 dark:border-blue-500 bg-blue-50 dark:bg-blue-500/10 shadow-sm",
      textClass: "text-blue-700 dark:text-blue-300 font-semibold",
    },
    done: {
      icon: <CheckCircle2 className="w-5 h-5 text-emerald-500" />,
      cardClass: "border-emerald-300 dark:border-emerald-600 bg-emerald-50 dark:bg-emerald-500/10",
      textClass: "text-emerald-700 dark:text-emerald-300",
    },
    error: {
      icon: <XCircle className="w-5 h-5 text-red-500" />,
      cardClass: "border-red-300 dark:border-red-600 bg-red-50 dark:bg-red-500/10",
      textClass: "text-red-700 dark:text-red-300",
    },
  }[step.status];

  return (
    <div className="flex flex-col md:flex-row items-center md:items-stretch flex-1 min-w-0">
      <div
        className={`flex w-full md:flex-col items-center md:justify-center gap-3 p-3 md:p-4 rounded-xl border-2 flex-1 min-w-0 md:min-w-[120px] transition-colors ${config.cardClass}`}
      >
        <span className="flex min-w-0 flex-1 items-center gap-2 text-xs font-medium text-left md:flex-none md:flex-col md:text-center leading-tight">
          <span className="flex items-center gap-2">
            {config.icon}
            {step.status === "error" && onRetry && (
              <button
                type="button"
                onClick={onRetry}
                disabled={isRetrying}
                aria-label={isRetrying ? "Đang thực hiện lại" : "Thực hiện lại"}
                title={isRetrying ? "Đang thực hiện lại" : "Thực hiện lại"}
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-red-700 transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-60 dark:bg-gray-900/40 dark:text-red-300 dark:hover:bg-gray-900/70"
              >
                {isRetrying ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
              </button>
            )}
          </span>
          <span className={config.textClass}>{`${step.step}.${step.label}`}</span>
        </span>

        {step.status === "error" && step.error && (
          <span className="text-[11px] text-red-500 dark:text-red-400 text-left md:text-center line-clamp-2">
            {step.error}
          </span>
        )}

      </div>
      {!isLast && (
        <div
          aria-hidden="true"
          className="h-5 w-0.5 shrink-0 bg-gray-300 dark:bg-gray-700 md:mx-1 md:h-0.5 md:w-6 md:self-center"
        />
      )}
    </div>
  );
};

/**
 * Màn hình "Phân tích thị trường" — workflow orchestration 5 bước.
 *
 * Layout theo design spec mục 4.3: (1) input ngày + nút bắt đầu, (2) 5 step card
 * trực quan hoá tiến độ real-time (poll qua `MarketAnalysisWorkflowJobContext`),
 * (3) kết quả markdown khi hoàn tất, (4) lịch sử các lần phân tích trước.
 */
const MarketAnalysisWorkflowScreen: React.FC = () => {
  const {
    jobState,
    isRunning,
    startError,
    startJob,
    retryFailedStep,
    isRetrying,
    retryError,
    resetJob,
  } = useMarketAnalysisWorkflowJob();
  const [selectedDate, setSelectedDate] = useState<string>(getTodayVNString());
  const [selectedHistoryContent, setSelectedHistoryContent] = useState<string | null>(null);
  const historyLoadMoreRef = useRef<HTMLDivElement | null>(null);
  const isFetchingHistoryPageRef = useRef(false);

  const steps = jobState?.steps ?? DEFAULT_STEPS;
  const isError = jobState?.status === "error";
  const isDone = jobState?.status === "done";
  const isNotFound = jobState?.status === "not_found";

  const {
    data: historyData,
    isLoading: isHistoryLoading,
    isError: isHistoryError,
    error: historyError,
    hasNextPage,
    fetchNextPage,
    isFetchingNextPage,
    refetch: refetchHistory,
  } = useInfiniteQuery({
    queryKey: ["market-analysis-history"],
    initialPageParam: null as string | null,
    queryFn: async ({ signal, pageParam }) => {
      const { data } = await apiAxios.get<MarketAnalysisHistoryPage>(
        "/news-manager/articles/market-analysis-history",
        { signal, params: pageParam ? { cursor: pageParam } : undefined },
      );
      return {
        data: data.data ?? [],
        meta: data.meta ?? { hasMore: false, nextCursor: null },
      };
    },
    getNextPageParam: (lastPage) => lastPage.meta.hasMore ? lastPage.meta.nextCursor : undefined,
  });
  const history = historyData?.pages.flatMap((page) => page.data) ?? [];
  const loadMoreHistory = useCallback(() => {
    if (!hasNextPage || isFetchingNextPage || isFetchingHistoryPageRef.current) return;
    isFetchingHistoryPageRef.current = true;
    void fetchNextPage().finally(() => {
      isFetchingHistoryPageRef.current = false;
    });
  }, [fetchNextPage, hasNextPage, isFetchingNextPage]);

  useEffect(() => {
    const sentinel = historyLoadMoreRef.current;
    if (!sentinel || !hasNextPage || isFetchingNextPage || typeof IntersectionObserver === "undefined") return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) loadMoreHistory();
      },
      { rootMargin: "200px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, loadMoreHistory]);

  const resultContent = useMemo(() => {
    if (!isDone) return null;
    return jobState?.result?.markdownContent ?? null;
  }, [isDone, jobState]);

  const handleStart = async () => {
    try {
      await startJob(selectedDate);
    } catch {
      // startError đã được set trong context — không cần xử lý thêm ở đây.
    }
  };

  const handleReset = () => {
    resetJob();
  };

  const handleRetryFailedStep = async () => {
    try {
      await retryFailedStep();
    } catch {
      // retryError đã được set trong context; giữ nguyên error/progress hiện tại.
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-6">
        <h1 className="text-xl font-bold text-gray-900 dark:text-white mb-4">
          Phân tích thị trường
        </h1>

        <div className="flex flex-row max-[359px]:flex-col lg:w-[300px] items-center gap-2 mb-6">
          <DatePicker
            value={selectedDate}
            onChange={(dateStr) => setSelectedDate(dateStr)}
            className="min-w-0 flex-1 md:flex-none md:w-44"
          />
          <button
            type="button"
            onClick={handleStart}
            disabled={isRunning || isRetrying}
            className="inline-flex h-11 shrink-0 items-center gap-2 whitespace-nowrap px-5 py-2.5 text-sm font-medium bg-brand-500 hover:bg-brand-600 disabled:bg-gray-300 disabled:cursor-not-allowed dark:disabled:bg-gray-700 text-white rounded-lg transition-colors shadow-sm max-[359px]:w-full max-[359px]:justify-center"
          >
            {isRunning && <Loader2 className="w-4 h-4 animate-spin" />}
            {isRunning ? "Đang phân tích..." : "Phân tích"}
          </button>
          {isNotFound && (
            <button
              type="button"
              onClick={handleReset}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg transition-colors"
            >
              Chạy lại
            </button>
          )}
        </div>

        {startError && (
          <div className="mb-4 p-3 rounded-lg bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-300 text-sm">
            {startError}
          </div>
        )}

        {retryError && (
          <div className="mb-4 p-3 rounded-lg bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-300 text-sm">
            {retryError}
          </div>
        )}

        {isNotFound && (
          <div className="mb-4 p-3 rounded-lg bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-300 text-sm">
            Không tìm thấy job (có thể server đã khởi động lại). Vui lòng chạy lại.
          </div>
        )}

        {/* Workflow visualization — 5 step cards */}
        <div className="flex flex-col md:flex-row items-stretch gap-0 md:gap-2">
          {steps.map((step, index) => (
            <StepCard
              key={step.step}
              step={step}
              isLast={index === steps.length - 1}
              onRetry={isError ? handleRetryFailedStep : undefined}
              isRetrying={isRetrying}
            />
          ))}
        </div>

        {/* Kết quả khi hoàn tất */}
        {isDone && resultContent && (
          <div className="mt-6 p-6 rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/50 prose prose-sm dark:prose-invert max-w-none whitespace-pre-wrap">
            <ReactMarkdown>{resultContent.replace(/\\n/g, "\n")}</ReactMarkdown>
          </div>
        )}
      </div>

      {/* Lịch sử phân tích */}
      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-6">
        <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-4">
          Lịch sử phân tích
        </h2>
        {isHistoryLoading ? (
          <div className="flex justify-center items-center h-24" role="status" aria-label="Đang tải lịch sử phân tích">
            <Loader2 className="w-6 h-6 animate-spin text-brand-500" />
          </div>
        ) : isHistoryError ? (
          <div className="flex flex-col items-center justify-center h-32 gap-3 text-center">
            <p className="text-sm text-red-600 dark:text-red-400" role="alert">
              Không thể tải lịch sử phân tích{historyError instanceof Error && historyError.message ? `: ${historyError.message}` : "."}
            </p>
            <button
              type="button"
              onClick={() => void refetchHistory()}
              className="px-3 py-2 text-sm font-medium rounded-lg bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 transition-colors"
            >
              Thử lại
            </button>
          </div>
        ) : history.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 gap-2">
            <History className="w-10 h-10 text-gray-300 dark:text-gray-600" />
            <p className="text-sm text-gray-500 dark:text-gray-400">Chưa có lịch sử phân tích.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {history.map((item, index) => (
              <div
                key={item._id}
                className="flex gap-3 p-4 border border-gray-200 dark:border-gray-700 rounded-xl hover:border-brand-500 dark:hover:border-brand-500 transition-colors bg-gray-50 dark:bg-gray-800/30"
              >
                <button
                  type="button"
                  onClick={() => setSelectedHistoryContent(item.content)}
                  className="min-w-0 flex-1 text-left rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                  aria-label={`Mở chi tiết phân tích ${index + 1}`}
                >
                  <div className="font-semibold text-gray-900 dark:text-white text-sm mb-1">
                    {index + 1}. {formatHistoryTimestamp(item.createdAt)}
                  </div>
                  <div className="text-sm text-gray-600 dark:text-gray-400 line-clamp-2">
                    {item.content.slice(0, 100)}
                    {item.content.length > 100 ? "..." : ""}
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedHistoryContent(item.content)}
                  className="shrink-0 inline-flex self-center items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg text-brand-700 dark:text-brand-300 bg-brand-50 hover:bg-brand-100 dark:bg-brand-500/10 dark:hover:bg-brand-500/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 transition-colors"
                  aria-label={`Xem chi tiết phân tích ${index + 1}`}
                >
                  <Eye className="w-4 h-4" aria-hidden="true" />
                  Xem
                </button>
              </div>
            ))}
            <div ref={historyLoadMoreRef} aria-live="polite" className="py-2 text-center">
              {isFetchingNextPage ? (
                <span className="inline-flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400" role="status">
                  <Loader2 className="w-4 h-4 animate-spin" /> Đang tải thêm...
                </span>
              ) : hasNextPage ? (
                <button
                  type="button"
                  onClick={loadMoreHistory}
                  className="text-sm font-medium text-brand-600 hover:text-brand-700 dark:text-brand-400 dark:hover:text-brand-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 rounded"
                >
                  Tải thêm
                </button>
              ) : (
                <span className="text-sm text-gray-500 dark:text-gray-400">Đã hiển thị tất cả lịch sử.</span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Modal xem chi tiết lịch sử */}
      {selectedHistoryContent && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-xl w-full max-w-4xl max-h-[80vh] flex flex-col overflow-hidden border border-gray-200 dark:border-gray-800">
            <div className="flex items-center justify-between p-4 border-b border-gray-100 dark:border-gray-800 shrink-0">
              <h3 className="text-lg font-bold text-gray-900 dark:text-white">Chi tiết phân tích</h3>
              <button
                type="button"
                onClick={() => setSelectedHistoryContent(null)}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
              >
                <XCircle className="w-6 h-6" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 prose prose-sm dark:prose-invert max-w-none whitespace-pre-wrap">
              <ReactMarkdown>{selectedHistoryContent.replace(/\\n/g, "\n")}</ReactMarkdown>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default MarketAnalysisWorkflowScreen;
