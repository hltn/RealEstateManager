import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertCircle, Search, Server, Globe, Zap, Clock, Eye } from "lucide-react";
import { Pagination } from "../components/common/Pagination";
import { TableSkeletonRows } from "../components/common/TableSkeletonRows";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { buildListQuery, fetchPaginated } from "../utils/fetchPaginated";
import { DEFAULT_PAGE_SIZE } from "../types/pagination";
import type { PaginatedResponse } from "../types/pagination";

/** Một bản ghi log request gửi ra ngoài (ExternalRequestLog). */
interface ExternalRequestLog {
  _id: string;
  type: "CRAWL_OUTGOING" | "AI_OUTGOING";
  targetService: string;
  method: string;
  url: string;
  statusCode: number;
  durationMs: number;
  sourceModule: string;
  createdAt: string;
  request?: {
    headers?: Record<string, string>;
    query?: Record<string, string>;
    params?: Record<string, string>;
    body?: unknown;
    prompt?: string;
  };
  response?: {
    headers?: Record<string, string>;
    body?: unknown;
    usage?: unknown;
  };
  error?: {
    message?: string;
    code?: string;
    stack?: string;
  };
  metadata?: Record<string, unknown>;
}

type SortOrder = "newest" | "oldest";
type LogType = "CRAWL_OUTGOING" | "AI_OUTGOING" | "all";

const EXTERNAL_LOGS_ENDPOINT = "/external-logs";

/** Định dạng ngày giờ: dd/MM/yyyy HH:mm:ss */
const formatDateTime = (iso: string): string => {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleString("vi-VN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return iso;
  }
};

/** Badge màu cho type log. */
const TypeBadge = ({ type }: { type: ExternalRequestLog["type"] }) => {
  if (type === "CRAWL_OUTGOING") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400">
        <Globe size={12} />
        CRAWL
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-700 dark:bg-purple-500/15 dark:text-purple-400">
      <Zap size={12} />
      AI
    </span>
  );
};

/** Badge màu cho status code. */
const StatusBadge = ({ code }: { code: number }) => {
  const isSuccess = code >= 200 && code < 300;
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
        isSuccess
          ? "bg-success-100 text-success-700 dark:bg-success-500/15 dark:text-success-400"
          : "bg-error-100 text-error-700 dark:bg-error-500/15 dark:text-error-400"
      }`}
    >
      {code}
    </span>
  );
};

/** Truncate URL dài. */
const TruncatedUrl = ({ url, method }: { url: string; method: string }) => {
  const displayUrl = url.length > 60 ? url.slice(0, 57) + "..." : url;
  return (
    <span className="font-mono text-xs text-gray-600 dark:text-gray-400" title={`${method} ${url}`}>
      <span className="font-semibold text-gray-800 dark:text-white/80">{method}</span>{" "}
      {displayUrl}
    </span>
  );
};

export default function ExternalLogsScreen() {
  const [error, setError] = useState("");

  // Filter state
  const [logType, setLogType] = useState<LogType>("all");
  const [statusCodeInput, setStatusCodeInput] = useState("");
  const [targetServiceInput, setTargetServiceInput] = useState("");
  const [dateRange, setDateRange] = useState({ startDate: "", endDate: "" });
  const [sortOrder, setSortOrder] = useState<SortOrder>("newest");
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(DEFAULT_PAGE_SIZE);

  // Debounce text inputs
  const statusCode = useDebouncedValue(statusCodeInput, 400);
  const targetService = useDebouncedValue(targetServiceInput, 400);

  // Reset page về 1 khi filter thay đổi
  const filterSignature = `${logType}|${statusCode}|${targetService}|${dateRange.startDate}|${dateRange.endDate}|${sortOrder}|${limit}`;
  const [prevFilterSignature, setPrevFilterSignature] = useState(filterSignature);
  if (prevFilterSignature !== filterSignature) {
    setPrevFilterSignature(filterSignature);
    setPage(1);
  }

  const queryString = buildListQuery({
    type: logType === "all" ? undefined : logType,
    statusCode: statusCode || undefined,
    targetService: targetService || undefined,
    startDate: dateRange.startDate || undefined,
    endDate: dateRange.endDate || undefined,
    page,
    limit,
    sort: sortOrder,
  });

  const {
    data: logsPage,
    isLoading,
    isFetching,
    isPlaceholderData,
    refetch,
    error: queryError,
  } = useQuery<PaginatedResponse<ExternalRequestLog>, Error>({
    queryKey: [
      "external-logs",
      { logType, statusCode, targetService, startDate: dateRange.startDate, endDate: dateRange.endDate, sortOrder, page, limit },
    ],
    queryFn: ({ signal }) =>
      fetchPaginated<ExternalRequestLog>(
        `${EXTERNAL_LOGS_ENDPOINT}?${queryString}`,
        page,
        limit,
        signal,
      ),
    placeholderData: (previousData) => previousData,
  });

  // Reset error khi query thay đổi thành công
  const displayError = error || queryError?.message || "";

  const logs = logsPage?.data ?? [];
  const meta = logsPage?.meta ?? { total: 0, page, limit, totalPages: 0 };

  // Nếu trang hiện tại lớn hơn totalPages thì lùi về trang cuối
  if (meta.totalPages > 0 && page > meta.totalPages) {
    setPage(meta.totalPages);
  }

  const changePage = (nextPage: number) => {
    setPage(nextPage);
  };

  // Modal detail state
  const [detailLog, setDetailLog] = useState<ExternalRequestLog | null>(null);

  return (
    <div className="w-full flex flex-col gap-6">
      <header className="flex flex-col gap-2 pb-6 border-b border-gray-200 dark:border-white/[0.05]">
        <h2 className="text-title-sm font-semibold text-gray-800 dark:text-white/90">Request Logs</h2>
        <p className="text-theme-sm text-gray-500 dark:text-gray-400 max-w-2xl leading-relaxed">
          Nhật ký các request gửi ra ngoài từ hệ thống (Crawl dữ liệu, Gọi AI, ...). Hỗ trợ lọc theo loại, status code, service đích và khoảng thời gian.
        </p>
      </header>

      {displayError && (
        <div className="p-4 rounded-lg bg-error-50 dark:bg-error-500/15 border border-error-100 dark:border-error-500/25 flex items-center gap-3 text-error-500">
          <AlertCircle className="shrink-0" size={20} />
          <span className="text-theme-sm font-medium">{displayError}</span>
        </div>
      )}

      {/* Filter bar */}
      <div className="flex flex-col md:flex-row flex-wrap gap-4 p-4 rounded-2xl border border-gray-200 dark:border-white/[0.05] bg-white dark:bg-white/[0.03]">
        {/* Type filter */}
        <div className="flex flex-col gap-1.5">
          <label className="text-theme-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Loại</label>
          <select
            className="px-3 py-2 border border-gray-200 dark:border-white/[0.1] rounded-lg bg-white dark:bg-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 min-w-[160px]"
            value={logType}
            onChange={(e) => setLogType(e.target.value as LogType)}
            aria-label="Lọc theo loại log"
          >
            <option value="all">Tất cả</option>
            <option value="CRAWL_OUTGOING">CRAWL_OUTGOING</option>
            <option value="AI_OUTGOING">AI_OUTGOING</option>
          </select>
        </div>

        {/* Status code filter */}
        <div className="flex flex-col gap-1.5">
          <label className="text-theme-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Status Code</label>
          <input
            type="text"
            placeholder="VD: 200, 404..."
            aria-label="Lọc theo status code"
            className="px-3 py-2 border border-gray-200 dark:border-white/[0.1] rounded-lg bg-white dark:bg-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 w-[140px]"
            value={statusCodeInput}
            onChange={(e) => {
              const val = e.target.value.replace(/\D/g, "");
              setStatusCodeInput(val);
            }}
          />
        </div>

        {/* Target service filter */}
        <div className="flex flex-col gap-1.5">
          <label className="text-theme-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Target Service</label>
          <input
            type="text"
            placeholder="Tên service..."
            aria-label="Lọc theo target service"
            className="px-3 py-2 border border-gray-200 dark:border-white/[0.1] rounded-lg bg-white dark:bg-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 w-[200px]"
            value={targetServiceInput}
            onChange={(e) => setTargetServiceInput(e.target.value)}
          />
        </div>

        {/* Date range */}
        <div className="flex flex-col gap-1.5">
          <label className="text-theme-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Từ ngày</label>
          <input
            type="date"
            aria-label="Ngày bắt đầu"
            className="px-3 py-2 border border-gray-200 dark:border-white/[0.1] rounded-lg bg-white dark:bg-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            value={dateRange.startDate}
            onChange={(e) => setDateRange((prev) => ({ ...prev, startDate: e.target.value }))}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-theme-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Đến ngày</label>
          <input
            type="date"
            aria-label="Ngày kết thúc"
            className="px-3 py-2 border border-gray-200 dark:border-white/[0.1] rounded-lg bg-white dark:bg-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            value={dateRange.endDate}
            onChange={(e) => setDateRange((prev) => ({ ...prev, endDate: e.target.value }))}
          />
        </div>

        {/* Sort */}
        <div className="flex flex-col gap-1.5">
          <label className="text-theme-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Sắp xếp</label>
          <select
            className="px-3 py-2 border border-gray-200 dark:border-white/[0.1] rounded-lg bg-white dark:bg-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            value={sortOrder}
            onChange={(e) => setSortOrder(e.target.value as SortOrder)}
            aria-label="Sắp xếp"
          >
            <option value="newest">Mới nhất</option>
            <option value="oldest">Cũ nhất</option>
          </select>
        </div>

        {/* Refresh button */}
        <div className="flex items-end">
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="inline-flex items-center justify-center gap-2 px-4 py-2 font-medium text-white transition-all duration-300 bg-brand-500 hover:bg-brand-600 rounded-lg active:scale-[0.98] disabled:opacity-70 disabled:hover:scale-100 text-sm"
          >
            {isFetching ? "Đang tải..." : "Làm mới"}
          </button>
        </div>
      </div>

      {/* Summary */}
      <div className="flex items-center gap-2 p-4 rounded-2xl border border-gray-200 dark:border-white/[0.05] bg-white dark:bg-white/[0.03]">
        <h3 className="text-lg font-semibold text-gray-800 dark:text-white/90 flex items-center gap-2">
          <Server className="text-brand-500" size={20} />
          Danh sách Request Logs ({meta.total} bản ghi)
        </h3>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-2xl border border-gray-200 dark:border-white/[0.05]">
        <div className="overflow-x-auto">
          <table className="min-w-full">
            <thead className="border-b border-gray-100 dark:border-white/[0.05]">
              <tr className="bg-gray-50 dark:bg-gray-900">
                <th className="px-5 py-3 text-theme-xs font-medium text-gray-500 dark:text-gray-400 text-left uppercase">Type</th>
                <th className="px-5 py-3 text-theme-xs font-medium text-gray-500 dark:text-gray-400 text-left uppercase">Target Service</th>
                <th className="px-5 py-3 text-theme-xs font-medium text-gray-500 dark:text-gray-400 text-left uppercase">Method + URL</th>
                <th className="px-5 py-3 text-theme-xs font-medium text-gray-500 dark:text-gray-400 text-left uppercase">Status</th>
                <th className="px-5 py-3 text-theme-xs font-medium text-gray-500 dark:text-gray-400 text-left uppercase">Duration</th>
                <th className="px-5 py-3 text-theme-xs font-medium text-gray-500 dark:text-gray-400 text-left uppercase">Source Module</th>
                <th className="px-5 py-3 text-theme-xs font-medium text-gray-500 dark:text-gray-400 text-left uppercase">Created At</th>
                <th className="px-5 py-3 text-theme-xs font-medium text-gray-500 dark:text-gray-400 text-center uppercase">Detail</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-white/[0.05]">
              {isLoading ? (
                <TableSkeletonRows columnCount={8} rowCount={5} />
              ) : logs.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-5 py-20 text-center text-gray-500 dark:text-gray-400">
                    Không có dữ liệu request log.
                  </td>
                </tr>
              ) : (
                logs.map((log) => (
                  <tr
                    key={log._id}
                    className={`hover:bg-gray-50 dark:hover:bg-white/[0.02] transition-colors cursor-pointer ${isPlaceholderData ? "opacity-60" : ""}`}
                    onClick={() => setDetailLog(log)}
                  >
                    <td className="px-5 py-3">
                      <TypeBadge type={log.type} />
                    </td>
                    <td className="px-5 py-3 text-theme-sm text-gray-700 dark:text-gray-300 font-medium max-w-[180px] truncate" title={log.targetService}>
                      {log.targetService || "—"}
                    </td>
                    <td className="px-5 py-3 max-w-[350px]">
                      <TruncatedUrl url={log.url} method={log.method} />
                    </td>
                    <td className="px-5 py-3">
                      <StatusBadge code={log.statusCode} />
                    </td>
                    <td className="px-5 py-3 text-theme-sm text-gray-500 dark:text-gray-400">
                      <span className="inline-flex items-center gap-1">
                        <Clock size={12} />
                        {log.durationMs != null ? `${log.durationMs}ms` : "—"}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-theme-sm text-gray-500 dark:text-gray-400 max-w-[150px] truncate" title={log.sourceModule}>
                      {log.sourceModule || "—"}
                    </td>
                    <td className="px-5 py-3 text-theme-sm text-gray-500 dark:text-gray-400 whitespace-nowrap">
                      {formatDateTime(log.createdAt)}
                    </td>
                    <td className="px-5 py-3 text-center">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setDetailLog(log);
                        }}
                        className="p-1.5 text-gray-400 hover:text-brand-500 hover:bg-brand-50 dark:hover:bg-brand-500/10 rounded-lg transition-colors"
                        title="Xem chi tiết"
                        aria-label={`Xem chi tiết log ${log._id}`}
                      >
                        <Eye size={18} />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Pagination
        meta={meta}
        onPageChange={changePage}
        onLimitChange={setLimit}
        isDisabled={isFetching}
        itemLabel="log"
      />

      {/* Detail modal */}
      {detailLog && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setDetailLog(null)}
        >
          <div
            className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-700 w-full max-w-2xl max-h-[85vh] overflow-y-auto shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sticky top-0 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 px-6 py-4 flex items-center justify-between rounded-t-2xl">
              <h3 className="text-lg font-semibold text-gray-800 dark:text-white/90 flex items-center gap-2">
                <Server size={20} className="text-brand-500" />
                Chi tiết Request Log
              </h3>
              <button
                onClick={() => setDetailLog(null)}
                className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
                aria-label="Đóng"
              >
                ✕
              </button>
            </div>

            <div className="p-6 space-y-4">
              {/* Thông tin cơ bản */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <span className="text-theme-xs text-gray-500 dark:text-gray-400 uppercase block mb-1">Type</span>
                  <TypeBadge type={detailLog.type} />
                </div>
                <div>
                  <span className="text-theme-xs text-gray-500 dark:text-gray-400 uppercase block mb-1">Status Code</span>
                  <StatusBadge code={detailLog.statusCode} />
                </div>
                <div>
                  <span className="text-theme-xs text-gray-500 dark:text-gray-400 uppercase block mb-1">Target Service</span>
                  <span className="text-theme-sm text-gray-800 dark:text-white/90">{detailLog.targetService || "—"}</span>
                </div>
                <div>
                  <span className="text-theme-xs text-gray-500 dark:text-gray-400 uppercase block mb-1">Duration</span>
                  <span className="text-theme-sm text-gray-800 dark:text-white/90">{detailLog.durationMs != null ? `${detailLog.durationMs}ms` : "—"}</span>
                </div>
                <div className="col-span-2">
                  <span className="text-theme-xs text-gray-500 dark:text-gray-400 uppercase block mb-1">Method + URL</span>
                  <span className="text-theme-sm text-gray-800 dark:text-white/90 font-mono break-all">{detailLog.method} {detailLog.url}</span>
                </div>
                <div>
                  <span className="text-theme-xs text-gray-500 dark:text-gray-400 uppercase block mb-1">Source Module</span>
                  <span className="text-theme-sm text-gray-800 dark:text-white/90">{detailLog.sourceModule || "—"}</span>
                </div>
                <div>
                  <span className="text-theme-xs text-gray-500 dark:text-gray-400 uppercase block mb-1">Created At</span>
                  <span className="text-theme-sm text-gray-800 dark:text-white/90">{formatDateTime(detailLog.createdAt)}</span>
                </div>
              </div>

              {/* Request details */}
              {detailLog.request && (
                <div>
                  <span className="text-theme-xs text-gray-500 dark:text-gray-400 uppercase block mb-2">Request</span>
                  <pre className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4 text-xs font-mono text-gray-700 dark:text-gray-300 overflow-x-auto max-h-[300px]">
                    {JSON.stringify(detailLog.request, null, 2)}
                  </pre>
                </div>
              )}

              {/* Response details */}
              {detailLog.response && (
                <div>
                  <span className="text-theme-xs text-gray-500 dark:text-gray-400 uppercase block mb-2">Response</span>
                  <pre className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4 text-xs font-mono text-gray-700 dark:text-gray-300 overflow-x-auto max-h-[300px]">
                    {JSON.stringify(detailLog.response, null, 2)}
                  </pre>
                </div>
              )}

              {/* Error details */}
              {detailLog.error && (
                <div>
                  <span className="text-theme-xs text-error-500 uppercase block mb-2">Error</span>
                  <pre className="bg-error-50 dark:bg-error-500/10 rounded-lg p-4 text-xs font-mono text-error-700 dark:text-error-400 overflow-x-auto max-h-[300px]">
                    {JSON.stringify(detailLog.error, null, 2)}
                  </pre>
                </div>
              )}
            </div>

            <div className="border-t border-gray-200 dark:border-gray-700 px-6 py-3 flex justify-end rounded-b-2xl">
              <button
                onClick={() => setDetailLog(null)}
                className="px-4 py-2 text-sm font-medium text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg transition-colors"
              >
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
