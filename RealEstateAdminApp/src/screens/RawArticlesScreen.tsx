import { useEffect, useState } from "react";
import { AlertCircle, Database, Trash2, Eye, Search, Play } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DatePicker } from "../components/ui/DatePicker";
import { Pagination } from "../components/common/Pagination";
import { TableSkeletonRows } from "../components/common/TableSkeletonRows";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { buildListQuery, fetchPaginated } from "../utils/fetchPaginated";
import { DEFAULT_PAGE_SIZE } from "../types/pagination";
import type { PaginatedResponse } from "../types/pagination";

/** Một bài viết thô do crawler thu thập (collection RawArticle). */
interface RawArticle {
  _id: string;
  urlHash?: string;
  title?: string;
  description?: string;
  source?: string;
  url?: string;
  thumbnailUrl?: string;
  publishedAt?: string;
}

type SortOrder = "newest" | "oldest";

interface CrawlStats {
  successfulSources: number;
  failedSources: number;
  totalArticles: number;
  successfulDetails?: { url: string; count: number }[];
  failedDetails?: { url: string }[];
}

const RAW_ARTICLES_ENDPOINT = "/api/v1/news-manager/raw-articles";

/** Tách chuỗi ngày của DatePicker (mode range) thành startDate / endDate. */
const parseDateRange = (rangeValue: string): { startDate?: string; endDate?: string } => {
  if (!rangeValue) return {};
  if (rangeValue.includes(" to ")) {
    const [start, end] = rangeValue.split(" to ");
    return { startDate: start, endDate: end };
  }
  return { startDate: rangeValue, endDate: rangeValue };
};

/** Bọc từ khóa tìm kiếm bằng <mark> để làm nổi bật trong kết quả server trả về. */
const renderHighlightedText = (text: string, query: string) => {
  if (!text) return "";
  if (!query || query.length < 2) return text;

  const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const parts = text.split(new RegExp(`(${escapedQuery})`, "gi"));

  return (
    <>
      {parts.map((part, index) =>
        part.toLowerCase() === query.toLowerCase() ? (
          <mark
            key={index}
            className="bg-yellow-200 dark:bg-yellow-900/50 text-inherit rounded-sm px-0.5"
          >
            {part}
          </mark>
        ) : (
          part
        ),
      )}
    </>
  );
};

export default function RawArticlesScreen() {
  const queryClient = useQueryClient();

  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [searchInput, setSearchInput] = useState("");
  const [sortOrder, setSortOrder] = useState<SortOrder>("newest");
  const [bulkAction, setBulkAction] = useState("");
  const [dateRange, setDateRange] = useState("");
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(DEFAULT_PAGE_SIZE);
  const [crawlStats, setCrawlStats] = useState<CrawlStats | null>(null);

  // Debounce ô tìm kiếm để không spam request mỗi lần user gõ.
  const searchQuery = useDebouncedValue(searchInput, 400);
  const { startDate, endDate } = parseDateRange(dateRange);

  // Mọi thay đổi filter đều phải reset về trang 1, nếu không user đang ở trang 5
  // mà lọc còn 2 trang sẽ thấy danh sách rỗng.
  // Điều chỉnh ngay trong lúc render (không dùng useEffect) để tránh gọi API
  // thêm một lần với cặp "filter mới + page cũ".
  const filterSignature = `${searchQuery}|${sortOrder}|${startDate ?? ""}|${endDate ?? ""}|${limit}`;
  const [prevFilterSignature, setPrevFilterSignature] = useState(filterSignature);
  if (prevFilterSignature !== filterSignature) {
    setPrevFilterSignature(filterSignature);
    setPage(1);
    setSelectedIds([]);
  }

  const queryString = buildListQuery({
    page,
    limit,
    search: searchQuery,
    sort: sortOrder,
    startDate,
    endDate,
  });

  const {
    data: rawArticlesPage,
    isLoading,
    isFetching,
    isPlaceholderData,
    refetch,
    error: queryError,
  } = useQuery<PaginatedResponse<RawArticle>, Error>({
    queryKey: ["raw-articles", { page, limit, search: searchQuery, sort: sortOrder, startDate, endDate }],
    queryFn: ({ signal }) =>
      fetchPaginated<RawArticle>(`${RAW_ARTICLES_ENDPOINT}?${queryString}`, page, limit, signal),
    // Giữ dữ liệu trang cũ khi đang tải trang mới để bảng không bị nháy trắng.
    placeholderData: (previousData) => previousData,
  });

  // Lỗi hiển thị: ưu tiên lỗi của thao tác ghi (mutation), sau đó tới lỗi tải danh sách.
  const displayError = error || queryError?.message || "";

  const articles = rawArticlesPage?.data ?? [];
  const meta = rawArticlesPage?.meta ?? { total: 0, page, limit, totalPages: 0 };

  // Khi Backend trả về totalPages nhỏ hơn trang đang xem (VD: vừa xóa hết bài trang cuối),
  // tự lùi về trang cuối cùng còn dữ liệu.
  useEffect(() => {
    if (meta.totalPages > 0 && page > meta.totalPages) {
      setPage(meta.totalPages);
    }
  }, [meta.totalPages, page]);

  const currentPageIds = articles.map((item) => item._id);
  const isAllOnPageSelected =
    currentPageIds.length > 0 && currentPageIds.every((id) => selectedIds.includes(id));

  /** Làm mới danh sách sau các thao tác ghi, đồng thời clear selection cho an toàn. */
  const invalidateList = async () => {
    setSelectedIds([]);
    await queryClient.invalidateQueries({ queryKey: ["raw-articles"] });
  };

  const changePage = (nextPage: number) => {
    // Bỏ selection khi đổi trang: người dùng không còn thấy các item đã chọn,
    // giữ lại rất dễ dẫn tới xóa/di chuyển nhầm dữ liệu.
    setSelectedIds([]);
    setPage(nextPage);
  };

  const crawlMutation = useMutation<{ articles: unknown[]; stats?: CrawlStats }, Error>({
    mutationFn: async () => {
      const response = await fetch("/api/v1/news-manager/crawl", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parseDateRange(dateRange)),
      });
      const resData = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(resData?.message || "Lỗi từ máy chủ");
      }
      return { articles: resData?.data ?? [], stats: resData?.stats };
    },
    onMutate: () => {
      setError("");
      setSuccess("");
      setCrawlStats(null);
    },
    onSuccess: async ({ articles: crawled, stats }) => {
      if (stats) setCrawlStats(stats);
      if (crawled.length > 0) {
        setSuccess(`Thu thập thành công ${crawled.length} bài viết! Đã tải lại danh sách.`);
        await invalidateList();
      } else {
        setSuccess("Quá trình hoàn tất nhưng không tìm thấy bài viết nào mới.");
      }
    },
    onError: (err) => setError(err.message || "Có lỗi xảy ra khi thu thập dữ liệu."),
  });

  const analyzeMutation = useMutation<void, Error>({
    mutationFn: async () => {
      // Chỉ phân tích các bài đang hiển thị trên trang hiện tại (server-side pagination).
      const articlesToSend = articles.map((item) => ({
        urlHash: item.urlHash,
        title: item.title,
        description: item.description,
      }));

      const response = await fetch("/api/v1/news-manager/analyze-raw", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ articles: articlesToSend }),
      });
      const resData = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(resData?.message || "Lỗi khi phân tích tin tức");
      }
    },
    onMutate: () => {
      setError("");
      setSuccess("");
    },
    onSuccess: async () => {
      setSuccess("Phân tích AI thành công, đã lọc các tin không liên quan!");
      await invalidateList();
    },
    onError: (err) => setError(err.message || "Đã xảy ra lỗi khi phân tích AI"),
  });

  const deleteSingleMutation = useMutation<void, Error, string>({
    mutationFn: async (id) => {
      const res = await fetch(`${RAW_ARTICLES_ENDPOINT}/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Xóa thất bại");
    },
    onSuccess: async () => {
      setSuccess("Đã xóa bài viết thành công!");
      await invalidateList();
    },
    onError: (err) => setError(err.message || "Lỗi khi xóa bài viết"),
  });

  const bulkMutation = useMutation<void, Error, { action: "delete" | "move_to_main"; ids: string[] }>({
    mutationFn: async ({ action, ids }) => {
      const endpoint =
        action === "delete"
          ? `${RAW_ARTICLES_ENDPOINT}/delete-bulk`
          : `${RAW_ARTICLES_ENDPOINT}/move-bulk`;
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      if (!res.ok) {
        throw new Error(action === "delete" ? "Xóa hàng loạt thất bại" : "Di chuyển dữ liệu thất bại");
      }
    },
    onSuccess: async (_result, { action, ids }) => {
      setSuccess(
        action === "delete"
          ? `Đã xóa ${ids.length} bài viết thành công!`
          : `Đã di chuyển ${ids.length} bài viết thành công!`,
      );
      setBulkAction("");
      await invalidateList();
    },
    onError: (err) => setError(err.message || "Lỗi khi xử lý hàng loạt"),
  });

  const isBusy =
    isFetching || crawlMutation.isPending || analyzeMutation.isPending || bulkMutation.isPending;

  const handleDeleteSingle = (id: string) => {
    if (!window.confirm("Bạn có chắc chắn muốn xóa bài viết này?")) return;
    setError("");
    deleteSingleMutation.mutate(id);
  };

  const handleApplyBulkAction = () => {
    if (selectedIds.length === 0) return;
    if (bulkAction !== "delete" && bulkAction !== "move_to_main") return;

    const confirmMessage =
      bulkAction === "delete"
        ? `Bạn có chắc chắn muốn xóa ${selectedIds.length} bài viết đã chọn?`
        : `Bạn có chắc chắn muốn di chuyển ${selectedIds.length} bài viết đã chọn sang danh sách chính?`;
    if (!window.confirm(confirmMessage)) return;

    setError("");
    setSuccess("");
    bulkMutation.mutate({ action: bulkAction, ids: selectedIds });
  };

  const handleSelectAllOnPage = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.checked) {
      setSelectedIds(Array.from(new Set([...selectedIds, ...currentPageIds])));
    } else {
      setSelectedIds(selectedIds.filter((id) => !currentPageIds.includes(id)));
    }
  };

  const handleSelect = (id: string) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]));
  };

  const handleSearchSubmit = (event: React.FormEvent) => {
    event.preventDefault();
  };

  return (
    <div className="w-full flex flex-col gap-6">
      <header className="flex flex-col md:flex-row md:justify-between md:items-end gap-6 pb-6 border-b border-gray-200 dark:border-white/[0.05]">
        <div>
          <h2 className="text-title-sm font-semibold text-gray-800 dark:text-white/90 mb-2">
            Tin tức thô
          </h2>
          <p className="text-theme-sm text-gray-500 dark:text-gray-400 max-w-2xl leading-relaxed">
            Danh sách tất cả các bài viết đã thu thập nhưng chưa qua phân tích AI hoặc đã lưu vào bảng tạm (RawArticle).
          </p>
        </div>
        <div className="flex gap-4 flex-wrap justify-end items-center">
          <div className="flex items-center gap-2 w-full md:w-auto">
            <button
              onClick={() => {
                const today = new Date();
                const year = today.getFullYear();
                const month = String(today.getMonth() + 1).padStart(2, "0");
                const day = String(today.getDate()).padStart(2, "0");
                setDateRange(`${year}-${month}-${day}`);
              }}
              className="px-3 py-2 text-sm font-medium text-brand-600 bg-brand-50 hover:bg-brand-100 rounded-lg dark:text-brand-400 dark:bg-brand-900/30 dark:hover:bg-brand-900/50 transition-colors whitespace-nowrap"
            >
              Hôm nay
            </button>
            <div className="w-full md:w-64">
              <DatePicker
                mode="range"
                value={dateRange}
                onChange={(val) => setDateRange(val)}
                placeholder="Chọn ngày (Từ - Đến)"
                className="w-full"
              />
            </div>
          </div>
          <button
            onClick={() => crawlMutation.mutate()}
            disabled={isBusy}
            className="inline-flex items-center justify-center gap-3 px-5 py-3 font-medium text-white transition-all duration-300 bg-brand-500 hover:bg-brand-600 rounded-lg active:scale-[0.98] disabled:opacity-70 disabled:hover:scale-100"
          >
            <Play size={20} className={crawlMutation.isPending ? "animate-pulse" : ""} />
            <span>{crawlMutation.isPending ? "Đang thu thập..." : "Chạy quy trình thu thập"}</span>
          </button>
          <button
            onClick={() => analyzeMutation.mutate()}
            disabled={isBusy || articles.length === 0}
            className="inline-flex items-center justify-center gap-3 px-5 py-3 font-medium text-brand-500 bg-brand-50 dark:bg-brand-500/15 border border-brand-100 dark:border-brand-500/25 transition-all duration-300 hover:bg-brand-100 dark:hover:bg-brand-500/25 rounded-lg active:scale-[0.98] disabled:opacity-70 disabled:hover:scale-100"
          >
            {analyzeMutation.isPending ? "Đang phân tích..." : "Phân tích tin tức"}
          </button>
          <button
            onClick={() => refetch()}
            disabled={isBusy}
            className="inline-flex items-center justify-center gap-3 px-5 py-3 font-medium text-white transition-all duration-300 bg-gray-500 hover:bg-gray-600 rounded-lg active:scale-[0.98] disabled:opacity-70 disabled:hover:scale-100"
          >
            {isFetching ? "Đang tải..." : "Làm mới"}
          </button>
        </div>
      </header>

      {success && (
        <div className="p-4 rounded-lg bg-success-50 dark:bg-success-500/15 border border-success-100 dark:border-success-500/25 flex items-center gap-3 text-success-500">
          <span className="text-theme-sm font-medium">{success}</span>
        </div>
      )}

      {displayError && (
        <div className="p-4 rounded-lg bg-error-50 dark:bg-error-500/15 border border-error-100 dark:border-error-500/25 flex items-center gap-3 text-error-500">
          <AlertCircle className="shrink-0" size={20} />
          <span className="text-theme-sm font-medium">{displayError}</span>
        </div>
      )}

      {crawlStats && (
        <div className="mb-4 p-4 rounded-xl border border-gray-200 dark:border-white/[0.05] bg-white dark:bg-white/[0.03]">
          <div className="text-theme-sm font-medium text-success-500 dark:text-success-400 mb-2">
            Tất cả: {crawlStats.successfulSources} link thành công / {crawlStats.totalArticles} số lượng bài. {crawlStats.failedSources} link thất bại.
          </div>

          {(crawlStats.successfulDetails?.length || crawlStats.failedDetails?.length) ? (
            <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-6 text-theme-xs">
              {crawlStats.successfulDetails && crawlStats.successfulDetails.length > 0 && (
                <div>
                  <div className="font-semibold text-gray-700 dark:text-gray-300 mb-2">Danh sách link thành công:</div>
                  <ul className="space-y-2 text-gray-600 dark:text-gray-400 max-h-[300px] overflow-y-auto pr-2">
                    {crawlStats.successfulDetails.map((item, idx) => (
                      <li key={idx} className="flex justify-between items-center border-b border-gray-100 dark:border-gray-800 pb-1">
                        <span className="truncate pr-2 block w-full" title={item.url}>{item.url}</span>
                        <span className="font-medium text-success-600 dark:text-success-500 whitespace-nowrap bg-success-50 dark:bg-success-500/10 px-2 py-0.5 rounded text-[10px]">{item.count} bài</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {crawlStats.failedDetails && crawlStats.failedDetails.length > 0 && (
                <div>
                  <div className="font-semibold text-gray-700 dark:text-gray-300 mb-2">Danh sách link thất bại:</div>
                  <ul className="space-y-2 text-error-600 dark:text-error-500 max-h-[300px] overflow-y-auto pr-2">
                    {crawlStats.failedDetails.map((item, idx) => (
                      <li key={idx} className="truncate border-b border-gray-100 dark:border-gray-800 pb-1" title={item.url}>
                        {item.url}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ) : null}
        </div>
      )}

      {/* Sorting, Filtering, Bulk Actions */}
      <div className="flex flex-col md:flex-row justify-between gap-4 mb-2">
        <div className="flex items-center gap-2">
          <select
            className="px-3 py-2 border border-gray-200 dark:border-white/[0.1] rounded-lg bg-white dark:bg-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            value={bulkAction}
            onChange={(e) => setBulkAction(e.target.value)}
            aria-label="Chọn hành động hàng loạt"
          >
            <option value="">Hành động hàng loạt</option>
            <option value="move_to_main">Di chuyển dữ liệu</option>
            <option value="delete">Xóa</option>
          </select>
          <button
            onClick={handleApplyBulkAction}
            disabled={!bulkAction || selectedIds.length === 0 || bulkMutation.isPending}
            className="px-4 py-2 bg-brand-500 hover:bg-brand-600 text-white font-medium rounded-lg text-sm shadow-sm transition-colors disabled:opacity-50 disabled:bg-gray-400 disabled:cursor-not-allowed"
          >
            Áp dụng {selectedIds.length > 0 ? `(${selectedIds.length})` : ""}
          </button>
          {selectedIds.length > 0 && (
            <span className="text-theme-xs text-gray-500 dark:text-gray-400">
              Đã chọn {selectedIds.length} bài trên trang này
            </span>
          )}
        </div>

        <div className="flex items-center gap-3">
          <select
            className="px-3 py-2 border border-gray-200 dark:border-white/[0.1] rounded-lg bg-white dark:bg-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            value={sortOrder}
            onChange={(e) => setSortOrder(e.target.value as SortOrder)}
            aria-label="Sắp xếp theo ngày đăng"
          >
            <option value="newest">Mới nhất</option>
            <option value="oldest">Cũ nhất</option>
          </select>

          <form onSubmit={handleSearchSubmit} className="relative">
            <input
              type="text"
              placeholder="Tìm kiếm..."
              aria-label="Tìm kiếm tin tức thô"
              className="pl-9 pr-4 py-2 border border-gray-200 dark:border-white/[0.1] rounded-lg bg-white dark:bg-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 w-full md:w-64"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
            />
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
          </form>
        </div>
      </div>

      <div className="space-y-4">
        <div className="flex items-center gap-2 p-4 rounded-2xl border border-gray-200 dark:border-white/[0.05] bg-white dark:bg-white/[0.03]">
          <h3 className="text-lg font-semibold text-gray-800 dark:text-white/90 flex items-center gap-2">
            <Database className="text-brand-500" size={20} />
            Dữ liệu thô ({meta.total} bài)
          </h3>
        </div>

        <div className="overflow-hidden rounded-2xl border border-gray-200 dark:border-white/[0.05]">
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead className="border-b border-gray-100 dark:border-white/[0.05]">
                <tr className="bg-gray-50 dark:bg-gray-900">
                  <th className="px-5 py-3 text-left">
                    <input
                      type="checkbox"
                      onChange={handleSelectAllOnPage}
                      checked={isAllOnPageSelected}
                      disabled={currentPageIds.length === 0}
                      title="Chọn tất cả trên trang này"
                      aria-label="Chọn tất cả trên trang này"
                      className="rounded border-gray-300 text-brand-500 focus:ring-brand-500 cursor-pointer disabled:cursor-not-allowed"
                    />
                  </th>
                  <th className="px-2 py-3 text-theme-xs font-medium text-gray-500 dark:text-gray-400 text-left uppercase">STT</th>
                  <th className="px-5 py-3 text-theme-xs font-medium text-gray-500 dark:text-gray-400 text-left uppercase">Thumbnail</th>
                  <th className="px-5 py-3 text-theme-xs font-medium text-gray-500 dark:text-gray-400 text-left uppercase">Tiêu đề</th>
                  <th className="px-5 py-3 text-theme-xs font-medium text-gray-500 dark:text-gray-400 text-left uppercase">Mô tả</th>
                  <th className="px-5 py-3 text-theme-xs font-medium text-gray-500 dark:text-gray-400 text-left uppercase">Nguồn</th>
                  <th className="px-5 py-3 text-theme-xs font-medium text-gray-500 dark:text-gray-400 text-left uppercase">Ngày đăng</th>
                  <th className="px-5 py-3 text-theme-xs font-medium text-gray-500 dark:text-gray-400 text-left uppercase">Link</th>
                  <th className="px-5 py-3 text-theme-xs font-medium text-gray-500 dark:text-gray-400 text-right uppercase">Hành động</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-white/[0.05]">
                {isLoading ? (
                  <TableSkeletonRows columnCount={9} rowCount={5} />
                ) : articles.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-5 py-20 text-center text-gray-500 dark:text-gray-400">
                      Không có dữ liệu.
                    </td>
                  </tr>
                ) : (
                  articles.map((item, idx) => (
                    <tr
                      key={item._id}
                      className={`hover:bg-gray-50 dark:hover:bg-white/[0.02] transition-colors ${
                        isPlaceholderData ? "opacity-60" : ""
                      }`}
                    >
                      <td className="px-5 py-4">
                        <input
                          type="checkbox"
                          checked={selectedIds.includes(item._id)}
                          onChange={() => handleSelect(item._id)}
                          aria-label={`Chọn bài viết ${item.title ?? item._id}`}
                          className="rounded border-gray-300 text-brand-500 focus:ring-brand-500 cursor-pointer"
                        />
                      </td>
                      <td className="px-2 py-4 text-theme-sm text-gray-500 dark:text-gray-400">
                        {(meta.page - 1) * meta.limit + idx + 1}
                      </td>
                      <td className="px-5 py-4">
                        {item.thumbnailUrl ? (
                          <img
                            src={item.thumbnailUrl}
                            alt={item.title ?? ""}
                            className="w-[60px] h-[40px] object-cover rounded"
                            onError={(e) => {
                              (e.target as HTMLImageElement).style.display = "none";
                            }}
                          />
                        ) : (
                          <div className="w-[60px] h-[40px] rounded bg-gray-100 dark:bg-gray-800" />
                        )}
                      </td>
                      <td className="px-5 py-4 text-theme-sm text-gray-800 dark:text-white/90 font-medium max-w-xs">
                        <span className="line-clamp-2">
                          {renderHighlightedText(item.title ?? "", searchQuery)}
                        </span>
                      </td>
                      <td className="px-5 py-4 text-theme-sm text-gray-500 dark:text-gray-400 max-w-sm">
                        <span className="line-clamp-2">{item.description}</span>
                      </td>
                      <td className="px-5 py-4 text-theme-sm text-gray-500 dark:text-gray-400 whitespace-nowrap">
                        {item.source}
                      </td>
                      <td className="px-5 py-4 text-theme-sm text-gray-500 dark:text-gray-400 whitespace-nowrap">
                        {item.publishedAt
                          ? new Date(item.publishedAt).toLocaleDateString("vi-VN", {
                              year: "numeric",
                              month: "2-digit",
                              day: "2-digit",
                            })
                          : "—"}
                      </td>
                      <td className="px-5 py-4">
                        <a
                          href={item.url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-brand-500 hover:underline text-theme-sm whitespace-nowrap"
                        >
                          Link gốc
                        </a>
                      </td>
                      <td className="px-5 py-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            title="Xem chi tiết"
                            aria-label="Xem chi tiết bài viết"
                            onClick={() => window.open(item.url, "_blank")}
                            className="p-2 text-gray-500 hover:text-brand-500 hover:bg-brand-50 dark:hover:bg-brand-500/10 rounded-lg transition-colors"
                          >
                            <Eye size={18} />
                          </button>
                          <button
                            title="Xóa"
                            aria-label="Xóa bài viết"
                            onClick={() => handleDeleteSingle(item._id)}
                            className="p-2 text-gray-500 hover:text-error-500 hover:bg-error-50 dark:hover:bg-error-500/10 rounded-lg transition-colors"
                          >
                            <Trash2 size={18} />
                          </button>
                        </div>
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
          itemLabel="bài"
        />
      </div>
    </div>
  );
}
