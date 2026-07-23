import { useState } from "react";
import { Play, Check, AlertCircle, Save, Search } from "lucide-react";

export default function ManualCrawlScreen() {
  const [loading, setLoading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [results, setResults] = useState<any[]>([]);
  const [rawData, setRawData] = useState<any[]>([]);
  const [filePath, setFilePath] = useState("");
  const [message, setMessage] = useState("");

  const handleCrawl = async () => {
    setLoading(true);
    setMessage("");
    setRawData([]);
    setResults([]);
    setFilePath("");
    try {
      const response = await fetch("/api/news-manager/crawl", {
        method: "POST",
      });
      const resData = await response.json();
      if (!response.ok) {
        throw new Error(resData.message || "Lỗi từ máy chủ");
      }
      const data = resData.data || [];
      setRawData(data);
      setFilePath(resData.filePath || "");
      if (data.length > 0) {
        setMessage(
          "Thu thập thành công " +
            data.length +
            " bài viết! Vui lòng tiếp tục phân tích AI.",
        );
      } else {
        setMessage("Quá trình hoàn tất nhưng không tìm thấy bài viết nào mới.");
      }
    } catch (error: any) {
      setMessage(error.message || "Có lỗi xảy ra khi thu thập dữ liệu.");
    } finally {
      setLoading(false);
    }
  };

  const handleAnalyze = async () => {
    if (!filePath) return;
    setAnalyzing(true);
    setMessage("");
    try {
      const response = await fetch("/api/news-manager/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filePath }),
      });
      const resData = await response.json();
      if (!response.ok) {
        throw new Error(resData.message || "Lỗi từ máy chủ");
      }
      setResults(resData.data || []);
      setMessage("Phân tích AI thành công!");
    } catch (error: any) {
      setMessage(error.message || "Có lỗi xảy ra khi phân tích AI.");
    } finally {
      setAnalyzing(false);
    }
  };

  const handleSave = async () => {
    if (results.length === 0) return;
    try {
      const response = await fetch("/api/news-manager/articles/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(results),
      });
      const data = await response.json();
      setMessage(
        `Đã lưu ${data.savedCount} bài. Bỏ qua ${data.duplicates} bài trùng.`,
      );
      setResults([]);
    } catch (error) {
      setMessage("Lỗi khi lưu bài viết.");
    }
  };

  return (
    <div className="w-full flex flex-col gap-6">
      <header className="flex flex-col md:flex-row md:justify-between md:items-end gap-6 pb-6 border-b border-gray-200 dark:border-white/[0.05]">
        <div>
          <h2 className="text-title-sm font-semibold text-gray-800 dark:text-white/90 mb-2">
            Thu thập tin tức thủ công
          </h2>
          <p className="text-theme-sm text-gray-500 dark:text-gray-400 max-w-2xl leading-relaxed">
            Kích hoạt luồng Firecrawl cào tin và dùng AI phân tích chuyên sâu tự
            động.
          </p>
        </div>
        <div className="flex gap-4">
          <button
            onClick={handleCrawl}
            disabled={loading || analyzing}
            className="inline-flex items-center justify-center gap-3 px-5 py-3 font-medium text-white transition-all duration-300 bg-brand-500 hover:bg-brand-600 rounded-lg active:scale-[0.98] disabled:opacity-70 disabled:hover:scale-100"
          >
            <Play
              size={20}
              className={loading ? "animate-pulse" : ""}
            />
            <span>
              {loading ? "Đang thu thập..." : "Chạy quy trình thu thập"}
            </span>
          </button>

          {rawData.length > 0 && results.length === 0 && (
            <button
              onClick={handleAnalyze}
              disabled={analyzing || loading}
              className="inline-flex items-center justify-center gap-3 px-5 py-3 font-medium text-white transition-all duration-300 bg-brand-500 hover:bg-brand-600 rounded-lg active:scale-[0.98] disabled:opacity-70 disabled:hover:scale-100"
            >
              <Search
                size={20}
                className={analyzing ? "animate-pulse" : ""}
              />
              <span>
                {analyzing ? "Đang phân tích..." : "Phân tích AI"}
              </span>
            </button>
          )}
        </div>
      </header>

      {message && (
        <div className="p-4 rounded-lg bg-success-50 dark:bg-success-500/15 border border-success-100 dark:border-success-500/25 flex items-center gap-3 text-success-500">
          <Check className="shrink-0" size={20} />
          <span className="text-theme-sm font-medium">{message}</span>
        </div>
      )}

      {rawData.length > 0 && results.length === 0 && (
        <div className="space-y-4">
          <div className="flex items-center gap-2 p-4 rounded-2xl border border-gray-200 dark:border-white/[0.05] bg-white dark:bg-white/[0.03]">
            <h3 className="text-lg font-semibold text-gray-800 dark:text-white/90 flex items-center gap-2">
              <span className="bg-brand-500 w-2 h-6 rounded-full inline-block"></span>
              Dữ liệu thô đã thu thập ({rawData.length} bài)
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
                    <th className="px-5 py-3 text-theme-xs font-medium text-gray-500 dark:text-gray-400 text-left uppercase">Ngày</th>
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
                          ? new Date(item.publishedAt).toLocaleDateString("vi-VN")
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
      )}

      {results.length > 0 ? (
        <div className="space-y-6">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 p-4 rounded-2xl border border-gray-200 dark:border-white/[0.05] bg-white dark:bg-white/[0.03]">
            <h3 className="text-lg font-semibold text-gray-800 dark:text-white/90 flex items-center gap-2">
              <span className="bg-brand-500 w-2 h-6 rounded-full inline-block"></span>
              Kết quả phân tích từ AI ({results.length})
            </h3>
            <button
              onClick={handleSave}
              className="flex items-center gap-2 bg-success-500 hover:bg-success-600 text-white px-5 py-3 rounded-lg transition-all font-medium"
            >
              <Save size={18} />
              Duyệt & Lưu Database
            </button>
          </div>

          <div className="grid grid-cols-1 gap-6">
            {results.map((item, idx) => (
              <div
                key={idx}
                className="rounded-2xl border border-gray-200 dark:border-white/[0.05] bg-white dark:bg-white/[0.03] p-7 hover:border-brand-300 dark:hover:border-brand-500/40 transition-all duration-300 group"
              >
                <div className="flex flex-col sm:flex-row justify-between items-start gap-4 mb-4">
                  <h4 className="text-xl font-semibold text-gray-800 dark:text-white/90 leading-tight group-hover:text-brand-500 transition-colors">
                    {item.title}
                  </h4>
                  <span
                    className={`px-4 py-1.5 rounded-full text-xs font-bold tracking-wide shrink-0 ${
                      item.impactLevel === "Rất cao"
                        ? "bg-error-50 dark:bg-error-500/15 text-error-500 border border-error-100 dark:border-error-500/25"
                        : "bg-warning-50 dark:bg-warning-500/15 text-warning-500 border border-warning-100 dark:border-warning-500/25"
                    }`}
                  >
                    {item.impactLevel}
                  </span>
                </div>
                <p className="text-gray-500 dark:text-gray-400 text-theme-sm mb-6 leading-relaxed bg-gray-50 dark:bg-gray-900 p-4 rounded-lg border border-gray-100 dark:border-white/[0.05]">
                  {item.summary}
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-sm mb-6">
                  <div className="space-y-2">
                    <span className="text-brand-500 font-semibold text-xs uppercase tracking-wider flex items-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-brand-500"></span>{" "}
                      Lý do quan trọng
                    </span>
                    <p className="text-gray-600 dark:text-gray-300 leading-relaxed pl-3.5 border-l-2 border-brand-200 dark:border-brand-500/20">
                      {item.importanceReason}
                    </p>
                  </div>
                  <div className="space-y-2">
                    <span className="text-success-500 font-semibold text-xs uppercase tracking-wider flex items-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-success-500"></span>{" "}
                      Nhận định chuyên gia
                    </span>
                    <p className="text-gray-600 dark:text-gray-300 leading-relaxed pl-3.5 border-l-2 border-success-200 dark:border-success-500/20">
                      {item.expertOpinion}
                    </p>
                  </div>
                </div>
                <div className="pt-4 border-t border-gray-200 dark:border-white/[0.05] flex flex-wrap gap-x-6 gap-y-3 text-xs text-gray-500 dark:text-gray-400">
                  <span className="flex items-center gap-1.5 font-medium">
                    <AlertCircle size={14} className="text-gray-400 dark:text-gray-500" />{" "}
                    {item.source}
                  </span>
                  <span className="flex items-center gap-1.5 font-medium text-gray-600 dark:text-gray-300">
                    <span className="text-gray-400 dark:text-gray-500">Đối tượng:</span>{" "}
                    {item.targetAudience?.join(", ")}
                  </span>
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1 font-medium text-brand-500 hover:text-brand-600 hover:underline ml-auto"
                  >
                    Xem bài viết gốc{" "}
                    <span className="text-lg leading-none">↗</span>
                  </a>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : rawData.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 px-4 rounded-2xl border border-dashed border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-white/[0.02] mt-8">
          <div className="flex flex-col items-center text-center">
            <div className="w-20 h-20 rounded-full bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 flex items-center justify-center mb-6">
              <Search size={36} className="text-brand-500" />
            </div>
            <h3 className="text-2xl font-semibold text-gray-800 dark:text-white/90 mb-3">
              Chưa có dữ liệu phân tích
            </h3>
            <p className="text-gray-500 dark:text-gray-400 max-w-md text-theme-sm leading-relaxed">
              Hệ thống đã sẵn sàng. Hãy bấm nút{" "}
              <span className="text-brand-500 font-medium">
                Chạy quy trình thu thập
              </span>{" "}
              ở góc trên để bắt đầu quét các trang báo và sử dụng AI để lọc tin
              tức.
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
