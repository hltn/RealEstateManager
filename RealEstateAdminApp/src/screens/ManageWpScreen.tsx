import { useEffect, useMemo, useState } from 'react';
import { Search, Send, FileText, Eye, Wand2, Loader2, CheckCircle, XCircle, AlertTriangle, Info as InfoIcon, History, Copy, Check } from 'lucide-react';
import { Link } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DatePicker } from '../components/ui/DatePicker';
import { Pagination } from '../components/common/Pagination';
import { TableSkeletonRows } from '../components/common/TableSkeletonRows';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { buildListQuery, fetchPaginated } from '../utils/fetchPaginated';
import { DEFAULT_PAGE_SIZE } from '../types/pagination';
import type { PaginatedResponse } from '../types/pagination';


export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface ToastProps {
  title: string;
  description: string;
  type?: ToastType;
  onClose: () => void;
}

const ToastNotification = ({ title, description, type = 'success', onClose }: ToastProps) => {
  const [progress, setProgress] = useState(100);
  const [isClosing, setIsClosing] = useState(false);

  useEffect(() => {
    // start progress shrink immediately
    const t1 = setTimeout(() => setProgress(0), 50);
    
    const timer = setTimeout(() => {
      setIsClosing(true);
      setTimeout(onClose, 300); // Wait for slide out animation
    }, 5000);
    
    return () => {
      clearTimeout(t1);
      clearTimeout(timer);
    };
  }, [title, description, onClose]);

  const config = {
    success: {
      icon: CheckCircle,
      color: 'text-emerald-500 dark:text-emerald-400',
      bgIcon: 'bg-emerald-50 dark:bg-emerald-500/10',
      progress: 'bg-emerald-500'
    },
    error: {
      icon: XCircle,
      color: 'text-red-500 dark:text-red-400',
      bgIcon: 'bg-red-50 dark:bg-red-500/10',
      progress: 'bg-red-500'
    },
    warning: {
      icon: AlertTriangle,
      color: 'text-amber-500 dark:text-amber-400',
      bgIcon: 'bg-amber-50 dark:bg-amber-500/10',
      progress: 'bg-amber-500'
    },
    info: {
      icon: InfoIcon,
      color: 'text-blue-500 dark:text-blue-400',
      bgIcon: 'bg-blue-50 dark:bg-blue-500/10',
      progress: 'bg-blue-500'
    }
  }[type];

  const IconComponent = config.icon;

  return (
    <div className={`fixed top-4 right-4 z-[9999] transition-all duration-300 transform ${isClosing ? 'translate-x-full opacity-0' : 'translate-x-0 opacity-100'}`}>
      <div className="bg-white dark:bg-gray-800 shadow-2xl rounded-xl p-4 w-[340px] relative overflow-hidden border border-gray-100 dark:border-gray-700">
        <div className="flex items-start gap-3 mb-2">
          <div className={`w-8 h-8 rounded-full ${config.bgIcon} ${config.color} flex items-center justify-center shrink-0 mt-0.5`}>
            <IconComponent className="w-5 h-5" />
          </div>
          <div className="flex-1 flex flex-col min-w-0">
             <div className="flex items-start justify-between gap-2">
               <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100 truncate">{title}</h3>
               <button onClick={() => { setIsClosing(true); setTimeout(onClose, 300); }} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors shrink-0 -mt-0.5 -mr-1 p-1">
                 <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"/></svg>
               </button>
             </div>
             <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 pr-2 line-clamp-2">{description}</p>
          </div>
        </div>
        <div className={`absolute bottom-0 left-0 h-1.5 ${config.progress} transition-all duration-[5000ms] ease-linear`} style={{ width: `${progress}%` }} />
      </div>
    </div>
  );
};

const AnalysisDetailModal = ({ content, title, onClose }: { content: string, title: string, onClose: () => void }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy', err);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-xl w-full max-w-5xl max-h-[90vh] flex flex-col overflow-hidden border border-gray-200 dark:border-gray-800">
        <div className="flex items-center justify-between p-4 md:p-6 border-b border-gray-100 dark:border-gray-800 shrink-0">
          <h2 className="text-xl font-bold text-gray-900 dark:text-white">{title}</h2>
          <div className="flex items-center gap-3">
            <button
              onClick={handleCopy}
              className="inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg transition-colors"
            >
              {copied ? <Check size={16} className="text-green-500" /> : <Copy size={16} />}
              {copied ? 'Đã copy' : 'Copy'}
            </button>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors p-1">
              <XCircle size={24} />
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-4 md:p-6 bg-gray-50 dark:bg-gray-900/50">
          <div className="prose prose-sm dark:prose-invert max-w-none prose-p:leading-relaxed prose-headings:font-bold prose-a:text-brand-500 hover:prose-a:text-brand-600 prose-img:rounded-xl bg-white dark:bg-gray-900 p-6 rounded-xl border border-gray-200 dark:border-gray-800 shadow-sm">
            <ReactMarkdown>{content}</ReactMarkdown>
          </div>
        </div>
        <div className="p-4 border-t border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 flex justify-end shrink-0">
          <button
            onClick={handleCopy}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium bg-brand-500 hover:bg-brand-600 text-white rounded-lg transition-colors shadow-sm"
          >
            {copied ? <Check size={16} /> : <Copy size={16} />}
            {copied ? 'Đã copy' : 'Copy toàn bộ nội dung'}
          </button>
        </div>
      </div>
    </div>
  );
};

const AnalysisHistoryModal = ({ isOpen, onClose, onShowDetail }: { isOpen: boolean, onClose: () => void, onShowDetail: (content: string) => void }) => {
  const [history, setHistory] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isOpen) {
      fetchHistory();
    }
  }, [isOpen]);

  const fetchHistory = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/v1/news-manager/articles/market-analysis-history');
      const data = await res.json();
      setHistory(data.data || []);
    } catch (error) {
      console.error('Error fetching history', error);
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-xl w-full max-w-4xl max-h-[80vh] flex flex-col overflow-hidden border border-gray-200 dark:border-gray-800">
        <div className="flex items-center justify-between p-6 border-b border-gray-100 dark:border-gray-800 shrink-0">
          <h2 className="text-xl font-bold text-gray-900 dark:text-white">Lịch sử phân tích thị trường</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors p-1">
            <XCircle size={24} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
             <div className="flex justify-center items-center h-32">
               <Loader2 className="w-8 h-8 animate-spin text-brand-500" />
             </div>
          ) : history.length === 0 ? (
             <div className="flex flex-col items-center justify-center h-48 gap-3">
               <History className="w-12 h-12 text-gray-300 dark:text-gray-600" />
               <p className="text-center text-gray-500 dark:text-gray-400 font-medium">Chưa có lịch sử phân tích.</p>
             </div>
          ) : (
            <div className="space-y-4">
              {history.map((item, index) => (
                <div key={item._id || index} className="p-4 border border-gray-200 dark:border-gray-700 rounded-xl hover:border-brand-500 dark:hover:border-brand-500 transition-colors bg-gray-50 dark:bg-gray-800/30">
                  <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                    <div>
                      <div className="font-semibold text-gray-900 dark:text-white mb-1">
                        Phân tích lúc {new Date(item.createdAt).toLocaleString('vi-VN')}
                      </div>
                      <div className="text-sm text-gray-600 dark:text-gray-400 line-clamp-2">
                        Từ {item.articleIds?.length || 0} bài viết
                      </div>
                    </div>
                    <button
                      onClick={() => {
                        onShowDetail(item.content);
                      }}
                      className="inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors shrink-0 shadow-sm"
                    >
                      <Eye size={16} />
                      Xem chi tiết
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const ARTICLES_ENDPOINT = '/api/v1/news-manager/articles';

type SortOrder = 'newest' | 'oldest';

/** Bài viết đã duyệt trong Database, dùng cho bảng quản lý đăng WordPress. */
interface WpArticle {
  _id: string;
  title?: string;
  source?: string;
  url?: string;
  thumbnailUrl?: string;
  publishDate?: string;
  createdAt?: string;
  status?: string | string[];
}

/** Hiển thị ngày theo định dạng DD/MM/YYYY (vi-VN), trả về "—" nếu không có ngày hợp lệ. */
const formatDisplayDate = (article: WpArticle): string => {
  const rawDate = article.publishDate || article.createdAt;
  if (!rawDate) return '—';
  const parsed = new Date(rawDate);
  return Number.isNaN(parsed.getTime()) ? '—' : parsed.toLocaleDateString('vi-VN');
};

export default function ManageWpScreen() {
  const queryClient = useQueryClient();

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [searchTerm, setSearchTerm] = useState('');
  const [filterDate, setFilterDate] = useState('');
  const [sortOrder, setSortOrder] = useState<SortOrder>('newest');
  const [bulkAction, setBulkAction] = useState('publish');
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(DEFAULT_PAGE_SIZE);
  const [cleaningIds, setCleaningIds] = useState<Set<string>>(new Set());
  const [publishingIds, setPublishingIds] = useState<Set<string>>(new Set());
  const [notification, setNotification] = useState<{title: string, description: string, type?: ToastType} | null>(null);
  const [marketAnalysisResult, setMarketAnalysisResult] = useState<string | null>(null);
  const [showHistoryModal, setShowHistoryModal] = useState(false);

  // Debounce ô tìm kiếm để không lọc lại liên tục khi user đang gõ.
  const searchQuery = useDebouncedValue(searchTerm, 400);

  // GET /articles hiện chỉ nhận page/limit/date (DTO backend whitelist đúng 3 field này).
  // Vì vậy chỉ `date` là filter server-side và mới cần reset trang.
  // Điều chỉnh ngay trong render (không dùng useEffect) để không phát sinh thêm
  // một request với cặp "filter mới + page cũ".
  const filterSignature = `${filterDate}|${limit}`;
  const [prevFilterSignature, setPrevFilterSignature] = useState(filterSignature);
  if (prevFilterSignature !== filterSignature) {
    setPrevFilterSignature(filterSignature);
    setPage(1);
    setSelectedIds(new Set());
  }

  const queryString = buildListQuery({
    page,
    limit,
    date: filterDate,
  });

  const {
    data: articlesPage,
    isLoading,
    isFetching,
    isPlaceholderData,
    error: queryError,
  } = useQuery<PaginatedResponse<WpArticle>, Error>({
    queryKey: ['wp-articles', { page, limit, date: filterDate }],
    queryFn: ({ signal }) =>
      fetchPaginated<WpArticle>(`${ARTICLES_ENDPOINT}?${queryString}`, page, limit, signal),
    // Giữ dữ liệu trang trước trong lúc tải trang mới để bảng không nháy trắng.
    placeholderData: (previousData) => previousData,
  });

  /**
   * Search + sort ở màn này chỉ áp dụng TRONG TRANG hiện tại, vì backend
   * GET /articles chưa hỗ trợ query param search/sort.
   * TODO: chuyển sang server-side khi backend bổ sung search/sort cho endpoint này.
   */
  const articles = useMemo(() => {
    const pageArticles = articlesPage?.data ?? [];
    const filtered =
      searchQuery.length >= 2
        ? pageArticles.filter((article) => {
            const keyword = searchQuery.toLowerCase();
            return (
              article.title?.toLowerCase().includes(keyword) ||
              article.source?.toLowerCase().includes(keyword)
            );
          })
        : [...pageArticles];

    // Đồng bộ với BE: sort theo createdAt (BE cũng sort theo createdAt) để STT global offset khớp đúng.
    return filtered.sort((a, b) => {
      const timeA = new Date(a.createdAt || 0).getTime();
      const timeB = new Date(b.createdAt || 0).getTime();
      return sortOrder === 'newest' ? timeB - timeA : timeA - timeB;
    });
  }, [articlesPage, searchQuery, sortOrder]);
  const meta = articlesPage?.meta ?? { total: 0, page, limit, totalPages: 0 };

  // Nếu trang hiện tại vượt quá totalPages (VD: vừa xóa hết bài ở trang cuối), lùi về trang cuối còn dữ liệu.
  useEffect(() => {
    if (meta.totalPages > 0 && page > meta.totalPages) {
      setPage(meta.totalPages);
    }
  }, [meta.totalPages, page]);

  useEffect(() => {
    if (!queryError) return;
    setNotification({
      title: 'Lỗi',
      description: queryError.message || 'Không tải được danh sách bài viết',
      type: 'error',
    });
  }, [queryError]);

  /** Làm mới danh sách và bỏ selection sau các thao tác ghi. */
  const invalidateArticles = async () => {
    setSelectedIds(new Set());
    await queryClient.invalidateQueries({ queryKey: ['wp-articles'] });
  };

  const changePage = (nextPage: number) => {
    // Clear selection khi đổi trang: giữ lại các id không còn hiển thị rất dễ
    // dẫn tới đăng/xóa nhầm bài mà user không nhìn thấy.
    setSelectedIds(new Set());
    setPage(nextPage);
  };

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const isAllOnPageSelected =
    articles.length > 0 && articles.every(article => selectedIds.has(article._id));

  // Có filter đang áp dụng thì thông báo rỗng phải khác với "database chưa có bài nào".
  const hasActiveFilter = Boolean(filterDate) || searchQuery.length >= 2;

  // Khi search/sort trong trang làm đổi thứ tự hoặc lược bớt dòng, STT tính theo
  // vị trí toàn cục không còn đúng, nên đánh số lại từ 1 trong phạm vi kết quả.
  const isInPageAdjusted = searchQuery.length >= 2 || sortOrder !== 'newest';

  /** Chọn / bỏ chọn toàn bộ bài viết trên trang hiện tại. */
  const toggleSelectAllOnPage = () => {
    setSelectedIds(prev => {
      const isAllSelected = articles.length > 0 && articles.every(article => prev.has(article._id));
      return isAllSelected ? new Set<string>() : new Set(articles.map(article => article._id));
    });
  };

  /** Đăng một bài lên WordPress. */
  const handlePublish = async (id: string) => {
    try {
      setPublishingIds(prev => new Set(prev).add(id));
      const res = await fetch(`${ARTICLES_ENDPOINT}/${id}/publish`, { method: 'POST' });
      if (!res.ok) throw new Error('Đăng bài thất bại');
      await queryClient.invalidateQueries({ queryKey: ['wp-articles'] });
    } catch (error) {
      setNotification({
        title: 'Lỗi',
        description: error instanceof Error ? error.message : 'Lỗi khi đăng bài',
        type: 'error'
      });
    } finally {
      setPublishingIds(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  /** Làm sạch nội dung 1 bài viết; cập nhật trực tiếp vào cache trang hiện tại. */
  const handleClean = async (article: WpArticle) => {
    try {
      setCleaningIds(prev => new Set(prev).add(article._id));
      const res = await fetch(`${ARTICLES_ENDPOINT}/${article._id}/clean`, { method: 'POST' });
      const responseData = (await res.json().catch(() => null)) as { data?: WpArticle } | null;
      if (!res.ok) throw new Error('Làm sạch dữ liệu thất bại');

      if (responseData?.data) {
        const cleanedArticle = responseData.data;
        queryClient.setQueryData<PaginatedResponse<WpArticle>>(
          ['wp-articles', { page, limit, date: filterDate }],
          (previous) =>
            previous
              ? {
                  ...previous,
                  data: previous.data.map(item =>
                    item._id === cleanedArticle._id ? cleanedArticle : item
                  )
                }
              : previous
        );
      }
      setNotification({
        title: 'Thành công',
        description: `Đã làm sạch dữ liệu "${article.title ?? ''}"`,
        type: 'success'
      });
    } catch (error) {
      setNotification({
        title: 'Lỗi',
        description: error instanceof Error ? error.message : 'Lỗi khi làm sạch dữ liệu',
        type: 'error'
      });
    } finally {
      setCleaningIds(prev => {
        const next = new Set(prev);
        next.delete(article._id);
        return next;
      });
    }
  };

  const highlightText = (text: string, query: string) => {
    if (!text) return '';
    if (!query || query.length < 2) return text;
    const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const parts = text.split(new RegExp(`(${escapedQuery})`, 'gi'));
    return (
      <>
        {parts.map((part: string, idx: number) =>
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

  /**
   * Thực thi hành động hàng loạt trên các bài ĐANG CHỌN Ở TRANG HIỆN TẠI.
   * Với server-side pagination, selection chỉ có phạm vi 1 trang nên đây luôn là
   * tập con của trang đang xem — tránh tác động lên bài user không nhìn thấy.
   */
  const bulkMutation = useMutation<
    { message: string; analysisContent?: string },
    Error,
    { action: string; ids: string[] }
  >({
    mutationFn: async ({ action, ids }) => {
      if (action === 'publish') {
        const res = await fetch(`${ARTICLES_ENDPOINT}/publish-bulk`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids })
        });
        if (!res.ok) throw new Error('Đăng bài hàng loạt thất bại');
        return { message: 'Đã đăng bài hàng loạt thành công' };
      }

      if (action === 'analyze') {
        const res = await fetch(`${ARTICLES_ENDPOINT}/market-analysis-bulk`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids })
        });
        if (!res.ok) throw new Error('Crawl tin tức thất bại');
        return { message: 'Đã crawl xong tin tức' };
      }

      if (action === 'analyze_market_trends') {
        const res = await fetch(`${ARTICLES_ENDPOINT}/analyze-market-trends`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids })
        });
        const responseData = (await res.json().catch(() => null)) as
          | { data?: string; message?: string }
          | null;
        if (!res.ok || !responseData?.data) {
          throw new Error(responseData?.message || 'Lỗi phân tích thị trường');
        }
        return {
          message: 'Đã phân tích thị trường thành công',
          analysisContent: responseData.data
        };
      }

      if (action === 'delete') {
        const res = await fetch(`${ARTICLES_ENDPOINT}/delete-bulk`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids })
        });
        if (!res.ok) throw new Error('Xóa hàng loạt thất bại');
        return { message: 'Đã xóa thành công' };
      }

      throw new Error('Hành động không hợp lệ');
    },
    onSuccess: async ({ message, analysisContent }) => {
      if (analysisContent) setMarketAnalysisResult(analysisContent);
      await invalidateArticles();
      setNotification({ title: 'Thành công', description: message, type: 'success' });
    },
    onError: (error) => {
      setNotification({
        title: 'Lỗi',
        description: error.message || 'Có lỗi xảy ra khi xử lý hàng loạt',
        type: 'error'
      });
    }
  });

  const handleBulkAction = () => {
    if (selectedIds.size === 0) return;
    if (bulkAction === 'delete') {
      if (!window.confirm(`Bạn có chắc chắn muốn xóa ${selectedIds.size} bài viết đã chọn (trên trang này)?`)) {
        return;
      }
    }
    setNotification(null);
    bulkMutation.mutate({ action: bulkAction, ids: Array.from(selectedIds) });
  };

  const isApplying = bulkMutation.isPending;



  return (
    <div className="w-full flex flex-col gap-6">
      {notification && (
        <ToastNotification 
          key={notification.description} 
          title={notification.title} 
          description={notification.description} 
          type={notification.type} 
          onClose={() => setNotification(null)} 
        />
      )}
      {marketAnalysisResult && (
        <AnalysisDetailModal
          title="Kết quả Phân tích Thị trường"
          content={marketAnalysisResult}
          onClose={() => setMarketAnalysisResult(null)}
        />
      )}
      <AnalysisHistoryModal
        isOpen={showHistoryModal}
        onClose={() => setShowHistoryModal(false)}
        onShowDetail={(content) => {
          setMarketAnalysisResult(content);
        }}
      />
      <header className="flex flex-col gap-2 pb-6 border-b border-gray-200 dark:border-white/[0.05]">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h2 className="text-title-sm font-semibold text-gray-800 dark:text-white/90">Quản lý Đăng tin WordPress</h2>
            <p className="text-theme-sm text-gray-500 dark:text-gray-400 max-w-2xl leading-relaxed mt-2">Danh sách các tin tức đã duyệt trong Database và trạng thái đồng bộ lên WordPress.</p>
          </div>
        </div>

        <div className="mt-4 pt-4 border-t border-gray-100 dark:border-white/[0.05]">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Hành động hàng loạt:</span>
            <select
              value={bulkAction}
              onChange={(e) => setBulkAction(e.target.value)}
              disabled={selectedIds.size === 0}
              className="bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-white/[0.05] rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <option value="publish">Đăng bài</option>
              <option value="analyze">Crawl tin tức</option>
              <option value="analyze_market_trends">Phân tích thị trường</option>
              <option value="delete">Xóa</option>
            </select>
            <button
              onClick={handleBulkAction}
              disabled={isApplying || selectedIds.size === 0}
              className="inline-flex items-center justify-center gap-2 text-sm font-semibold bg-brand-500 hover:bg-brand-600 text-white px-4 py-1.5 rounded-lg transition-all active:scale-95 shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isApplying ? (
                <Loader2 size={16} className="animate-spin" />
              ) : null}
              Áp dụng {selectedIds.size > 0 ? `(${selectedIds.size})` : ''}
            </button>

            <div className="hidden xl:block w-px h-6 bg-gray-200 dark:bg-gray-700 mx-1"></div>

            <div className="flex items-center gap-2 w-full sm:w-[250px] lg:w-[300px]">
              <div className="relative w-full">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                <input
                  type="text"
                  placeholder="Tìm trong trang này..."
                  aria-label="Tìm kiếm trong trang hiện tại"
                  title="Backend chưa hỗ trợ tìm kiếm toàn bộ, hiện chỉ lọc trong trang đang xem"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-10 pr-4 py-1.5 bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-white/[0.05] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 transition-all"
                />
              </div>
            </div>

            <select
              value={sortOrder}
              onChange={(e) => setSortOrder(e.target.value as SortOrder)}
              aria-label="Sắp xếp theo ngày"
              className="bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-white/[0.05] rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 transition-all text-gray-700 dark:text-gray-300"
            >
              <option value="newest">Mới nhất</option>
              <option value="oldest">Cũ nhất</option>
            </select>

            <div className="relative w-[130px] sm:!w-[300px] flex-shrink-0">
              <DatePicker
                value={filterDate}
                onChange={setFilterDate}
                placeholder="Chọn ngày"
                className="w-full"
                inputClassName="py-1.5 bg-gray-50 dark:bg-gray-900 border-gray-200 dark:border-white/[0.05]"
              />
            </div>
            
            <div className="hidden sm:block w-px h-6 bg-gray-200 dark:bg-gray-700 mx-1"></div>

            <button
              onClick={() => setShowHistoryModal(true)}
              className="inline-flex items-center justify-center gap-2 text-sm font-semibold bg-indigo-50 dark:bg-indigo-500/10 hover:bg-indigo-100 dark:hover:bg-indigo-500/20 text-indigo-600 dark:text-indigo-400 px-4 py-1.5 rounded-lg transition-all active:scale-95 shrink-0 whitespace-nowrap"
            >
              <History size={16} />
              Xem lịch sử phân tích
            </button>
          </div>
        </div>
      </header>

      <div className="overflow-hidden rounded-2xl border border-gray-200 dark:border-white/[0.05]">
        <div className="overflow-x-auto">
          <table className="min-w-full">
            <thead className="border-b border-gray-100 dark:border-white/[0.05]">
              <tr className="bg-gray-50 dark:bg-gray-900">
                <th className="px-5 py-3 text-theme-xs font-medium text-gray-500 dark:text-gray-400 text-left uppercase w-12">
                  <input
                    type="checkbox"
                    onChange={toggleSelectAllOnPage}
                    checked={isAllOnPageSelected}
                    disabled={articles.length === 0}
                    title="Chọn tất cả trên trang này"
                    aria-label="Chọn tất cả trên trang này"
                    className="rounded border-gray-300 dark:border-gray-600 w-4 h-4 accent-brand-500 transition-all cursor-pointer disabled:cursor-not-allowed"
                  />
                </th>
                <th className="px-2 py-3 text-theme-xs font-medium text-gray-500 dark:text-gray-400 text-left uppercase">STT</th>
                <th className="px-5 py-3 text-theme-xs font-medium text-gray-500 dark:text-gray-400 text-left uppercase">Tiêu đề bài viết</th>
                                <th className="px-5 py-3 text-theme-xs font-medium text-gray-500 dark:text-gray-400 text-left uppercase w-48">Nguồn / Ngày</th>
                <th className="px-5 py-3 text-theme-xs font-medium text-gray-500 dark:text-gray-400 text-left uppercase w-36">Trạng thái</th>
                <th className="px-5 py-3 text-theme-xs font-medium text-gray-500 dark:text-gray-400 text-right uppercase w-36">Thao tác</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-white/[0.05]">
              {isLoading ? (
                <TableSkeletonRows columnCount={6} rowCount={5} />
              ) : articles.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-5 py-20 text-center">
                    <div className="flex flex-col items-center justify-center gap-4 text-gray-500 dark:text-gray-400">
                      <div className="w-16 h-16 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center mb-2">
                        <FileText size={32} className="text-gray-400 dark:text-gray-500" />
                      </div>
                      {hasActiveFilter ? (
                        <>
                          <p className="text-base font-medium text-gray-700 dark:text-gray-300">Không tìm thấy bài viết nào khớp bộ lọc.</p>
                          <p className="text-theme-sm">Thử xóa từ khóa tìm kiếm hoặc chọn ngày khác.</p>
                        </>
                      ) : (
                        <>
                          <p className="text-base font-medium text-gray-700 dark:text-gray-300">Chưa có bài viết nào trong Database.</p>
                          <p className="text-theme-sm">Hãy quay lại tab Thu thập thủ công để quét và lưu bài viết.</p>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ) : (
                articles.map((article, idx) => (
                  <tr
                    key={article._id}
                    className={`hover:bg-gray-50 dark:hover:bg-white/[0.02] transition-colors duration-200 group ${
                      isPlaceholderData ? 'opacity-60' : ''
                    }`}
                  >
                    <td className="px-5 py-4">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(article._id)}
                        onChange={() => toggleSelect(article._id)}
                        aria-label={`Chọn bài viết ${article.title ?? article._id}`}
                        className="rounded border-gray-300 dark:border-gray-600 w-4 h-4 accent-brand-500 cursor-pointer"
                      />
                    </td>
                    <td className="px-2 py-4 text-theme-sm text-gray-500 dark:text-gray-400">
                      {isInPageAdjusted ? idx + 1 : (meta.page - 1) * meta.limit + idx + 1}
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-3">
                        {article.thumbnailUrl ? (
                          <img
                            src={article.thumbnailUrl}
                            alt={article.title ?? ''}
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
                        <Link to={`/news-detail/${article._id}`} className="font-medium text-gray-800 dark:text-white/90 line-clamp-2 leading-relaxed group-hover:text-brand-500 transition-colors hover:underline">
                          {highlightText(article.title || '', searchTerm)}
                        </Link>
                      </div>
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex flex-col gap-1">
                        <span className="font-medium text-gray-700 dark:text-gray-300 text-theme-sm">{article.source}</span>
                        <span className="text-xs text-gray-500 dark:text-gray-400">{formatDisplayDate(article)}</span>
                      </div>
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex flex-wrap gap-2">
                        {(!article.status || (Array.isArray(article.status) && article.status.length === 0)) ? (
                          <div className="flex items-center gap-1.5 bg-warning-50 dark:bg-warning-500/10 px-2.5 py-1 rounded-full border border-warning-200 dark:border-warning-500/20">
                            <span className="w-1.5 h-1.5 rounded-full bg-warning-400"></span>
                            <span className="text-warning-600 dark:text-warning-400 font-medium text-xs">Chờ đăng</span>
                          </div>
                        ) : (
                          (Array.isArray(article.status) ? article.status : [article.status]).filter(Boolean).map((st: string) => {
                            if (st === 'POSTED_WP') {
                              return (
                                <div key={st} className="flex items-center gap-1.5 bg-success-50 dark:bg-success-500/10 px-2.5 py-1 rounded-full border border-success-200 dark:border-success-500/20">
                                  <div className="relative flex h-1.5 w-1.5">
                                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success-400 opacity-75"></span>
                                    <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-success-500"></span>
                                  </div>
                                  <span className="text-success-600 dark:text-success-400 font-medium text-xs">Đã đăng WP</span>
                                </div>
                              );
                            }
                            if (st === 'CRAWLED') {
                              return (
                                <div key={st} className="flex items-center gap-1.5 bg-info-50 dark:bg-info-500/10 px-2.5 py-1 rounded-full border border-info-200 dark:border-info-500/20">
                                  <span className="w-1.5 h-1.5 rounded-full bg-info-400"></span>
                                  <span className="text-info-600 dark:text-info-400 font-medium text-xs">Đã crawl</span>
                                </div>
                              );
                            }
                            return (
                              <div key={st} className="flex items-center gap-1.5 bg-gray-100 dark:bg-gray-800 px-2.5 py-1 rounded-full border border-gray-200 dark:border-gray-700">
                                <span className="w-1.5 h-1.5 rounded-full bg-gray-400"></span>
                                <span className="text-gray-600 dark:text-gray-400 font-medium text-xs">{st}</span>
                              </div>
                            );
                          })
                        )}
                      </div>
                    </td>
                    <td className="px-5 py-4 text-right">
                      <div className="grid grid-cols-2 gap-1.5 w-[180px] ml-auto">
                        <button 
                          onClick={() => handleClean(article)}
                          disabled={cleaningIds.has(article._id)}
                          className="inline-flex items-center justify-center gap-1 text-xs font-semibold bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed text-white px-2 py-1 rounded-lg transition-all active:scale-95 whitespace-nowrap"
                        >
                          {cleaningIds.has(article._id) ? (
                            <Loader2 size={14} className="animate-spin" />
                          ) : (
                            <Wand2 size={14} />
                          )}
                          Làm sạch
                        </button>
                        {!(Array.isArray(article.status) ? article.status : [article.status]).includes('POSTED_WP') && (
                          <button 
                            onClick={() => handlePublish(article._id)}
                            disabled={publishingIds.has(article._id)}
                            className="inline-flex items-center justify-center gap-1 text-xs font-semibold bg-brand-500 hover:bg-brand-600 disabled:opacity-50 disabled:cursor-not-allowed text-white px-2 py-1 rounded-lg transition-all active:scale-95 whitespace-nowrap"
                          >
                            {publishingIds.has(article._id) ? (
                              <Loader2 size={14} className="animate-spin" />
                            ) : (
                              <Send size={14} />
                            )}
                            Đăng bài
                          </button>
                        )}
                        <Link 
                          to={`/news-detail/${article._id}`}
                          className="inline-flex items-center justify-center gap-1 text-xs font-semibold bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 px-2 py-1 rounded-lg transition-all active:scale-95 whitespace-nowrap"
                        >
                          <Eye size={14} />
                          Xem
                        </Link>
                        <a 
                          href={article.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center justify-center gap-1 text-xs font-semibold bg-indigo-50 dark:bg-indigo-500/10 hover:bg-indigo-100 dark:hover:bg-indigo-500/20 text-indigo-600 dark:text-indigo-400 px-2 py-1 rounded-lg transition-all active:scale-95 whitespace-nowrap"
                        >
                          Xem nguồn
                        </a>
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
        itemLabel="bài viết"
      />
    </div>
  );
}
