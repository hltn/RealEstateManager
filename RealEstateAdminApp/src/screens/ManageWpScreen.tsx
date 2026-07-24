import { useEffect, useState, useMemo } from 'react';
import { Search } from 'lucide-react';
import { Send, FileText } from 'lucide-react';

export default function ManageWpScreen() {
  const [articles, setArticles] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [searchTerm, setSearchTerm] = useState('');
  const [sortOrder, setSortOrder] = useState('newest');
  const [bulkAction, setBulkAction] = useState('publish');

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


  const displayData = useMemo(() => {
    let result = [...articles];
    if (searchTerm.length >= 2) {
      const lowerSearch = searchTerm.toLowerCase();
      result = result.filter(
        (article) =>
          article.title?.toLowerCase().includes(lowerSearch) ||
          article.source?.toLowerCase().includes(lowerSearch)
      );
    }
    result.sort((a, b) => {
      const dateA = new Date(a.publishDate || a.createdAt).getTime();
      const dateB = new Date(b.publishDate || b.createdAt).getTime();
      return sortOrder === 'newest' ? dateB - dateA : dateA - dateB;
    });
    return result;
  }, [articles, searchTerm, sortOrder]);

  const highlightText = (text, query) => {
    if (!text) return '';
    if (!query || query.length < 2) return text;
    const escapedQuery = query.replace(/[.*+?^\$\{\}()|[\]\\]/g, '\\$&');
    const parts = text.split(new RegExp(`(${escapedQuery})`, 'gi'));
    return (
      <>
        {parts.map((part, idx) =>
          part.toLowerCase() === query.toLowerCase() ? (
            <span key={idx} className="bg-brand-500/20 text-brand-700 dark:text-brand-400 px-0.5 rounded">
              {part}
            </span>
          ) : (
            <span key={idx}>{part}</span>
          )
        )}
      </>
    );
  };

  const handleBulkAction = async () => {
    if (selectedIds.size === 0) return;
    
    if (bulkAction === 'publish') {
      try {
        await fetch('/api/news-manager/articles/publish-bulk', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids: Array.from(selectedIds) })
        });
        setSelectedIds(new Set());
        fetchArticles();
      } catch (error) {
        console.error('Error bulk publishing', error);
      }
    } else if (bulkAction === 'delete') {
      if (!window.confirm(`Bạn có chắc chắn muốn xóa ${selectedIds.size} bài viết đã chọn?`)) return;
      try {
        await fetch('/api/news-manager/articles/delete-bulk', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids: Array.from(selectedIds) })
        });
        setSelectedIds(new Set());
        fetchArticles();
      } catch (error) {
        console.error('Error bulk deleting', error);
      }
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
          
          <div className="flex items-center gap-4 flex-1 justify-end">
            <div className="relative max-w-md w-full md:w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
              <input
                type="text"
                placeholder="Tìm kiếm..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2 bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-white/[0.05] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 transition-all"
              />
            </div>
            <select
              value={sortOrder}
              onChange={(e) => setSortOrder(e.target.value)}
              className="bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-white/[0.05] rounded-xl px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 transition-all"
            >
              <option value="newest">Mới nhất</option>
              <option value="oldest">Cũ nhất</option>
            </select>
          </div>
        </div>

        {selectedIds.size > 0 && (
          <div className="flex items-center gap-3 mt-4 pt-4 border-t border-gray-100 dark:border-white/[0.05]">
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Hành động hàng loạt:</span>
            <select
              value={bulkAction}
              onChange={(e) => setBulkAction(e.target.value)}
              className="bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-white/[0.05] rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 transition-all"
            >
              <option value="publish">Đăng bài</option>
              <option value="delete">Xóa</option>
            </select>
            <button
              onClick={handleBulkAction}
              className="inline-flex items-center justify-center gap-2 text-sm font-semibold bg-brand-500 hover:bg-brand-600 text-white px-4 py-1.5 rounded-lg transition-all active:scale-95 shrink-0"
            >
              Áp dụng ({selectedIds.size})
            </button>
          </div>
        )}
      </header>

      <div className="overflow-hidden rounded-2xl border border-gray-200 dark:border-white/[0.05]">
        <div className="overflow-x-auto">
          <table className="min-w-full">
            <thead className="border-b border-gray-100 dark:border-white/[0.05]">
              <tr className="bg-gray-50 dark:bg-gray-900">
                <th className="px-5 py-3 text-theme-xs font-medium text-gray-500 dark:text-gray-400 text-left uppercase w-12">
                  <input type="checkbox" onChange={() => {
                    if (selectedIds.size === displayData.length && displayData.length > 0) {
                      setSelectedIds(new Set());
                    } else {
                      setSelectedIds(new Set(displayData.map(a => a._id)));
                    }
                  }} checked={displayData.length > 0 && selectedIds.size === displayData.length} className="rounded border-gray-300 dark:border-gray-600 w-4 h-4 accent-brand-500 transition-all cursor-pointer" />
                </th>
                <th className="px-2 py-3 text-theme-xs font-medium text-gray-500 dark:text-gray-400 text-left uppercase">STT</th>
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
                  <td colSpan={7} className="px-5 py-16 text-center">
                    <div className="flex flex-col items-center justify-center gap-3 text-gray-500 dark:text-gray-400">
                      <div className="w-8 h-8 border-2 border-brand-300 border-t-brand-500 rounded-full animate-spin"></div>
                      <span className="text-theme-sm font-medium">Đang tải dữ liệu...</span>
                    </div>
                  </td>
                </tr>
              ) : articles.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-5 py-20 text-center">
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
                displayData.map((article, idx) => (
                  <tr key={article._id} className="hover:bg-gray-50 dark:hover:bg-white/[0.02] transition-colors duration-200 group">
                    <td className="px-5 py-4">
                      <input 
                        type="checkbox" 
                        checked={selectedIds.has(article._id)}
                        onChange={() => toggleSelect(article._id)}
                        className="rounded border-gray-300 dark:border-gray-600 w-4 h-4 accent-brand-500 cursor-pointer" 
                      />
                    </td>
                    <td className="px-2 py-4 text-theme-sm text-gray-500 dark:text-gray-400">{idx + 1}</td>
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-3">
                        {article.thumbnailUrl ? (
                          <img
                            src={article.thumbnailUrl}
                            alt={article.title}
                            className="w-[60px] h-[40px] object-cover rounded flex-shrink-0"
                            onError={(e) => {
                              e.currentTarget.style.display = 'none';
                            }}
                          />
                        ) : (
                          <div className="w-[60px] h-[40px] bg-gray-100 dark:bg-gray-800 rounded flex items-center justify-center flex-shrink-0">
                            <FileText size={16} className="text-gray-400" />
                          </div>
                        )}
                        <span className="font-medium text-gray-800 dark:text-white/90 line-clamp-2 leading-relaxed group-hover:text-brand-500 transition-colors">{highlightText(article.title || '', searchTerm)}</span>
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
