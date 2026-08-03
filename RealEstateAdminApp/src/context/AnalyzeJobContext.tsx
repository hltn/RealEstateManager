import { createContext, useContext, useState, useEffect, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import apiAxios from "../api/axios";

export type AnalyzeJobStatus = "idle" | "pending" | "done" | "error";

interface AnalyzeJobResponse {
  status: "pending" | "done" | "error" | "not_found";
  result?: unknown[];
  error?: string;
}

interface AnalyzeJobContextType {
  status: AnalyzeJobStatus;
  errorMessage: string | null;
  /** Bắt đầu theo dõi 1 job mới (gọi ngay sau khi POST /analyze-raw trả về jobId). */
  startJob: (jobId: string) => void;
  /** Ẩn badge kết quả (done/error) sau khi user đã đọc. Giữ nguyên jobId/poll. */
  clearResult: () => void;
  /**
   * Reset đầy đủ trạng thái AnalyzeJob: clear jobId (dừng React Query poll),
   * finishedStatus, errorMessage và xoá query data cũ tránh stale khi start job mới.
   * Job vẫn chạy server-side — chỉ dừng hiển thị/poll client.
   */
  reset: () => void;
}

const AnalyzeJobContext = createContext<AnalyzeJobContextType | undefined>(undefined);

export const useAnalyzeJob = () => {
  const context = useContext(AnalyzeJobContext);
  if (!context) {
    throw new Error("useAnalyzeJob must be used within an AnalyzeJobProvider");
  }
  return context;
};

export const AnalyzeJobProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const queryClient = useQueryClient();
  const [jobId, setJobId] = useState<string | null>(null);
  const [finishedStatus, setFinishedStatus] = useState<"done" | "error" | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Poll độc lập với màn hình hiện tại — provider sống ở AppLayout nên vẫn
  // tiếp tục chạy dù user rời khỏi RawArticlesScreen.
  const { data, isError, error } = useQuery<AnalyzeJobResponse>({
    queryKey: ["analyze-raw-job", jobId],
    queryFn: async ({ signal }) => {
      try {
        const { data } = await apiAxios.get<AnalyzeJobResponse>(
          `/news-manager/analyze-raw/${jobId}`,
          { signal },
        );
        return data;
      } catch {
        throw new Error("Không lấy được trạng thái job phân tích");
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
      setErrorMessage(error?.message ?? "Lỗi không xác định khi poll job phân tích");
      return;
    }

    if (!data) return;

    if (data.status === "done") {
      setJobId(null);
      setFinishedStatus("done");
      void queryClient.invalidateQueries({ queryKey: ["raw-articles"] });
    } else if (data.status === "error") {
      setJobId(null);
      setFinishedStatus("error");
      setErrorMessage(data.error ?? "Lỗi không xác định");
    } else if (data.status === "not_found") {
      // Job hết TTL hoặc server đã restart — dừng poll, coi như lỗi để user biết.
      setJobId(null);
      setFinishedStatus("error");
      setErrorMessage("Không tìm thấy job (có thể server đã khởi động lại)");
    }
  }, [data, isError, error, jobId, queryClient]);

  const startJob = useCallback((newJobId: string) => {
    setFinishedStatus(null);
    setErrorMessage(null);
    setJobId(newJobId);
  }, []);

  const clearResult = useCallback(() => {
    setFinishedStatus(null);
    setErrorMessage(null);
  }, []);

  // Reset đầy đủ khi user rời màn hình/sang op async khác: clear jobId để
  // useQuery enabled=false tự dừng poll, đồng thời removeQueries tránh stale
  // data kẹt ở key ["analyze-raw-job"] khi start job mới cùng key.
  const reset = useCallback(() => {
    setJobId(null);
    setFinishedStatus(null);
    setErrorMessage(null);
    queryClient.removeQueries({ queryKey: ["analyze-raw-job"] });
  }, [queryClient]);

  const status: AnalyzeJobStatus = jobId ? "pending" : finishedStatus ?? "idle";

  return (
    <AnalyzeJobContext.Provider value={{ status, errorMessage, startJob, clearResult, reset }}>
      {children}
    </AnalyzeJobContext.Provider>
  );
};
