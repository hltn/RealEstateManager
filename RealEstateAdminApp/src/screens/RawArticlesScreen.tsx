import { useState, useEffect, useMemo } from "react";
import { AlertCircle, Database, Trash2, Eye, Search } from "lucide-react";

const renderHighlightedText = (text: string, query: string) => {
  if (!text) return "";
  if (!query || query.length < 2) return text;
  
  const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const parts = text.split(new RegExp(`(${escapedQuery})`, 'gi'));
  
  return (
    <>
      {parts.map((part, index) => 
        part.toLowerCase() === query.toLowerCase() ? (
          <mark key={index} className="bg-yellow-200 dark:bg-yellow-900/50 text-inherit rounded-sm px-0.5">
            {part}
          </mark>
        ) : (
          part
        )
      )}
    </>
  );
};

export default function RawArticlesScreen() {
  const [loading, setLoading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [rawData, setRawData] = useState<any[]>([]);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [sortOrder, setSortOrder] = useState<'newest' | 'oldest'>('newest');
  const [bulkAction, setBulkAction] = useState("");
  const [searchInput, setSearchInput] = useState("");

  const fetchRawArticles = async (keepSuccess = false) => {
    setLoading(true);
    setError("");
    if (!keepSuccess) setSuccess("");
    try {
      const url = new URL("/api/news-manager/raw-articles", window.location.origin);

      const response = await fetch(url.toString());
      const resData = await response.json();
      if (!response.ok) {
        throw new Error(resData.message || "Lỗi khi tải dữ liệu");
      }
      setRawData(resData.data || []);
      setSelectedIds([]);
    } catch (err: any) {
      setError(err.message || "Đã xảy ra lỗi khi tải dữ liệu");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRawArticles();
  }, []);

  const displayData = useMemo(() => {
    let result = [...rawData];
    if (searchQuery) {
      const lowerQuery = searchQuery.toLowerCase();
      result = result.filter(item => 
        (item.title && item.title.toLowerCase().includes(lowerQuery)) ||
        (item.description && item.description.toLowerCase().includes(lowerQuery)) ||
        (item.source && item.source.toLowerCase().includes(lowerQuery))
      );
    }
    
    return result.sort((a, b) => {
      const dateA = a.publishedAt ? new Date(a.publishedAt).getTime() : 0;
      const dateB = b.publishedAt ? new Date(b.publishedAt).getTime() : 0;
      if (sortOrder === 'newest') {
        return dateB - dateA;
      } else {
        return dateA - dateB;
      }
    });
  }, [rawData, searchQuery, sortOrder]);

  const handleAnalyze = async () => {
    if (rawData.length === 0) return;
    
    setAnalyzing(true);
    setError("");
    setSuccess("");
    
    try {
      const articlesToSend = rawData.map(item => ({
        urlHash: item.urlHash,
        title: item.title,
        description: item.description
      }));
      
      const response = await fetch("/api/news-manager/analyze-raw", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ articles: articlesToSend })
      });
      
      const resData = await response.json();
      if (!response.ok) {
        throw new Error(resData.message || "Lỗi khi phân tích tin tức");
      }
      
      setSuccess("Phân tích AI thành công, đã lọc các tin không liên quan!");
      await fetchRawArticles(true);
    } catch (err: any) {
      setError(err.message || "Đã xảy ra lỗi khi phân tích AI");
    } finally {
      setAnalyzing(false);
    }
  };

  const handleDeleteSingle = async (id: string) => {
    if (!window.confirm("Bạn có chắc chắn muốn xóa bài viết này?")) return;
    try {
      const res = await fetch(`/api/news-manager/raw-articles/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error("Xóa thất bại");
      setSuccess("Đã xóa bài viết thành công!");
      fetchRawArticles(true);
    } catch (e: any) {
      setError(e.message || "Lỗi khi xóa bài viết");
    }
  };

  const handleApplyBulkAction = async () => {
    if (bulkAction === "delete" && selectedIds.length > 0) {
      if (!window.confirm(`Bạn có chắc chắn muốn xóa ${selectedIds.length} bài viết đã chọn?`)) return;
      try {
        const res = await fetch(`/api/news-manager/raw-articles/delete-bulk`, {
          method: 'POST',
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids: selectedIds })
        });
        if (!res.ok) throw new Error("Xóa hàng loạt thất bại");
        setSuccess(`Đã xóa ${selectedIds.length} bài viết thành công!`);
        fetchRawArticles(true);
        setBulkAction("");
      } catch (e: any) {
        setError(e.message || "Lỗi khi xóa hàng loạt");
      }
    } else if (bulkAction === "move_to_main" && selectedIds.length > 0) {
      if (!window.confirm(`Bạn có chắc chắn muốn di chuyển ${selectedIds.length} bài viết đã chọn sang danh sách chính?`)) return;
      try {
        const res = await fetch(`/api/news-manager/raw-articles/move-bulk`, {
          method: 'POST',
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids: selectedIds })
        });
        if (!res.ok) throw new Error("Di chuyển dữ liệu thất bại");
        setSuccess(`Đã di chuyển ${selectedIds.length} bài viết thành công!`);
        fetchRawArticles(true);
        setBulkAction("");
      } catch (e: any) {
        setError(e.message || "Lỗi khi di chuyển dữ liệu");
      }
    }
  };

  const handleSelectAll = (e: React.ChangeEvent<HTMLInputElement>) => {
    const displayIds = displayData.map(item => item._id);
    if (e.target.checked) {
      setSelectedIds(Array.from(new Set([...selectedIds, ...displayIds])));
    } else {
      setSelectedIds(selectedIds.filter(id => !displayIds.includes(id)));
    }
  };

  const handleSelect = (id: string) => {
    if (selectedIds.includes(id)) {
      setSelectedIds(selectedIds.filter(i => i !== id));
    } else {
      setSelectedIds([...selectedIds, id]);
    }
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSearchQuery(searchInput);
  };

  useEffect(() => {
    if (searchInput.length >= 2 || searchInput.length === 0) {
      setSearchQuery(searchInput);
    }
  }, [searchInput]);

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
        <div className="flex gap-4">
          <button
            onClick={handleAnalyze}
            disabled={loading || analyzing || rawData.length === 0}
            className="inline-flex items-center justify-center gap-3 px-5 py-3 font-medium text-brand-500 bg-brand-50 dark:bg-brand-500/15 border border-brand-100 dark:border-brand-500/25 transition-all duration-300 hover:bg-brand-100 dark:hover:bg-brand-500/25 rounded-lg active:scale-[0.98] disabled:opacity-70 disabled:hover:scale-100"
          >
            {analyzing ? "Đang phân tích..." : "Phân tích tin tức"}
          </button>
          <button
            onClick={() => fetchRawArticles()}
            disabled={loading || analyzing}
            className="inline-flex items-center justify-center gap-3 px-5 py-3 font-medium text-white transition-all duration-300 bg-brand-500 hover:bg-brand-600 rounded-lg active:scale-[0.98] disabled:opacity-70 disabled:hover:scale-100"
          >
            {loading ? "Đang tải..." : "Làm mới"}
          </button>
        </div>
      </header>

      {success && (
        <div className="p-4 rounded-lg bg-success-50 dark:bg-success-500/15 border border-success-100 dark:border-success-500/25 flex items-center gap-3 text-success-500">
          <span className="text-theme-sm font-medium">{success}</span>
        </div>
      )}

      {error && (
        <div className="p-4 rounded-lg bg-error-50 dark:bg-error-500/15 border border-error-100 dark:border-error-500/25 flex items-center gap-3 text-error-500">
          <AlertCircle className="shrink-0" size={20} />
          <span className="text-theme-sm font-medium">{error}</span>
        </div>
      )}

      {/* Sorting, Filtering, Bulk Actions */}
      <div className="flex flex-col md:flex-row justify-between gap-4 mb-2">
        <div className="flex items-center gap-2">
          <select 
            className="px-3 py-2 border border-gray-200 dark:border-white/[0.1] rounded-lg bg-white dark:bg-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            value={bulkAction}
            onChange={(e) => setBulkAction(e.target.value)}
          >
            <option value="">Hành động hàng loạt</option>
            <option value="move_to_main">Di chuyển dữ liệu</option>
            <option value="delete">Xóa</option>
          </select>
          <button 
            onClick={handleApplyBulkAction}
            disabled={!bulkAction || selectedIds.length === 0}
            className="px-4 py-2 bg-brand-500 hover:bg-brand-600 text-white font-medium rounded-lg text-sm shadow-sm transition-colors disabled:opacity-50 disabled:bg-gray-400 disabled:cursor-not-allowed"
          >
            Áp dụng
          </button>
        </div>

        <div className="flex items-center gap-3">
          <select 
            className="px-3 py-2 border border-gray-200 dark:border-white/[0.1] rounded-lg bg-white dark:bg-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            value={sortOrder}
            onChange={(e) => setSortOrder(e.target.value as 'newest' | 'oldest')}
          >
            <option value="newest">Mới nhất</option>
            <option value="oldest">Cũ nhất</option>
          </select>

          <form onSubmit={handleSearchSubmit} className="relative">
            <input 
              type="text" 
              placeholder="Tìm kiếm..."
              className="pl-9 pr-4 py-2 border border-gray-200 dark:border-white/[0.1] rounded-lg bg-white dark:bg-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 w-full md:w-64"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
            />
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
          </form>
        </div>
      </div>

      {loading && rawData.length === 0 ? (
        <div className="text-center py-20 text-gray-500 dark:text-gray-400">Đang tải dữ liệu...</div>
      ) : displayData.length > 0 ? (
        <div className="space-y-4">
          <div className="flex items-center gap-2 p-4 rounded-2xl border border-gray-200 dark:border-white/[0.05] bg-white dark:bg-white/[0.03]">
            <h3 className="text-lg font-semibold text-gray-800 dark:text-white/90 flex items-center gap-2">
              <Database className="text-brand-500" size={20} />
              Dữ liệu thô ({displayData.length} bài)
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
                        onChange={handleSelectAll}
                        checked={displayData.length > 0 && displayData.every(item => selectedIds.includes(item._id))}
                        className="rounded border-gray-300 text-brand-500 focus:ring-brand-500 cursor-pointer"
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
                  {displayData.map((item, idx) => (
                    <tr key={idx} className="hover:bg-gray-50 dark:hover:bg-white/[0.02] transition-colors">
                      <td className="px-5 py-4">
                        <input 
                          type="checkbox" 
                          checked={selectedIds.includes(item._id)}
                          onChange={() => handleSelect(item._id)}
                          className="rounded border-gray-300 text-brand-500 focus:ring-brand-500 cursor-pointer"
                        />
                      </td>
                      <td className="px-2 py-4 text-theme-sm text-gray-500 dark:text-gray-400">{idx + 1}</td>
                      <td className="px-5 py-4">
                        {item.thumbnailUrl ? (
                          <img
                            src={item.thumbnailUrl}
                            alt={item.title}
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
                        <span className="line-clamp-2">{renderHighlightedText(item.title, searchQuery)}</span>
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
                              year: 'numeric',
                              month: '2-digit',
                              day: '2-digit'
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
                            onClick={() => window.open(item.url, '_blank')}
                            className="p-2 text-gray-500 hover:text-brand-500 hover:bg-brand-50 dark:hover:bg-brand-500/10 rounded-lg transition-colors"
                          >
                            <Eye size={18} />
                          </button>
                          <button 
                            title="Xóa"
                            onClick={() => handleDeleteSingle(item._id)}
                            className="p-2 text-gray-500 hover:text-error-500 hover:bg-error-50 dark:hover:bg-error-500/10 rounded-lg transition-colors"
                          >
                            <Trash2 size={18} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : (
        <div className="text-center py-20 text-gray-500 dark:text-gray-400">Không có dữ liệu.</div>
      )}
    </div>
  );
}
