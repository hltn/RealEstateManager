import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, CheckCheck } from 'lucide-react';
import { useInfiniteNotifications, useNotificationActions, type NotificationItem } from '@crm/api';
import { CrmUnavailable } from '@crm/components/CrmUnavailable';
import { useLoadMoreOnVisible } from '@crm/hooks/useLoadMoreOnVisible';
import { formatVnDateTime, formatVnRelative } from '@crm/lib/dateTime';
import { getNotificationTypeLabel, resolveNotificationPath } from '@crm/lib/notifications';
import { BUTTON_OUTLINE_CLASS, CARD_CLASS, CHIP_SMALL_CLASS, CHIP_TONE_CLASS, PAGE_DESCRIPTION_CLASS, PAGE_TITLE_CLASS, TAB_ACTIVE_CLASS, TAB_BASE_CLASS, TAB_INACTIVE_CLASS } from '@crm/lib/uiClasses';
import { toast } from './toast';

type Filter = 'all' | 'unread';

/**
 * Trang "Thông báo" (`/notifications`): hộp thông báo trong app của CHÍNH người dùng (05 §2.10), mới nhất trước, lọc chưa đọc,
 * đánh dấu đã đọc từng cái/tất cả, bấm để mở màn liên quan. Hiện 20 mục đầu, cuộn tới cuối tải thêm 20 (FR-38).
 * Nằm ngoài `/crm` (không có CrmProvider) nên dùng toast trực tiếp.
 */
export const NotificationsScreen = () => {
  const [filter, setFilter] = useState<Filter>('all');
  const { data: items, isLoading, isFetchingMore, hasMore, error, isLoadMoreError, refetch, loadMore } = useInfiniteNotifications({ isRead: filter === 'unread' ? false : undefined });
  // Trang kế lỗi thì dừng tự tải (tránh vòng lặp), người dùng bấm "Thử lại".
  const sentinelRef = useLoadMoreOnVisible(loadMore, hasMore && !isLoadMoreError);
  const actions = useNotificationActions();
  const navigate = useNavigate();
  const [isBusy, setIsBusy] = useState(false);

  const open = async (item: NotificationItem) => {
    if (!item.isRead) {
      const result = await actions.markRead(item.id, true);
      if (!result.ok) toast.error(result.error.message);
    }
    const path = resolveNotificationPath(item);
    if (path) navigate(path);
  };

  const markAll = async () => {
    if (isBusy) return;
    setIsBusy(true);
    const result = await actions.markAllRead();
    setIsBusy(false);
    if (result.ok) toast.success(`Đã đánh dấu đã đọc ${result.data.updated} thông báo`);
    else toast.error(result.error.message);
  };

  // Lỗi tải trang đầu (chưa có mục nào): màn lỗi toàn trang. Lỗi trang kế hoặc làm mới nền giữ nguyên danh sách đã tải.
  if (error && !isLoading && items.length === 0) return <CrmUnavailable error={error} onRetry={refetch} />;

  return (
    <div className="flex w-full flex-col gap-6">
      <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="flex flex-col gap-2">
          <h2 className={PAGE_TITLE_CLASS}>Thông báo</h2>
          <p className={`${PAGE_DESCRIPTION_CLASS} max-w-2xl`}>Nhắc việc, lịch hẹn, phân khách và các cảnh báo gửi cho bạn.</p>
        </div>
        <button type="button" onClick={() => void markAll()} disabled={isBusy} className={BUTTON_OUTLINE_CLASS}>
          <CheckCheck size={18} aria-hidden="true" />
          Đánh dấu đã đọc tất cả
        </button>
      </header>

      <div role="tablist" aria-label="Lọc thông báo" className="flex gap-5 border-b border-gray-200 dark:border-white/[0.05]">
        {(['all', 'unread'] as Filter[]).map((value) => {
          const isActive = filter === value;
          return (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => setFilter(value)}
              className={`${TAB_BASE_CLASS} ${isActive ? TAB_ACTIVE_CLASS : TAB_INACTIVE_CLASS}`}
            >
              {value === 'all' ? 'Tất cả' : 'Chưa đọc'}
            </button>
          );
        })}
      </div>

      <div className="flex flex-col gap-2">
        {isLoading ? (
          <div aria-busy="true" aria-label="Đang tải thông báo" className="space-y-2">
            {Array.from({ length: 5 }).map((_, index) => (
              <div key={index} className="h-20 animate-pulse rounded-2xl bg-gray-100 dark:bg-gray-800" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className={`${CARD_CLASS} flex flex-col items-center px-6 py-12 text-center`}>
            <span className="mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-gray-100 text-gray-400 dark:bg-gray-800">
              <Bell size={28} aria-hidden="true" />
            </span>
            <p className="text-base font-medium text-gray-700 dark:text-gray-300">{filter === 'unread' ? 'Không có thông báo chưa đọc' : 'Chưa có thông báo nào'}</p>
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {items.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => void open(item)}
                  className={`${CARD_CLASS} flex w-full items-start gap-3 p-4 text-left transition-colors hover:bg-gray-50 dark:hover:bg-white/[0.04] ${item.isRead ? '' : 'border-brand-200 bg-brand-25 dark:border-brand-500/30 dark:bg-brand-500/[0.06]'}`}
                >
                  <span aria-hidden="true" className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${item.isRead ? 'bg-transparent' : 'bg-brand-500'}`} />
                  <span className="min-w-0 flex-1 space-y-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className={`${CHIP_SMALL_CLASS} ${item.type === 'SECURITY_ALERT' ? CHIP_TONE_CLASS.error : CHIP_TONE_CLASS.gray}`}>{getNotificationTypeLabel(item.type)}</span>
                      <time dateTime={item.createdAt} title={formatVnDateTime(item.createdAt)} className="text-theme-xs text-gray-500 dark:text-gray-400">
                        {formatVnRelative(item.createdAt)}
                      </time>
                    </span>
                    <span className={`block text-theme-sm text-gray-800 dark:text-white/90 ${item.isRead ? '' : 'font-semibold'}`}>{item.title}</span>
                    <span className="block text-theme-sm text-gray-600 dark:text-gray-400">{item.body}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {items.length > 0 && (
          <div className="py-2 text-center text-theme-sm text-gray-500 dark:text-gray-400" aria-live="polite">
            {isLoadMoreError ? (
              <span className="inline-flex items-center gap-3">
                Không tải thêm được thông báo.
                <button type="button" onClick={loadMore} className={BUTTON_OUTLINE_CLASS}>
                  Thử lại
                </button>
              </span>
            ) : isFetchingMore ? (
              <span aria-busy="true">Đang tải thêm…</span>
            ) : hasMore ? (
              <span ref={sentinelRef} data-testid="notifications-sentinel" className="block h-4" aria-hidden="true" />
            ) : (
              <span>Đã hết thông báo</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default NotificationsScreen;
