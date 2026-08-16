import { useEffect, useRef, useState } from 'react';
import {
  FileText,
  Eye,
  RotateCcw,
  Upload,
  RefreshCw,
  XCircle,
  Loader2,
  CheckCircle,
  AlertTriangle,
  ExternalLink,
  Trash2,
} from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pagination } from '../components/common/Pagination';
import { TableSkeletonRows } from '../components/common/TableSkeletonRows';
import {
  KnowledgeArticleState,
  getKnowledgeArticles,
  getKnowledgeArticle,
  getWpConfig,
  retryArticle,
  publishArticle,
  republishArticle,
  deleteKnowledgeArticle,
  bulkDeleteKnowledgeArticles,
  bulkPublishKnowledgeArticles,
  type KnowledgeArticle,
} from '../api/knowledge-articles.api';
import { getApiErrorMessage } from '../utils/fetchPaginated';
import { DEFAULT_PAGE_SIZE } from '../types/pagination';
import type { PaginatedResponse, PaginationMeta } from '../types/pagination';

// ── Helpers ──────────────────────────────────────────────

const STATUS_LABELS: Record<string, string> = {
  [KnowledgeArticleState.PENDING]: 'Đang chờ',
  [KnowledgeArticleState.GENERATING_CONTENT]: 'Đang viết',
  [KnowledgeArticleState.CONTENT_READY]: 'Sẵn sàng nội dung',
  [KnowledgeArticleState.GENERATING_IMAGE]: 'Đang tạo ảnh',
  [KnowledgeArticleState.READY]: 'Sẵn sàng',
  [KnowledgeArticleState.PUBLISHING]: 'Đang đăng',
  [KnowledgeArticleState.PUBLISHED]: 'Đã đăng',
  [KnowledgeArticleState.FAILED]: 'Lỗi',
};

const STATUS_BADGE_CLASSES: Record<string, string> = {
  [KnowledgeArticleState.PENDING]: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
  [KnowledgeArticleState.GENERATING_CONTENT]: 'bg-blue-100 text-blue-600 dark:bg-blue-500/15 dark:text-blue-400',
  [KnowledgeArticleState.CONTENT_READY]: 'bg-indigo-100 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-400',
  [KnowledgeArticleState.GENERATING_IMAGE]: 'bg-purple-100 text-purple-600 dark:bg-purple-500/15 dark:text-purple-400',
  [KnowledgeArticleState.READY]: 'bg-amber-100 text-amber-600 dark:bg-amber-500/15 dark:text-amber-400',
  [KnowledgeArticleState.PUBLISHING]: 'bg-cyan-100 text-cyan-600 dark:bg-cyan-500/15 dark:text-cyan-400',
  [KnowledgeArticleState.PUBLISHED]: 'bg-emerald-100 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400',
  [KnowledgeArticleState.FAILED]: 'bg-red-100 text-red-600 dark:bg-red-500/15 dark:text-red-400',
};

const formatDisplayDate = (raw?: string | null): string => {
  if (!raw) return '—';
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? '—' : parsed.toLocaleDateString('vi-VN');
};

const STATUS_FILTER_OPTIONS = [
  { value: 'all', label: 'Tất cả' },
  { value: KnowledgeArticleState.PENDING, label: 'Đang chờ' },
  { value: KnowledgeArticleState.READY, label: 'Sẵn sàng' },
  { value: KnowledgeArticleState.PUBLISHED, label: 'Đã đăng' },
  { value: KnowledgeArticleState.FAILED, label: 'Lỗi' },
] as const;

// ── Sub-components ───────────────────────────────────────

const StatusBadge = ({ state }: { state: KnowledgeArticleState | null }) => {
  if (!state) return <span className="text-gray-400">—</span>;
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${STATUS_BADGE_CLASSES[state] ?? ''}`}>
      {STATUS_LABELS[state] ?? state}
    </span>
  );
};

const ToastNotification = ({
  title,
  description,
  type = 'success',
  onClose,
}: {
  title: string;
  description: string;
  type?: 'success' | 'error';
  onClose: () => void;
}) => {
  const [isClosing, setIsClosing] = useState(false);
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; });

  useEffect(() => {
    const timer = setTimeout(() => {
      setIsClosing(true);
      setTimeout(() => onCloseRef.current(), 300);
    }, 4000);
    return () => clearTimeout(timer);
  }, [title, description]);

  const Icon = type === 'success' ? CheckCircle : AlertTriangle;
  const iconColor = type === 'success' ? 'text-emerald-500' : 'text-red-500';

  return (
    <div className={`fixed top-4 right-4 z-[9999] transition-all duration-300 ${isClosing ? 'translate-x-full opacity-0' : 'translate-x-0 opacity-100'}`}>
      <div className="bg-white dark:bg-gray-800 shadow-2xl rounded-xl p-4 w-[340px] border border-gray-100 dark:border-gray-700">
        <div className="flex items-start gap-3">
          <Icon className={`w-5 h-5 ${iconColor} shrink-0 mt-0.5`} />
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100">{title}</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{description}</p>
          </div>
          <button onClick={() => { setIsClosing(true); setTimeout(onClose, 300); }} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 p-1">
            <XCircle className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};

// ── Detail Modal ─────────────────────────────────────────

const ArticleDetailModal = ({
  articleId,
  onClose,
}: {
  articleId: string;
  onClose: () => void;
}) => {
  const { data: article, isLoading } = useQuery<KnowledgeArticle>({
    queryKey: ['knowledge-article', articleId],
    queryFn: ({ signal }) => getKnowledgeArticle(articleId, signal),
  });

  const { data: wpConfig } = useQuery({
    queryKey: ['knowledge-config', 'wp'],
    queryFn: ({ signal }) => getWpConfig(signal),
    staleTime: 300_000,
  });

  const wpPostUrl = article?.wpPostId && wpConfig?.siteUrl
    ? `${wpConfig.siteUrl.replace(/\/$/, '')}/?p=${article.wpPostId}`
    : null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden border border-gray-200 dark:border-gray-800" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 md:p-6 border-b border-gray-100 dark:border-gray-800 shrink-0">
          <h2 className="text-xl font-bold text-gray-900 dark:text-white truncate pr-4">
            {isLoading ? 'Đang tải...' : article?.title ?? 'Không có tiêu đề'}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors p-1 shrink-0">
            <XCircle size={24} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 md:p-6">
          {isLoading ? (
            <div className="flex justify-center items-center h-32">
              <Loader2 className="w-8 h-8 animate-spin text-brand-500" />
            </div>
          ) : !article ? (
            <p className="text-gray-500 dark:text-gray-400 text-center py-8">Không tìm thấy bài viết.</p>
          ) : (
            <div className="space-y-6">
              {/* Meta */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="p-3 bg-gray-50 dark:bg-gray-800/50 rounded-lg">
                  <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Trạng thái</p>
                  <StatusBadge state={article.pipelineState} />
                </div>
                <div className="p-3 bg-gray-50 dark:bg-gray-800/50 rounded-lg">
                  <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Danh mục</p>
                  <p className="text-sm font-medium text-gray-900 dark:text-white">{article.categorySlug ?? '—'}</p>
                </div>
                <div className="p-3 bg-gray-50 dark:bg-gray-800/50 rounded-lg">
                  <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Ngày tạo</p>
                  <p className="text-sm font-medium text-gray-900 dark:text-white">{formatDisplayDate(article.createdAt)}</p>
                </div>
                <div className="p-3 bg-gray-50 dark:bg-gray-800/50 rounded-lg">
                  <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">WP Post ID</p>
                  <p className="text-sm font-medium text-gray-900 dark:text-white">{article.wpPostId ?? '—'}</p>
                </div>
              </div>

              {/* Error info */}
              {article.pipelineError && (
                <div className="p-4 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/25 rounded-lg">
                  <p className="text-sm font-medium text-red-600 dark:text-red-400">
                    Lỗi (bước {article.pipelineFailedStep}): {article.pipelineError}
                  </p>
                </div>
              )}

              {/* Featured Image */}
              {article.featuredImageUrl && (
                <div>
                  <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Ảnh đại diện</h3>
                  <img
                    src={article.featuredImageUrl}
                    alt={article.title ?? 'Featured'}
                    className="w-full max-h-64 object-cover rounded-lg border border-gray-200 dark:border-gray-700"
                  />
                </div>
              )}

              {/* Content */}
              <div>
                <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Nội dung</h3>
                <div className="prose prose-sm dark:prose-invert max-w-none prose-p:leading-relaxed prose-img:rounded-xl bg-white dark:bg-gray-900 p-4 rounded-xl border border-gray-200 dark:border-gray-800 whitespace-pre-wrap">
                  {article.content ?? article.summary ?? 'Chưa có nội dung.'}
                </div>
              </div>

              {/* WP Link */}
              {wpPostUrl && (
                <div className="flex items-center gap-2">
                  <a
                    href={wpPostUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-sm text-brand-500 hover:text-brand-600 dark:text-brand-400"
                  >
                    <ExternalLink size={14} />
                    Xem trên WordPress (ID: {article.wpPostId})
                  </a>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// ── Main Screen ──────────────────────────────────────────

type StatusFilter = 'all' | KnowledgeArticleState;

export default function KnowledgeArticlesScreen() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(DEFAULT_PAGE_SIZE);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [detailArticleId, setDetailArticleId] = useState<string | null>(null);
  const [notification, setNotification] = useState<{ title: string; description: string; type?: 'success' | 'error' } | null>(null);

  // Reset page when filters change
  const filterSignature = `${statusFilter}|${limit}`;
  const [prevFilterSignature, setPrevFilterSignature] = useState(filterSignature);
  if (prevFilterSignature !== filterSignature) {
    setPrevFilterSignature(filterSignature);
    setPage(1);
    setSelectedIds(new Set());
  }

  const { data: articlesPage, isLoading, isFetching } = useQuery<PaginatedResponse<KnowledgeArticle>, Error>({
    queryKey: ['knowledge-articles', { page, limit, status: statusFilter }],
    queryFn: ({ signal }) =>
      getKnowledgeArticles({ page, limit, status: statusFilter === 'all' ? undefined : statusFilter }, signal),
    placeholderData: (prev) => prev,
  });

  const articles = articlesPage?.data ?? [];
  const meta: PaginationMeta = articlesPage?.meta ?? { total: 0, page, limit, totalPages: 0 };

  useEffect(() => {
    if (meta.totalPages > 0 && page > meta.totalPages) {
      setPage(meta.totalPages);
    }
  }, [meta.totalPages, page]);

  // ── Mutations ────────────────────────────────────────

  const retryMutation = useMutation({
    mutationFn: retryArticle,
    onSuccess: async () => {
      setNotification({ title: 'Thành công', description: 'Đã gửi yêu cầu retry', type: 'success' });
      await queryClient.invalidateQueries({ queryKey: ['knowledge-articles'] });
    },
    onError: (err) => setNotification({ title: 'Lỗi', description: getApiErrorMessage(err, 'Retry thất bại'), type: 'error' }),
  });

  const publishMutation = useMutation({
    mutationFn: publishArticle,
    onSuccess: async () => {
      setNotification({ title: 'Thành công', description: 'Đã gửi bài lên WordPress', type: 'success' });
      await queryClient.invalidateQueries({ queryKey: ['knowledge-articles'] });
    },
    onError: (err) => setNotification({ title: 'Lỗi', description: getApiErrorMessage(err, 'Đăng bài thất bại'), type: 'error' }),
  });

  const republishMutation = useMutation({
    mutationFn: republishArticle,
    onSuccess: async () => {
      setNotification({ title: 'Thành công', description: 'Đã cập nhật bài trên WordPress', type: 'success' });
      await queryClient.invalidateQueries({ queryKey: ['knowledge-articles'] });
    },
    onError: (err) => setNotification({ title: 'Lỗi', description: getApiErrorMessage(err, 'Republish thất bại'), type: 'error' }),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteKnowledgeArticle,
    onSuccess: async () => {
      setNotification({ title: 'Thành công', description: 'Đã xóa bài viết', type: 'success' });
      await queryClient.invalidateQueries({ queryKey: ['knowledge-articles'] });
    },
    onError: (err) => setNotification({ title: 'Lỗi', description: getApiErrorMessage(err, 'Xóa thất bại'), type: 'error' }),
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: bulkDeleteKnowledgeArticles,
    onSuccess: async () => {
      setSelectedIds(new Set());
      setNotification({ title: 'Thành công', description: 'Đã xóa các bài viết được chọn', type: 'success' });
      await queryClient.invalidateQueries({ queryKey: ['knowledge-articles'] });
    },
    onError: (err) => setNotification({ title: 'Lỗi', description: getApiErrorMessage(err, 'Xóa hàng loạt thất bại'), type: 'error' }),
  });

  const bulkPublishMutation = useMutation({
    mutationFn: bulkPublishKnowledgeArticles,
    onSuccess: async () => {
      setSelectedIds(new Set());
      setNotification({ title: 'Thành công', description: 'Đã gửi đăng hàng loạt', type: 'success' });
      await queryClient.invalidateQueries({ queryKey: ['knowledge-articles'] });
    },
    onError: (err) => setNotification({ title: 'Lỗi', description: getApiErrorMessage(err, 'Đăng hàng loạt thất bại'), type: 'error' }),
  });

  const isMutating = retryMutation.isPending || publishMutation.isPending || republishMutation.isPending;

  // ── Selection ────────────────────────────────────────

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const isAllOnPageSelected = articles.length > 0 && articles.every((a) => selectedIds.has(a._id));

  const toggleSelectAllOnPage = () => {
    setSelectedIds((prev) => {
      const isAllSelected = articles.length > 0 && articles.every((a) => prev.has(a._id));
      return isAllSelected
        ? new Set([...prev].filter((id) => !articles.some((a) => a._id === id)))
        : new Set([...prev, ...articles.map((a) => a._id)]);
    });
  };



  return (
    <div className="space-y-6">
      {notification && (
        <ToastNotification
          title={notification.title}
          description={notification.description}
          type={notification.type}
          onClose={() => setNotification(null)}
        />
      )}

      {detailArticleId && (
        <ArticleDetailModal
          articleId={detailArticleId}
          onClose={() => setDetailArticleId(null)}
        />
      )}

      {/* Header */}
      <div className="flex flex-col gap-2">
        <h2 className="text-title-sm font-semibold text-gray-800 dark:text-white/90 flex items-center gap-3">
          <FileText className="text-brand-500" size={32} />
          Knowledge Articles
        </h2>
        <p className="text-theme-sm text-gray-500 dark:text-gray-400">
          Quản lý bài viết kiến thức tự động — tạo, chỉnh sửa, đăng lên WordPress.
        </p>
      </div>

      {/* Filters + Bulk Actions */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <label htmlFor="status-filter" className="text-sm font-medium text-gray-700 dark:text-gray-300">
            Lọc theo trạng thái:
          </label>
          <select
            id="status-filter"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
            className="bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-800 dark:text-white/90 focus:outline-none focus:border-brand-300 focus:ring-1 focus:ring-brand-500 transition-all"
          >
            {STATUS_FILTER_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>

        {selectedIds.size > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-500 dark:text-gray-400">{selectedIds.size} được chọn</span>
            <button
              onClick={() => bulkPublishMutation.mutate([...selectedIds])}
              disabled={bulkPublishMutation.isPending}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium bg-brand-500 hover:bg-brand-600 text-white rounded-lg transition-colors disabled:opacity-50"
            >
              <Upload size={14} />
              Đăng hàng loạt
            </button>
            <button
              onClick={() => bulkDeleteMutation.mutate([...selectedIds])}
              disabled={bulkDeleteMutation.isPending}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium bg-red-500 hover:bg-red-600 text-white rounded-lg transition-colors disabled:opacity-50"
            >
              <Trash2 size={14} />
              Xóa hàng loạt
            </button>
          </div>
        )}
      </div>

      {/* Table */}
      <div className="bg-white dark:bg-white/[0.03] border border-gray-200 dark:border-white/[0.05] rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-200 dark:border-white/[0.05]">
                <th className="px-4 py-3 text-left">
                  <input
                    type="checkbox"
                    checked={isAllOnPageSelected}
                    onChange={toggleSelectAllOnPage}
                    className="rounded border-gray-300 dark:border-gray-600"
                    aria-label="Chọn tất cả"
                  />
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Tiêu đề</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Trạng thái</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Danh mục</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Ngày tạo</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Thao tác</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-white/[0.05]">
              {isLoading ? (
                <TableSkeletonRows cols={6} rows={5} />
              ) : articles.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-gray-500 dark:text-gray-400">
                    Không có bài viết nào.
                  </td>
                </tr>
              ) : (
                articles.map((article) => (
                  <tr
                    key={article._id}
                    className={`hover:bg-gray-50 dark:hover:bg-white/[0.02] transition-colors ${selectedIds.has(article._id) ? 'bg-brand-50/50 dark:bg-brand-500/5' : ''}`}
                  >
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(article._id)}
                        onChange={() => toggleSelect(article._id)}
                        className="rounded border-gray-300 dark:border-gray-600"
                        aria-label={`Chọn bài viết ${article.title}`}
                      />
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => setDetailArticleId(article._id)}
                        className="text-sm font-medium text-gray-900 dark:text-white hover:text-brand-500 dark:hover:text-brand-400 transition-colors text-left truncate max-w-[300px] block"
                      >
                        {article.title ?? 'Không có tiêu đề'}
                      </button>
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge state={article.pipelineState} />
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">
                      {article.categorySlug ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">
                      {formatDisplayDate(article.createdAt)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          onClick={() => setDetailArticleId(article._id)}
                          className="p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded-lg hover:bg-gray-100 dark:hover:bg-white/[0.05] transition-colors"
                          title="Xem chi tiết"
                        >
                          <Eye size={16} />
                        </button>
                        {article.pipelineState === KnowledgeArticleState.FAILED && (
                          <button
                            onClick={() => retryMutation.mutate(article._id)}
                            disabled={isMutating}
                            className="p-1.5 text-amber-500 hover:text-amber-600 rounded-lg hover:bg-amber-50 dark:hover:bg-amber-500/10 transition-colors disabled:opacity-50"
                            title="Thử lại"
                          >
                            <RotateCcw size={16} />
                          </button>
                        )}
                        {article.pipelineState === KnowledgeArticleState.READY && (
                          <button
                            onClick={() => publishMutation.mutate(article._id)}
                            disabled={isMutating}
                            className="p-1.5 text-brand-500 hover:text-brand-600 rounded-lg hover:bg-brand-50 dark:hover:bg-brand-500/10 transition-colors disabled:opacity-50"
                            title="Đăng bài"
                          >
                            <Upload size={16} />
                          </button>
                        )}
                        {article.pipelineState === KnowledgeArticleState.PUBLISHED && (
                          <button
                            onClick={() => republishMutation.mutate(article._id)}
                            disabled={isMutating}
                            className="p-1.5 text-emerald-500 hover:text-emerald-600 rounded-lg hover:bg-emerald-50 dark:hover:bg-emerald-500/10 transition-colors disabled:opacity-50"
                            title="Đăng lại"
                          >
                            <RefreshCw size={16} />
                          </button>
                        )}
                        <button
                          onClick={() => deleteMutation.mutate(article._id)}
                          disabled={deleteMutation.isPending}
                          className="p-1.5 text-red-400 hover:text-red-600 rounded-lg hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors disabled:opacity-50"
                          title="Xóa"
                        >
                          <Trash2 size={16} />
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

      {/* Pagination */}
      <Pagination
        meta={meta}
        onPageChange={setPage}
        onLimitChange={(newLimit) => { setLimit(newLimit); setPage(1); }}
        isDisabled={isFetching}
        itemLabel="bài viết"
      />
    </div>
  );
}
