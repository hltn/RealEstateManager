import { useState, useEffect } from "react";
import { AlertCircle, Database } from "lucide-react";

export default function RawArticlesScreen() {
  const [loading, setLoading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [rawData, setRawData] = useState<any[]>([]);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const fetchRawArticles = async (keepSuccess = false) => {
    setLoading(true);
    setError("");
    if (!keepSuccess) setSuccess("");
    try {
      const response = await fetch("/api/news-manager/raw-articles");
      const resData = await response.json();
      if (!response.ok) {
        throw new Error(resData.message || "Failed to fetch raw articles");
      }
      setRawData(resData.data || []);
    } catch (err: any) {
      setError(err.message || "An error occurred while fetching raw articles");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRawArticles();
  }, []);

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

      {loading && rawData.length === 0 ? (
        <div className="text-center py-20 text-gray-500 dark:text-gray-400">Đang tải dữ liệu...</div>
      ) : rawData.length > 0 ? (
        <div className="space-y-4">
          <div className="flex items-center gap-2 p-4 rounded-2xl border border-gray-200 dark:border-white/[0.05] bg-white dark:bg-white/[0.03]">
            <h3 className="text-lg font-semibold text-gray-800 dark:text-white/90 flex items-center gap-2">
              <Database className="text-brand-500" size={20} />
              Dữ liệu thô ({rawData.length} bài)
            </h3>
          </div>
          <div className="overflow-hidden rounded-2xl border border-gray-200 dark:border-white/[0.05]">
            <div className="overflow-x-auto">
              <table className="min-w-full">
                <thead className="border-b border-gray-100 dark:border-white/[0.05]">
                  <tr className="bg-gray-50 dark:bg-gray-900">
                    <th className="px-5 py-3 text-theme-xs font-medium text-gray-500 dark:text-gray-400 text-left uppercase">Thumbnail</th>
                    <th className="px-5 py-3 text-theme-xs font-medium text-gray-500 dark:text-gray-400 text-left uppercase">Tiêu đề</th>
                    <th className="px-5 py-3 text-theme-xs font-medium text-gray-500 dark:text-gray-400 text-left uppercase">Mô tả</th>
                    <th className="px-5 py-3 text-theme-xs font-medium text-gray-500 dark:text-gray-400 text-left uppercase">Nguồn</th>
                    <th className="px-5 py-3 text-theme-xs font-medium text-gray-500 dark:text-gray-400 text-left uppercase">Ngày đăng</th>
                    <th className="px-5 py-3 text-theme-xs font-medium text-gray-500 dark:text-gray-400 text-left uppercase">Link</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-white/[0.05]">
                  {rawData.map((item, idx) => (
                    <tr key={idx} className="hover:bg-gray-50 dark:hover:bg-white/[0.02] transition-colors">
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
                        <span className="line-clamp-2">{item.title}</span>
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
                              day: '2-digit',
                              hour: '2-digit',
                              minute: '2-digit'
                            })
                          : "—"}
                      </td>
                      <td className="px-5 py-4">
                        <a
                          href={item.url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-brand-500 hover:underline text-theme-sm"
                        >
                          Link gốc
                        </a>
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
