import { createContext, useContext, useState, useEffect, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import apiAxios from "../api/axios";
import { useManageWpStatus } from "./ManageWpStatusContext";

export type MarketAnalysisJobStatus = "idle" | "pending" | "done" | "error";

interface MarketAnalysisJobResponse {
  status: "pending" | "done" | "error" | "not_found";
  result?: string;
  error?: string;
}

interface MarketAnalysisJobContextType {
  status: MarketAnalysisJobStatus;
  errorMessage: string | null;
  /** Nội dung markdown phân tích thị trường khi status = 'done'. */
  resultContent: string | null;
  /** Bắt đầu theo dõi 1 job mới (gọi ngay sau khi POST /analyze-market-trends trả về jobId). */
  startJob: (jobId: string) => void;
  /** Ẩn kết quả (done/error) sau khi user đã đọc. */
  clearResult: () => void;
}

const MarketAnalysisJobContext = createContext<MarketAnalysisJobContextType | undefined>(
  undefined,
);

export const useMarketAnalysisJob = () => {
  const context = useContext(MarketAnalysisJobContext);
  if (!context) {
    throw new Error("useMarketAnalysisJob must be used within a MarketAnalysisJobProvider");
  }
  return context;
};

export const MarketAnalysisJobProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const queryClient = useQueryClient();
  const { setMarketAnalysisStatus } = useManageWpStatus();
  const [jobId, setJobId] = useState<string | null>(null);
  const [finishedStatus, setFinishedStatus] = useState<"done" | "error" | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [resultContent, setResultContent] = useState<string | null>(null);

  // Poll độc lập với màn hình hiện tại — provider sống ở AppLayout nên vẫn
  // tiếp tục chạy dù user rời khỏi ManageWpScreen.
  const { data, isError, error } = useQuery<MarketAnalysisJobResponse>({
    queryKey: ["market-analysis-job", jobId],
    queryFn: async ({ signal }) => {
      try {
        const { data } = await apiAxios.get<MarketAnalysisJobResponse>(
          `/news-manager/articles/analyze-market-trends/${jobId}`,
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

  useEffect(() => {
    if (!jobId) return;

    // Polling thất bại sau khi React Query đã retry (mặc định 3 lần) — dừng poll
    // và báo lỗi để header badge không bị kẹt ở 'pending' mãi mãi.
    if (isError) {
      setJobId(null);
      setFinishedStatus("error");
      setErrorMessage(error?.message ?? "Lỗi không xác định khi poll job phân tích thị trường");
      setMarketAnalysisStatus("error", error?.message ?? "Lỗi không xác định");
      return;
    }

    if (!data) return;

    if (data.status === "done") {
      setJobId(null);
      setFinishedStatus("done");
      setResultContent(data.result ?? null);
      setMarketAnalysisStatus("done");
      void queryClient.invalidateQueries({ queryKey: ["market-analysis-history"] });
    } else if (data.status === "error") {
      setJobId(null);
      setFinishedStatus("error");
      setErrorMessage(data.error ?? "Lỗi không xác định");
      setMarketAnalysisStatus("error", data.error ?? "Lỗi không xác định");
    } else if (data.status === "not_found") {
      // Job hết TTL hoặc server đã restart — dừng poll, coi như lỗi để user biết.
      setJobId(null);
      setFinishedStatus("error");
      setErrorMessage("Không tìm thấy job (có thể server đã khởi động lại)");
      setMarketAnalysisStatus("error", "Không tìm thấy job (có thể server đã khởi động lại)");
    }
  }, [data, isError, error, jobId, queryClient, setMarketAnalysisStatus]);

  const startJob = useCallback((newJobId: string) => {
    setFinishedStatus(null);
    setErrorMessage(null);
    setResultContent(null);
    setJobId(newJobId);
  }, []);

  const clearResult = useCallback(() => {
    setFinishedStatus(null);
    setErrorMessage(null);
    setResultContent(null);
  }, []);

  const status: MarketAnalysisJobStatus = jobId ? "pending" : finishedStatus ?? "idle";

  return (
    <MarketAnalysisJobContext.Provider
      value={{ status, errorMessage, resultContent, startJob, clearResult }}
    >
      {children}
    </MarketAnalysisJobContext.Provider>
  );
};
