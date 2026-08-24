import { useEffect, useState, useRef, Fragment } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Clock,
  Play,
  Loader2,
  CheckCircle,
  AlertCircle,
  ChevronDown,
  ChevronUp,
  Calendar,
  FileText,
} from 'lucide-react';
import {
  getKnowledgeCronConfig,
  saveKnowledgeCronConfig,
  parseNlSchedule,
  previewSchedule,
  activateSchedule,
  testRunPipeline,
  getPipelineLogs,
  getPipelineLogDetail,
  type PipelineLog,
  type NlParseResult,
  PipelineRunStatus,
} from '../api/knowledge-articles.api';
import { getApiErrorMessage } from '../utils/fetchPaginated';
import { Pagination } from '../components/common/Pagination';
import { TableSkeletonRows } from '../components/common/TableSkeletonRows';

import type { PaginatedResponse, PaginationMeta } from '../types/pagination';

// ── Helpers ──────────────────────────────────────────────

const formatDuration = (ms: number): string => {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
};

const RUN_STATUS_CLASSES: Record<string, string> = {
  [PipelineRunStatus.RUNNING]: 'bg-blue-100 text-blue-600 dark:bg-blue-500/15 dark:text-blue-400',
  [PipelineRunStatus.COMPLETED]: 'bg-emerald-100 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400',
  [PipelineRunStatus.FAILED]: 'bg-red-100 text-red-600 dark:bg-red-500/15 dark:text-red-400',
  [PipelineRunStatus.PARTIAL]: 'bg-amber-100 text-amber-600 dark:bg-amber-500/15 dark:text-amber-400',
};

const RUN_STATUS_LABELS: Record<string, string> = {
  [PipelineRunStatus.RUNNING]: 'Đang chạy',
  [PipelineRunStatus.COMPLETED]: 'Hoàn thành',
  [PipelineRunStatus.FAILED]: 'Thất bại',
  [PipelineRunStatus.PARTIAL]: 'Một phần',
};

// ── NL Cron Section ──────────────────────────────────────

const NlCronSection = () => {
  const queryClient = useQueryClient();
  const [nlInput, setNlInput] = useState('');
  const [parseResult, setParseResult] = useState<NlParseResult | null>(null);
  const [nextRuns, setNextRuns] = useState<string[]>([]);
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' }>({ text: '', type: 'success' });
  const initializedRef = useRef(false);

  const { data: cronConfig } = useQuery({
    queryKey: ['knowledge-config', 'cron'],
    queryFn: ({ signal }) => getKnowledgeCronConfig(signal),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (initializedRef.current || !cronConfig) return;
    initializedRef.current = true;
    setNlInput(cronConfig.nlDescription ?? '');
  }, [cronConfig]);

  const toggleMutation = useMutation({
    mutationFn: () =>
      saveKnowledgeCronConfig({
        isActive: cronConfig ? !cronConfig.isActive : true,
      }),
    onSuccess: async () => {
      setMessage({ text: cronConfig?.isActive ? 'Đã tắt cron' : 'Đã bật cron', type: 'success' });
      await queryClient.invalidateQueries({ queryKey: ['knowledge-config', 'cron'] });
    },
    onError: (err) => setMessage({ text: getApiErrorMessage(err, 'Lỗi'), type: 'error' }),
  });

  const parseMutation = useMutation({
    mutationFn: parseNlSchedule,
    onSuccess: async (result) => {
      setParseResult(result);
      // Fetch preview
      try {
        const preview = await previewSchedule(result.cronExpression);
        setNextRuns(preview.nextRuns);
      } catch {
        setNextRuns([]);
      }
    },
    onError: (err) => setMessage({ text: getApiErrorMessage(err, 'Lỗi parse NL'), type: 'error' }),
  });

  const activateMutation = useMutation({
    mutationFn: () =>
      activateSchedule({
        cronExpression: parseResult?.cronExpression ?? '',
        nlDescription: nlInput,
      }),
    onSuccess: async () => {
      setMessage({ text: 'Đã kích hoạt lịch trình!', type: 'success' });
      setParseResult(null);
      setNextRuns([]);
      await queryClient.invalidateQueries({ queryKey: ['knowledge-config', 'cron'] });
    },
    onError: (err) => setMessage({ text: getApiErrorMessage(err, 'Kích hoạt thất bại'), type: 'error' }),
  });

  const testRunMutation = useMutation({
    mutationFn: () => testRunPipeline({ articleCount: 1 }),
    onSuccess: () => setMessage({ text: 'Đã chạy test pipeline!', type: 'success' }),
    onError: (err) => setMessage({ text: getApiErrorMessage(err, 'Test run thất bại'), type: 'error' }),
  });

  const isActive = cronConfig?.isActive ?? false;

  return (
    <div className="space-y-6">
      {/* Status Card */}
      <div className="rounded-2xl border border-gray-200 dark:border-white/[0.05] bg-white dark:bg-white/[0.03] p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-4">
            <div className={`p-3 rounded-2xl transition-colors duration-300 ${isActive ? 'bg-success-50 dark:bg-success-500/15 text-success-500 border border-success-100 dark:border-success-500/25' : 'bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500 border border-gray-200 dark:border-gray-700'}`}>
              <Clock size={24} />
            </div>
            <div>
              <h3 className="text-lg font-bold text-gray-800 dark:text-white/90">Knowledge Pipeline</h3>
              <div className="flex items-center gap-2 mt-1">
                <span className={`relative flex h-2 w-2 ${isActive ? 'opacity-100' : 'opacity-0'}`}>
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-success-500" />
                </span>
                <p className={`text-xs font-medium tracking-wide uppercase ${isActive ? 'text-success-500' : 'text-gray-500 dark:text-gray-400'}`}>
                  {isActive ? 'Đang hoạt động' : 'Đã tạm dừng'}
                </p>
              </div>
            </div>
          </div>
          <button
            onClick={() => toggleMutation.mutate()}
            disabled={toggleMutation.isPending}
            className={`w-14 h-8 rounded-full p-1 transition-colors duration-300 relative ${isActive ? 'bg-success-500' : 'bg-gray-300 dark:bg-gray-600'}`}
            aria-label={isActive ? 'Tắt cron' : 'Bật cron'}
          >
            <div className={`w-6 h-6 rounded-full bg-white shadow-md transition-transform duration-300 ease-out ${isActive ? 'translate-x-6' : 'translate-x-0'}`} />
          </button>
        </div>

        {/* Current Schedule */}
        {cronConfig?.parsedCron && (
          <div className="p-3 bg-gray-50 dark:bg-gray-800/50 rounded-lg mb-4">
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Lịch trình hiện tại</p>
            <p className="text-sm font-mono font-medium text-gray-900 dark:text-white">{cronConfig.parsedCron}</p>
            {cronConfig.nlDescription && (
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">"{cronConfig.nlDescription}"</p>
            )}
            <div className="flex gap-4 mt-2 text-xs text-gray-500 dark:text-gray-400">
              {cronConfig.lastRunAt && <span>Lần chạy cuối: {new Date(cronConfig.lastRunAt).toLocaleString('vi-VN')}</span>}
              {cronConfig.nextRunAt && <span>Lần chạy tiếp: {new Date(cronConfig.nextRunAt).toLocaleString('vi-VN')}</span>}
            </div>
          </div>
        )}

        {/* NL Input */}
        <div className="space-y-3">
          <label className="text-theme-sm font-medium text-gray-700 dark:text-gray-300 block">
            Nhập lịch trình bằng ngôn ngữ tự nhiên
          </label>
          <textarea
            value={nlInput}
            onChange={(e) => setNlInput(e.target.value)}
            rows={2}
            placeholder='VD: "Mỗi ngày 8h sáng, từ thứ 2 đến thứ 6"'
            className="w-full bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-lg px-4 py-2.5 text-gray-800 dark:text-white/90 focus:outline-none focus:border-brand-300 focus:ring-1 focus:ring-brand-500 transition-all resize-y"
          />
          <button
            onClick={() => parseMutation.mutate(nlInput)}
            disabled={parseMutation.isPending || !nlInput.trim()}
            className="inline-flex items-center gap-2 px-4 py-2 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg font-medium text-sm transition-colors disabled:opacity-50"
          >
            {parseMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
            Preview
          </button>
        </div>

        {/* Parse Result */}
        {parseResult && (
          <div className="mt-4 p-4 bg-brand-50/50 dark:bg-brand-500/5 border border-brand-200 dark:border-brand-500/25 rounded-lg space-y-3">
            <div>
              <p className="text-xs text-gray-500 dark:text-gray-400">Cron Expression</p>
              <p className="text-sm font-mono font-bold text-brand-600 dark:text-brand-400">{parseResult.cronExpression}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500 dark:text-gray-400">Giải thích</p>
              <p className="text-sm text-gray-900 dark:text-white">{parseResult.explanation}</p>
            </div>
            {nextRuns.length > 0 && (
              <div>
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">5 lần chạy tiếp theo</p>
                <ul className="text-sm text-gray-700 dark:text-gray-300 space-y-0.5">
                  {nextRuns.map((run, i) => (
                    <li key={i} className="flex items-center gap-2">
                      <Calendar size={12} className="text-brand-400" />
                      {new Date(run).toLocaleString('vi-VN')}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <button
              onClick={() => activateMutation.mutate()}
              disabled={activateMutation.isPending}
              className="w-full bg-brand-500 hover:bg-brand-600 text-white font-medium py-2.5 rounded-lg transition-all flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {activateMutation.isPending ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle size={16} />}
              Xác nhận & Kích hoạt
            </button>
          </div>
        )}

        {/* Test Run */}
        <div className="mt-4 pt-4 border-t border-gray-200 dark:border-white/[0.05]">
          <button
            onClick={() => testRunMutation.mutate()}
            disabled={testRunMutation.isPending}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg transition-colors disabled:opacity-50"
          >
            {testRunMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
            Chạy test (1 bài)
          </button>
        </div>
      </div>

      {/* Message */}
      {message.text && (
        <div className={`p-4 rounded-lg flex items-start gap-3 ${
          message.type === 'error'
            ? 'bg-error-50 dark:bg-error-500/15 text-error-500 border border-error-100 dark:border-error-500/25'
            : 'bg-success-50 dark:bg-success-500/15 text-success-500 border border-success-100 dark:border-success-500/25'
        }`}>
          {message.type === 'error' ? <AlertCircle size={20} className="shrink-0 mt-0.5" /> : <CheckCircle size={20} className="shrink-0 mt-0.5" />}
          <p className="text-theme-sm">{message.text}</p>
        </div>
      )}
    </div>
  );
};

// ── Pipeline Log Detail Row ──────────────────────────────

const PipelineLogDetailRow = ({ batchId }: { batchId: string }) => {
  const { data: log, isLoading } = useQuery({
    queryKey: ['knowledge-pipeline-log', batchId],
    queryFn: ({ signal }) => getPipelineLogDetail(batchId, signal),
  });

  if (isLoading) {
    return (
      <tr>
        <td colSpan={6} className="px-4 py-4 text-center">
          <Loader2 className="w-5 h-5 animate-spin text-brand-500 mx-auto" />
        </td>
      </tr>
    );
  }

  if (!log) return null;

  return (
    <tr>
      <td colSpan={6} className="px-4 py-3 bg-gray-50 dark:bg-gray-800/30">
        <div className="space-y-3">
          {/* Steps */}
          <div>
            <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-2 uppercase tracking-wider">Pipeline Steps</p>
            <div className="flex gap-2 flex-wrap">
              {log.steps.map((step) => (
                <div
                  key={step.step}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border ${
                    step.status === 'done'
                      ? 'bg-emerald-50 dark:bg-emerald-500/10 border-emerald-200 dark:border-emerald-500/25 text-emerald-600 dark:text-emerald-400'
                      : step.status === 'error'
                        ? 'bg-red-50 dark:bg-red-500/10 border-red-200 dark:border-red-500/25 text-red-600 dark:text-red-400'
                        : step.status === 'running'
                          ? 'bg-blue-50 dark:bg-blue-500/10 border-blue-200 dark:border-blue-500/25 text-blue-600 dark:text-blue-400'
                          : 'bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-400'
                  }`}
                >
                  Step {step.step}: {step.label}
                </div>
              ))}
            </div>
          </div>

          {/* Article Results */}
          {log.articleResults.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-2 uppercase tracking-wider">Kết quả từng bài</p>
              <div className="space-y-1">
                {log.articleResults.map((result, i) => (
                  <div key={i} className="flex items-center justify-between text-sm py-1 border-b border-gray-100 dark:border-gray-700/50 last:border-0">
                    <span className="text-gray-900 dark:text-white truncate max-w-[60%]">{result.title}</span>
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-gray-500 dark:text-gray-400">{formatDuration(result.duration)}</span>
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${RUN_STATUS_CLASSES[result.state] ?? 'bg-gray-100 text-gray-600'}`}>
                        {RUN_STATUS_LABELS[result.state] ?? result.state}
                      </span>
                      {result.wpPostId && (
                        <span className="text-xs text-brand-500">WP#{result.wpPostId}</span>
                      )}
                      {result.error && (
                        <span className="text-xs text-red-500 truncate max-w-[200px]" title={result.error}>{result.error}</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Error Summary */}
          {log.errorSummary && (
            <div className="p-3 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/25 rounded-lg">
              <p className="text-sm text-red-600 dark:text-red-400">{log.errorSummary}</p>
            </div>
          )}

          {/* Duration */}
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Tổng thời gian: {formatDuration(log.totalDuration)}
          </p>
        </div>
      </td>
    </tr>
  );
};

// ── Pipeline Logs Section ────────────────────────────────

const PipelineLogsSection = () => {
  const [page, setPage] = useState(1);
  const limit = 10;
  const [expandedBatchId, setExpandedBatchId] = useState<string | null>(null);

  const { data: logsPage, isLoading } = useQuery<PaginatedResponse<PipelineLog>, Error>({
    queryKey: ['knowledge-pipeline-logs', { page, limit }],
    queryFn: ({ signal }) => getPipelineLogs({ page, limit }, signal),
    placeholderData: (prev) => prev,
  });

  const logs = logsPage?.data ?? [];
  const meta: PaginationMeta = logsPage?.meta ?? { total: 0, page, limit, totalPages: 0 };

  const toggleExpand = (batchId: string) => {
    setExpandedBatchId(expandedBatchId === batchId ? null : batchId);
  };

  return (
    <div className="space-y-4">
      <h3 className="text-title-sm font-semibold text-gray-800 dark:text-white/90 flex items-center gap-2">
        <FileText size={20} className="text-brand-500" />
        Pipeline Logs
      </h3>

      <div className="bg-white dark:bg-white/[0.03] border border-gray-200 dark:border-white/[0.05] rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-200 dark:border-white/[0.05]">
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Batch ID</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Ngày</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Danh mục</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Trạng thái</th>
                <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Tổng</th>
                <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Thành công</th>
                <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Lỗi</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Thời gian</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-white/[0.05]">
              {isLoading ? (
                <TableSkeletonRows cols={8} rows={5} />
              ) : logs.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-gray-500 dark:text-gray-400">
                    Chưa có pipeline log nào.
                  </td>
                </tr>
              ) : (
                logs.map((log) => (
                  <Fragment key={log._id}>
                    <tr
                      key={log._id}
                      className="hover:bg-gray-50 dark:hover:bg-white/[0.02] transition-colors cursor-pointer"
                      onClick={() => toggleExpand(log.batchId)}
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          {expandedBatchId === log.batchId ? <ChevronUp size={14} className="text-gray-400" /> : <ChevronDown size={14} className="text-gray-400" />}
                          <span className="text-sm font-mono text-gray-700 dark:text-gray-300 truncate max-w-[180px]">{log.batchId}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">
                        {new Date(log.createdAt).toLocaleDateString('vi-VN')}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">
                        {log.categorySlug}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${RUN_STATUS_CLASSES[log.status] ?? ''}`}>
                          {RUN_STATUS_LABELS[log.status] ?? log.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-center text-gray-900 dark:text-white font-medium">{log.totalArticles}</td>
                      <td className="px-4 py-3 text-sm text-center text-emerald-600 dark:text-emerald-400 font-medium">{log.publishedCount}</td>
                      <td className="px-4 py-3 text-sm text-center text-red-600 dark:text-red-400 font-medium">{log.failedCount}</td>
                      <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400 text-right">{formatDuration(log.totalDuration)}</td>
                    </tr>
                    {expandedBatchId === log.batchId && (
                      <PipelineLogDetailRow key={`detail-${log.batchId}`} batchId={log.batchId} />
                    )}
                  </Fragment>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Pagination
        meta={meta}
        onPageChange={setPage}
        isDisabled={isLoading}
        itemLabel="lượt chạy"
      />
    </div>
  );
};

// ── Main Screen ──────────────────────────────────────────

export default function KnowledgeCronScreen() {
  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col gap-2">
        <h2 className="text-title-sm font-semibold text-gray-800 dark:text-white/90 flex items-center gap-3">
          <Clock className="text-brand-500" size={32} />
          Knowledge Cron & Pipeline Logs
        </h2>
        <p className="text-theme-sm text-gray-500 dark:text-gray-400">
          Cấu hình lịch trình tự động và xem nhật ký chạy pipeline.
        </p>
      </div>

      <NlCronSection />
      <PipelineLogsSection />
    </div>
  );
}
