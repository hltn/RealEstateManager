import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import ReactMarkdown from "react-markdown";
import { CheckCircle2, XCircle, Loader2, Circle, History, RotateCcw, X } from "lucide-react";
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

/** Lấy ngày hôm nay dạng YYYY-MM-DD theo giờ Việt Nam (UTC+7). */
function getTodayVNString(): string {
  const now = new Date();
  const vnTime = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  return vnTime.toISOString().split("T")[0];
}

/** 1 card trong workflow visualization — màu/icon theo status. */
const StepCard: React.FC<{ step: WorkflowStepState; isLast: boolean }> = ({ step, isLast }) => {
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
        <span
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-xs font-bold ${config.textClass}`}
          aria-label={`Bước ${step.step}`}
        >
          {step.step}
        </span>
        <span className="flex min-w-0 flex-1 items-center gap-2 text-xs font-medium text-left md:flex-none md:flex-col md:text-center leading-tight">
          {config.icon}
          <span className={config.textClass}>{step.label}</span>
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
          className="h-5 w-0.5 shrink-0 bg-gray-300 dark:bg-gray-700 md:mx-1 md:h-0.5 md:w-6"
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

  const steps = jobState?.steps ?? DEFAULT_STEPS;
  const isError = jobState?.status === "error";
  const isDone = jobState?.status === "done";
  const isNotFound = jobState?.status === "not_found";

  const { data: historyData, isLoading: isHistoryLoading } = useQuery<MarketAnalysisHistoryItem[]>({
    queryKey: ["market-analysis-history"],
    queryFn: async ({ signal }) => {
      const { data } = await apiAxios.get<{ data?: MarketAnalysisHistoryItem[] }>(
        "/news-manager/articles/market-analysis-history",
        { signal },
      );
      return data.data ?? [];
    },
  });
  const history = historyData ?? [];

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

        <div className="flex flex-row max-[359px]:flex-col items-center gap-2 mb-6">
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
            <StepCard key={step.step} step={step} isLast={index === steps.length - 1} />
          ))}
        </div>

        {isError && (
          <div className="mt-4 flex items-center justify-end gap-2" role="group" aria-label="Thao tác lỗi workflow">
            <button
              type="button"
              onClick={handleRetryFailedStep}
              disabled={isRetrying}
              aria-label={isRetrying ? "Đang thực hiện lại" : "Thực hiện lại"}
              title={isRetrying ? "Đang thực hiện lại" : "Thực hiện lại"}
              className="inline-flex h-11 w-11 items-center justify-center rounded-lg bg-gray-100 text-gray-700 transition-colors hover:bg-gray-200 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
            >
              {isRetrying ? <Loader2 className="h-5 w-5 animate-spin" /> : <RotateCcw className="h-5 w-5" />}
            </button>
            <button
              type="button"
              onClick={handleReset}
              aria-label="Đóng thông báo lỗi"
              title="Đóng thông báo lỗi"
              className="inline-flex h-11 w-11 items-center justify-center rounded-lg bg-gray-100 text-gray-700 transition-colors hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        )}

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
          <div className="flex justify-center items-center h-24">
            <Loader2 className="w-6 h-6 animate-spin text-brand-500" />
          </div>
        ) : history.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 gap-2">
            <History className="w-10 h-10 text-gray-300 dark:text-gray-600" />
            <p className="text-sm text-gray-500 dark:text-gray-400">Chưa có lịch sử phân tích.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {history.map((item) => (
              <button
                type="button"
                key={item._id}
                onClick={() => setSelectedHistoryContent(item.content)}
                className="w-full text-left p-4 border border-gray-200 dark:border-gray-700 rounded-xl hover:border-brand-500 dark:hover:border-brand-500 transition-colors bg-gray-50 dark:bg-gray-800/30"
              >
                <div className="font-semibold text-gray-900 dark:text-white text-sm mb-1">
                  Phân tích lúc {new Date(item.createdAt).toLocaleString("vi-VN")}
                </div>
                <div className="text-sm text-gray-600 dark:text-gray-400 line-clamp-2">
                  {item.content.slice(0, 100)}
                  {item.content.length > 100 ? "..." : ""}
                </div>
              </button>
            ))}
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
