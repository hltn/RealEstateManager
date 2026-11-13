import { useCallback } from "react";
import { useAnalyzeJob } from "../context/AnalyzeJobContext";
import { useManageWpStatus } from "../context/ManageWpStatusContext";

/**
 * Reset tất cả status badge trên header về idle. Gọi ngay trước khi
 * start 1 op async mới để tránh badge cũ (pending/done/error) cộng dồn —
 * cùng lúc hiển thị nhiều badge khiến user rối.
 *
 * Đối với AnalyzeJob dùng reset() (clear jobId → dừng poll) thay vì
 * clearResult() (chỉ ẩn badge done/error, giữ jobId → badge pending kẹt).
 *
 * Lưu ý: gọi trước khi set pending/start job của chính op hiện tại là an toàn,
 * vì lệnh set pending chạy sau reset trong cùng handler nên React sẽ ghi đè
 * (cùng slot state, lệnh sau thắng).
 */
export function useHeaderStatusReset() {
  const { clearCrawlStatus, clearMarketAnalysisStatus } = useManageWpStatus();
  const { reset } = useAnalyzeJob();

  return useCallback(() => {
    clearCrawlStatus();
    clearMarketAnalysisStatus();
    reset();
  }, [clearCrawlStatus, clearMarketAnalysisStatus, reset]);
}
