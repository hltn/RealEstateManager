import { useState, useEffect } from "react";
import { AlertCircle, Database } from "lucide-react";

export default function RawArticlesScreen() {
  const [loading, setLoading] = useState(false);
  const [rawData, setRawData] = useState<any[]>([]);
  const [error, setError] = useState("");

  const fetchRawArticles = async () => {
    setLoading(true);
    setError("");
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

  return (
    <div className="w-full flex flex-col gap-6">
      <header className="flex flex-col md:flex-row md:justify-between md:items-end gap-6 pb-6 border-b border-white/10">
        <div>
          <h2 className="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-indigo-400 mb-2">
            Tin tức thô
          </h2>
          <p className="text-slate-400 max-w-2xl text-sm leading-relaxed">
            Danh sách tất cả các bài viết đã thu thập nhưng chưa qua phân tích AI hoặc đã lưu vào bảng tạm (RawArticle).
          </p>
        </div>
        <div className="flex gap-4">
          <button
            onClick={fetchRawArticles}
            disabled={loading}
            className="group relative inline-flex items-center justify-center gap-3 px-6 py-2.5 font-medium text-white transition-all duration-300 bg-white/10 rounded-xl hover:bg-white/20 active:scale-[0.98] disabled:opacity-70 disabled:hover:scale-100 border border-white/10"
          >
            {loading ? "Đang tải..." : "Làm mới"}
          </button>
        </div>
      </header>

      {error && (
        <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/30 flex items-center gap-3 text-red-200">
          <AlertCircle className="text-red-400 shrink-0" size={20} />
          <span className="text-sm font-medium">{error}</span>
        </div>
      )}

      {loading && rawData.length === 0 ? (
        <div className="text-center py-20 text-slate-400">Đang tải dữ liệu...</div>
      ) : rawData.length > 0 ? (
        <div className="space-y-4 animate-[fadeInUp_0.5s_ease-out_both]">
          <div className="flex items-center gap-2 bg-slate-900/50 p-4 rounded-2xl border border-white/5">
            <h3 className="text-lg font-semibold text-white flex items-center gap-2">
              <Database className="text-blue-400" size={20} />
              Dữ liệu thô ({rawData.length} bài)
            </h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {rawData.map((item, idx) => (
              <div
                key={idx}
                className="bg-white/5 rounded-xl border border-white/10 overflow-hidden flex flex-col group hover:border-white/20 transition-colors"
              >
                {item.thumbnailUrl && (
                  <img
                    src={item.thumbnailUrl}
                    alt={item.title}
                    className="w-full h-48 object-cover opacity-80 group-hover:opacity-100 transition-opacity"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = "none";
                    }}
                  />
                )}
                <div className="p-4 flex flex-col flex-grow">
                  <h4 className="font-medium text-white mb-2 line-clamp-2">
                    {item.title}
                  </h4>
                  {item.description && (
                    <p className="text-sm text-slate-400 mb-4 line-clamp-3 flex-grow">
                      {item.description}
                    </p>
                  )}
                  <div className="flex justify-between items-center text-xs text-slate-400 mt-auto pt-3 border-t border-white/10">
                    <span className="flex flex-col gap-1">
                      <span className="flex items-center gap-1">
                        <AlertCircle size={12} /> {item.source}
                      </span>
                      {item.publishedAt && (
                        <span>
                          {new Date(item.publishedAt).toLocaleDateString("vi-VN", {
                            year: 'numeric',
                            month: '2-digit',
                            day: '2-digit',
                            hour: '2-digit',
                            minute: '2-digit'
                          })}
                        </span>
                      )}
                    </span>
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-blue-400 hover:underline bg-blue-500/10 px-3 py-1.5 rounded-lg"
                    >
                      Link gốc
                    </a>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="text-center py-20 text-slate-400">Không có dữ liệu.</div>
      )}
    </div>
  );
}
