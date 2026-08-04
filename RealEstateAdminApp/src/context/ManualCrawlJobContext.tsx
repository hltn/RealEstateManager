import { createContext, useContext, useState, useEffect, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import apiAxios from "../api/axios";
import { useManageWpStatus } from "./ManageWpStatusContext";

/** Thống kê chi tiết kết quả crawl từ CustomCrawlerService.crawlData (backend). */
export interface CrawlStats {
  successfulSources: number;
  failedSources: number;
  totalArticles: number;
  successfulDetails?: { url: string; count: number }[];
  failedDetails?: { url: string }[];
}

/** Phản hồi từ GET /news-manager/crawl/:jobId. */
export interface ManualCrawlJobResponse {
  status: "pending" | "done" | "error" | "not_found";
  result?: { stats?: CrawlStats; count?: number; filePath?: string };
  error?: string;
}

interface ManualCrawlJobContextType {
  /** Bắt đầu theo dõi 1 job crawl thủ công (gọi ngay sau khi POST /crawl trả về jobId). */
  startJob: (jobId: string) => void;
  /** Kết quả khi job done (count/stats). Reset khi startJob mới. */
  doneResult: ManualCrawlJobResponse["result"] | null;
}

const ManualCrawlJobContext = createContext<ManualCrawlJobContextType | undefined>(undefined);

export const useManualCrawlJob = () => {
  const context = useContext(ManualCrawlJobContext);
  if (!context) {
    throw new Error("useManualCrawlJob must be used within a ManualCrawlJobProvider");
  }
  return context;
};

/**
 * Poll trạng thái job thu thập thủ công (nút "Chạy quy trình thu thập" ở RawArticlesScreen).
 *
 * Provider sống ở AppLayout nên việc poll độc lập với RawArticlesScreen — vẫn chạy
 * dù user rời màn. Khi job kết thúc, provider đẩy trạng thái vào ManageWpStatusContext
 * (để CrawlStatusBadge trên header hiển thị, dùng chung với bulk crawl) và làm mới
 * danh sách `raw-articles` khi crawl xong.
 */
export const ManualCrawlJobProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const queryClient = useQueryClient();
  const { setCrawlStatus } = useManageWpStatus();
  const [jobId, setJobId] = useState<string | null>(null);
  const [doneResult, setDoneResult] = useState<ManualCrawlJobResponse["result"] | null>(null);

  const { data, isError, error } = useQuery<ManualCrawlJobResponse>({
    queryKey: ["manual-crawl-job", jobId],
    queryFn: async ({ signal }) => {
      try {
        const { data } = await apiAxios.get<ManualCrawlJobResponse>(
          `/news-manager/crawl/${jobId}`,
          { signal },
        );
        return data;
      } catch {
        throw new Error("Không lấy được trạng thái job thu thập");
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

    if (isError) {
      setJobId(null);
      setCrawlStatus("error", error?.message ?? "Lỗi không xác định khi poll job thu thập");
      return;
    }

    if (!data) return;

    if (data.status === "done") {
      setDoneResult(data.result ?? null);
      setJobId(null);
      setCrawlStatus("done");
      // Làm mới danh sách raw-articles để dữ liệu vừa crawl xuất hiện.
      void queryClient.invalidateQueries({ queryKey: ["raw-articles"] });
    } else if (data.status === "error") {
      setJobId(null);
      setCrawlStatus("error", data.error ?? "Lỗi không xác định");
    } else if (data.status === "not_found") {
      setJobId(null);
      setCrawlStatus("error", "Không tìm thấy job (có thể server đã khởi động lại)");
    }
  }, [data, isError, error, jobId, queryClient, setCrawlStatus]);

  const startJob = useCallback(
    (newJobId: string) => {
      setDoneResult(null);
      setCrawlStatus("pending");
      setJobId(newJobId);
    },
    [setCrawlStatus],
  );

  return (
    <ManualCrawlJobContext.Provider value={{ startJob, doneResult }}>
      {children}
    </ManualCrawlJobContext.Provider>
  );
};
