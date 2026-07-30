import { createContext, useContext, useState, useEffect, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import apiAxios from "../api/axios";
import { useManageWpStatus } from "./ManageWpStatusContext";

/** Phản hồi từ GET /news-manager/articles/market-analysis-bulk/:jobId. */
export interface BulkCrawlJobResponse {
  status: "pending" | "done" | "error" | "not_found";
  result?: unknown;
  error?: string;
}

interface BulkCrawlJobContextType {
  /** Bắt đầu theo dõi 1 job crawl bulk (gọi ngay sau khi POST /market-analysis-bulk trả về jobId). */
  startJob: (jobId: string) => void;
}

const BulkCrawlJobContext = createContext<BulkCrawlJobContextType | undefined>(undefined);

export const useBulkCrawlJob = () => {
  const context = useContext(BulkCrawlJobContext);
  if (!context) {
    throw new Error("useBulkCrawlJob must be used within a BulkCrawlJobProvider");
  }
  return context;
};

/**
 * Poll trạng thái job crawl tin tức hàng loạt (action `analyze` ở ManageWpScreen).
 *
 * Provider sống ở AppLayout nên việc poll độc lập với ManageWpScreen — vẫn chạy
 * dù user rời khỏi màn. Khi job kết thúc, provider đẩy trạng thái vào
 * ManageWpStatusContext (để CrawlStatusBadge trên header hiển thị) và làm mới
 * danh sách `wp-articles` khi crawl xong.
 */
export const BulkCrawlJobProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const queryClient = useQueryClient();
  const { setCrawlStatus } = useManageWpStatus();
  const [jobId, setJobId] = useState<string | null>(null);

  const { data, isError, error } = useQuery<BulkCrawlJobResponse>({
    queryKey: ["bulk-crawl-job", jobId],
    queryFn: async ({ signal }) => {
      try {
        const { data } = await apiAxios.get<BulkCrawlJobResponse>(
          `/news-manager/articles/market-analysis-bulk/${jobId}`,
          { signal },
        );
        return data;
      } catch {
        throw new Error("Không lấy được trạng thái job crawl tin tức");
      }
    },
    enabled: !!jobId,
    refetchInterval: (query) => {
      const currentStatus = query.state.data?.status;
      // Vẫn poll khi đang pending hoặc chưa có data lần đầu (undefined).
      return currentStatus === "pending" || currentStatus === undefined ? 3000 : false;
    },
  });

  useEffect(() => {
    if (!jobId) return;

    // Polling thất bại sau khi React Query đã retry (mặc định 3 lần) — dừng poll
    // và báo lỗi để header badge không bị kẹt ở 'pending' mãi mãi.
    if (isError) {
      setJobId(null);
      setCrawlStatus("error", error?.message ?? "Lỗi không xác định khi poll job crawl");
      return;
    }

    if (!data) return;

    if (data.status === "done") {
      setJobId(null);
      setCrawlStatus("done");
      // Làm mới danh sách bài viết để dữ liệu vừa crawl xuất hiện.
      void queryClient.invalidateQueries({ queryKey: ["wp-articles"] });
    } else if (data.status === "error") {
      setJobId(null);
      setCrawlStatus("error", data.error ?? "Lỗi không xác định");
    } else if (data.status === "not_found") {
      // Job hết TTL hoặc server đã restart — dừng poll, coi như lỗi để user biết.
      setJobId(null);
      setCrawlStatus("error", "Không tìm thấy job (có thể server đã khởi động lại)");
    }
  }, [data, jobId, queryClient, setCrawlStatus]);

  const startJob = useCallback(
    (newJobId: string) => {
      setCrawlStatus("pending");
      setJobId(newJobId);
    },
    [setCrawlStatus],
  );

  return (
    <BulkCrawlJobContext.Provider value={{ startJob }}>
      {children}
    </BulkCrawlJobContext.Provider>
  );
};
