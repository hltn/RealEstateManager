import { useEffect, useState } from 'react';
import { Send, FileText } from 'lucide-react';

export default function ManageWpScreen() {
  const [articles, setArticles] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const fetchArticles = async () => {
    try {
      const res = await fetch('/api/news-manager/articles');
      const data = await res.json();
      setArticles(data.data || []);
    } catch (error) {
      console.error('Failed to fetch articles');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchArticles();
  }, []);

  const toggleSelect = (id: string) => {
    const newSet = new Set(selectedIds);
    if (newSet.has(id)) newSet.delete(id);
    else newSet.add(id);
    setSelectedIds(newSet);
  };

  const handlePublish = async (id: string) => {
    try {
      await fetch(`/api/news-manager/articles/${id}/publish`, { method: 'POST' });
      fetchArticles(); // Refresh status
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
      <header className="flex flex-col gap-2 pb-6 border-b border-white/10">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h2 className="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 to-teal-400">Quản lý Đăng tin WordPress</h2>
            <p className="text-slate-400 max-w-2xl text-sm leading-relaxed mt-2">Danh sách các tin tức đã duyệt trong Database và trạng thái đồng bộ lên WordPress.</p>
          </div>
          
          {selectedIds.size > 0 && (
            <button 
              onClick={handleBulkPublish}
              className="inline-flex items-center justify-center gap-2 text-sm font-semibold bg-emerald-600 hover:bg-emerald-500 text-white px-6 py-3 rounded-xl transition-all shadow-[0_0_20px_rgba(16,185,129,0.3)] hover:shadow-[0_0_30px_rgba(16,185,129,0.5)] active:scale-95 shrink-0"
            >
              <Send size={16} />
              Đăng {selectedIds.size} bài đã chọn
            </button>
          )}
        </div>
      </header>

      <div className="glass-panel rounded-2xl overflow-hidden shadow-[0_8px_30px_rgba(0,0,0,0.5)] border border-white/10 relative">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-slate-300">
            <thead className="bg-slate-900/80 text-xs uppercase text-slate-400 border-b border-white/10 tracking-wider">
              <tr>
                <th className="px-6 py-5 w-12">
                  <input type="checkbox" className="rounded bg-black/50 border-white/20 accent-emerald-500 w-4 h-4 transition-all" />
                </th>
                <th className="px-6 py-5 font-semibold">Tiêu đề bài viết</th>
                <th className="px-6 py-5 w-40 font-semibold">Độ ảnh hưởng</th>
                <th className="px-6 py-5 w-48 font-semibold">Nguồn / Ngày</th>
                <th className="px-6 py-5 w-36 font-semibold">Trạng thái</th>
                <th className="px-6 py-5 w-36 text-right font-semibold">Thao tác</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-6 py-16 text-center">
                    <div className="flex flex-col items-center justify-center gap-3 text-slate-400">
                      <div className="w-8 h-8 border-2 border-emerald-500/30 border-t-emerald-500 rounded-full animate-spin"></div>
                      <span className="text-sm font-medium">Đang tải dữ liệu...</span>
                    </div>
                  </td>
                </tr>
              ) : articles.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-20 text-center">
                    <div className="flex flex-col items-center justify-center gap-4 text-slate-400">
                      <div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center mb-2">
                        <FileText size={32} className="text-slate-500" />
                      </div>
                      <p className="text-base font-medium text-slate-300">Chưa có bài viết nào trong Database.</p>
                      <p className="text-sm">Hãy quay lại tab Thu thập thủ công để quét và lưu bài viết.</p>
                    </div>
                  </td>
                </tr>
              ) : (
                articles.map((article) => (
                  <tr key={article._id} className="hover:bg-white/5 transition-colors duration-200 group">
                    <td className="px-6 py-5">
                      <input 
                        type="checkbox" 
                        checked={selectedIds.has(article._id)}
                        onChange={() => toggleSelect(article._id)}
                        className="rounded bg-black/50 border-white/20 accent-emerald-500 w-4 h-4 cursor-pointer" 
                      />
                    </td>
                    <td className="px-6 py-5">
                      <div className="flex items-start gap-3">
                        <div className="mt-1 p-1.5 rounded-lg bg-white/5 text-slate-400 group-hover:text-emerald-400 group-hover:bg-emerald-500/10 transition-colors">
                          <FileText size={16} />
                        </div>
                        <span className="font-medium text-slate-200 line-clamp-2 leading-relaxed group-hover:text-white transition-colors">{article.title}</span>
                      </div>
                    </td>
                    <td className="px-6 py-5">
                      <span className={`px-3 py-1 rounded-full text-xs font-semibold shadow-inner inline-block ${
                        article.impactLevel === 'Rất cao' 
                          ? 'bg-red-500/10 text-red-400 border border-red-500/30' 
                          : 'bg-amber-500/10 text-amber-400 border border-amber-500/30'
                      }`}>
                        {article.impactLevel}
                      </span>
                    </td>
                    <td className="px-6 py-5">
                      <div className="flex flex-col gap-1">
                        <span className="font-medium text-slate-300 text-sm">{article.source}</span>
                        <span className="text-xs text-slate-500">{new Date(article.publishDate || article.createdAt).toLocaleDateString('vi-VN')}</span>
                      </div>
                    </td>
                    <td className="px-6 py-5">
                      {article.status === 'POSTED_WP' ? (
                        <div className="flex items-center gap-2">
                          <div className="relative flex h-2.5 w-2.5">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
                          </div>
                          <span className="text-emerald-400 font-medium text-xs">Đã đăng lên WP</span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <span className="w-2.5 h-2.5 rounded-full bg-amber-500/50 border border-amber-500"></span>
                          <span className="text-amber-400 font-medium text-xs">Chờ đăng</span>
                        </div>
                      )}
                    </td>
                    <td className="px-6 py-5 text-right">
                      {article.status !== 'POSTED_WP' && (
                        <button 
                          onClick={() => handlePublish(article._id)}
                          className="inline-flex items-center justify-center gap-2 text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg transition-all shadow-[0_0_15px_rgba(37,99,235,0.3)] hover:shadow-[0_0_20px_rgba(59,130,246,0.5)] active:scale-95"
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
