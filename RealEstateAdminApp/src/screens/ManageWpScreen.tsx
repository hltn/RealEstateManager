import { useEffect, useState } from 'react';
import { Send, FileText } from 'lucide-react';

export default function ManageWpScreen() {
  const [articles, setArticles] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const fetchArticles = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/news-manager/articles');
      const data = await res.json();
      setArticles(data.data || []);
    } catch (error) {
      console.error('Error fetching articles', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchArticles();
  }, []);

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handlePublish = async (id: string) => {
    try {
      await fetch(`/api/news-manager/articles/${id}/publish`, {
        method: 'POST'
      });
      fetchArticles();
    } catch (error) {
      console.error('Error publishing', error);
    }
  };

  const handleBulkPublish = async () => {
    if (selectedIds.size === 0) return;
    try {
      await fetch('/api/news-manager/articles/publish-bulk', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ ids: Array.from(selectedIds) })
      });
      setSelectedIds(new Set());
      fetchArticles();
    } catch (error) {
      console.error('Error bulk publishing', error);
    }
  };

  return (
    <div className="w-full flex flex-col gap-6">
      <header className="flex flex-col gap-2 pb-6 border-b border-gray-200 dark:border-white/[0.05]">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h2 className="text-title-sm font-semibold text-gray-800 dark:text-white/90">Quản lý Đăng tin WordPress</h2>
            <p className="text-theme-sm text-gray-500 dark:text-gray-400 max-w-2xl leading-relaxed mt-2">Danh sách các tin tức đã duyệt trong Database và trạng thái đồng bộ lên WordPress.</p>
          </div>
          
          {selectedIds.size > 0 && (
            <button 
              onClick={handleBulkPublish}
              className="inline-flex items-center justify-center gap-2 text-sm font-semibold bg-brand-500 hover:bg-brand-600 text-white px-5 py-3 rounded-lg transition-all active:scale-95 shrink-0"
            >
              <Send size={16} />
              Đăng {selectedIds.size} bài đã chọn
            </button>
          )}
        </div>
      </header>

      <div className="overflow-hidden rounded-2xl border border-gray-200 dark:border-white/[0.05]">
        <div className="overflow-x-auto">
          <table className="min-w-full">
            <thead className="border-b border-gray-100 dark:border-white/[0.05]">
              <tr className="bg-gray-50 dark:bg-gray-900">
                <th className="px-5 py-3 text-theme-xs font-medium text-gray-500 dark:text-gray-400 text-left uppercase w-12">
                  <input type="checkbox" className="rounded border-gray-300 dark:border-gray-600 w-4 h-4 accent-brand-500 transition-all" />
                </th>
                <th className="px-5 py-3 text-theme-xs font-medium text-gray-500 dark:text-gray-400 text-left uppercase">Tiêu đề bài viết</th>
                <th className="px-5 py-3 text-theme-xs font-medium text-gray-500 dark:text-gray-400 text-left uppercase w-40">Độ ảnh hưởng</th>
                <th className="px-5 py-3 text-theme-xs font-medium text-gray-500 dark:text-gray-400 text-left uppercase w-48">Nguồn / Ngày</th>
                <th className="px-5 py-3 text-theme-xs font-medium text-gray-500 dark:text-gray-400 text-left uppercase w-36">Trạng thái</th>
                <th className="px-5 py-3 text-theme-xs font-medium text-gray-500 dark:text-gray-400 text-right uppercase w-36">Thao tác</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-white/[0.05]">
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-5 py-16 text-center">
                    <div className="flex flex-col items-center justify-center gap-3 text-gray-500 dark:text-gray-400">
                      <div className="w-8 h-8 border-2 border-brand-300 border-t-brand-500 rounded-full animate-spin"></div>
                      <span className="text-theme-sm font-medium">Đang tải dữ liệu...</span>
                    </div>
                  </td>
                </tr>
              ) : articles.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-5 py-20 text-center">
                    <div className="flex flex-col items-center justify-center gap-4 text-gray-500 dark:text-gray-400">
                      <div className="w-16 h-16 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center mb-2">
                        <FileText size={32} className="text-gray-400 dark:text-gray-500" />
                      </div>
                      <p className="text-base font-medium text-gray-700 dark:text-gray-300">Chưa có bài viết nào trong Database.</p>
                      <p className="text-theme-sm">Hãy quay lại tab Thu thập thủ công để quét và lưu bài viết.</p>
                    </div>
                  </td>
                </tr>
              ) : (
                articles.map((article) => (
                  <tr key={article._id} className="hover:bg-gray-50 dark:hover:bg-white/[0.02] transition-colors duration-200 group">
                    <td className="px-5 py-4">
                      <input 
                        type="checkbox" 
                        checked={selectedIds.has(article._id)}
                        onChange={() => toggleSelect(article._id)}
                        className="rounded border-gray-300 dark:border-gray-600 w-4 h-4 accent-brand-500 cursor-pointer" 
                      />
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex items-start gap-3">
                        <div className="mt-1 p-1.5 rounded-lg bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500 group-hover:text-brand-500 group-hover:bg-brand-50 dark:group-hover:bg-brand-500/10 transition-colors">
                          <FileText size={16} />
                        </div>
                        <span className="font-medium text-gray-800 dark:text-white/90 line-clamp-2 leading-relaxed group-hover:text-brand-500 transition-colors">{article.title}</span>
                      </div>
                    </td>
                    <td className="px-5 py-4">
                      <span className={`px-3 py-1 rounded-full text-xs font-semibold inline-block ${
                        article.impactLevel === 'Rất cao' 
                          ? 'bg-error-50 dark:bg-error-500/15 text-error-500 border border-error-100 dark:border-error-500/25' 
                          : 'bg-warning-50 dark:bg-warning-500/15 text-warning-500 border border-warning-100 dark:border-warning-500/25'
                      }`}>
                        {article.impactLevel}
                      </span>
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex flex-col gap-1">
                        <span className="font-medium text-gray-700 dark:text-gray-300 text-theme-sm">{article.source}</span>
                        <span className="text-xs text-gray-500 dark:text-gray-400">{new Date(article.publishDate || article.createdAt).toLocaleDateString('vi-VN')}</span>
                      </div>
                    </td>
                    <td className="px-5 py-4">
                      {article.status === 'POSTED_WP' ? (
                        <div className="flex items-center gap-2">
                          <div className="relative flex h-2.5 w-2.5">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success-400 opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-success-500"></span>
                          </div>
                          <span className="text-success-500 font-medium text-xs">Đã đăng lên WP</span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <span className="w-2.5 h-2.5 rounded-full bg-warning-300 border border-warning-500"></span>
                          <span className="text-warning-500 font-medium text-xs">Chờ đăng</span>
                        </div>
                      )}
                    </td>
                    <td className="px-5 py-4 text-right">
                      {article.status !== 'POSTED_WP' && (
                        <button 
                          onClick={() => handlePublish(article._id)}
                          className="inline-flex items-center justify-center gap-2 text-xs font-semibold bg-brand-500 hover:bg-brand-600 text-white px-4 py-2 rounded-lg transition-all active:scale-95"
                        >
                          <Send size={14} />
                          Đăng bài
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
