import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Bell } from 'lucide-react';
import { useInfiniteNotifications, useNotificationActions, type NotificationItem } from '@crm/api';
import { useLoadMoreOnVisible } from '@crm/hooks/useLoadMoreOnVisible';
import { formatVnDateTime, formatVnRelative } from '@crm/lib/dateTime';
import { getNotificationTypeLabel, resolveNotificationPath } from '@crm/lib/notifications';

type NotificationTab = 'all' | 'unread';

const TABS: { value: NotificationTab; label: string }[] = [
  { value: 'all', label: 'Tất cả' },
  { value: 'unread', label: 'Chưa đọc' },
];

const SKELETON_ROWS = 4;

interface NotificationDropdownPanelProps {
  onClose: () => void;
}

/**
 * Nội dung dropdown thông báo kiểu Facebook cho desktop (T-57, FR-38): tab Tất cả/Chưa đọc, chấm xanh ở mục chưa đọc,
 * thời gian tương đối, cuộn tới cuối tải thêm 20 (hook `useInfiniteNotifications` của T-56), "Xem tất cả thông báo".
 * Chỉ được mount khi dropdown mở nên danh sách chỉ tải lúc mở và tab luôn về "Tất cả" mỗi lần mở lại.
 */
export const NotificationDropdownPanel = ({ onClose }: NotificationDropdownPanelProps) => {
  const [tab, setTab] = useState<NotificationTab>('all');
  const { data: items, isLoading, isFetchingMore, hasMore, error, isLoadMoreError, refetch, loadMore } = useInfiniteNotifications({ isRead: tab === 'unread' ? false : undefined });
  // Trang kế lỗi thì dừng tự tải (tránh vòng lặp), người dùng bấm "Thử lại".
  const sentinelRef = useLoadMoreOnVisible(loadMore, hasMore && !isLoadMoreError);
  const actions = useNotificationActions();
  const navigate = useNavigate();

  const openItem = async (item: NotificationItem) => {
    onClose();
    if (!item.isRead) await actions.markRead(item.id, true);
    const path = resolveNotificationPath(item);
    if (path) navigate(path);
  };

  const hasInitialError = Boolean(error) && !isLoading && items.length === 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="px-4 pb-2 pt-4">
        <h5 className="text-xl font-bold text-gray-800 dark:text-white/90">Thông báo</h5>
        <div role="tablist" aria-label="Lọc thông báo" className="mt-3 flex gap-2">
          {TABS.map(({ value, label }) => {
            const isActive = tab === value;
            return (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => setTab(value)}
                className={`rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
                  isActive ? 'bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-400' : 'text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-white/5'
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      <div data-testid="notification-dropdown-list" className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-2 custom-scrollbar" aria-live="polite">
        {isLoading ? (
          <div aria-busy="true" aria-label="Đang tải thông báo" className="space-y-2 p-2">
            {Array.from({ length: SKELETON_ROWS }).map((_, index) => (
              <div key={index} className="h-16 animate-pulse rounded-xl bg-gray-100 dark:bg-gray-800" />
            ))}
          </div>
        ) : hasInitialError ? (
          <div className="flex flex-col items-center gap-3 px-4 py-8 text-center text-theme-sm text-gray-500 dark:text-gray-400">
            <span>{error?.message}</span>
            <button type="button" onClick={refetch} className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/5">
              Thử lại
            </button>
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center px-4 py-10 text-center">
            <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-gray-100 text-gray-400 dark:bg-gray-800">
              <Bell size={24} aria-hidden="true" />
            </span>
            <p className="text-theme-sm font-medium text-gray-700 dark:text-gray-300">{tab === 'unread' ? 'Không có thông báo chưa đọc' : 'Chưa có thông báo nào'}</p>
          </div>
        ) : (
          <ul className="flex flex-col">
            {items.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => void openItem(item)}
                  className="flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-gray-100 dark:hover:bg-white/5"
                >
                  <span className="min-w-0 flex-1">
                    <span className={`block text-theme-sm text-gray-800 dark:text-white/90 ${item.isRead ? '' : 'font-semibold'}`}>{item.title}</span>
                    <span className="mt-0.5 block text-theme-xs text-gray-600 dark:text-gray-400">{item.body}</span>
                    <span className="mt-1 flex items-center gap-2 text-theme-xs text-gray-500 dark:text-gray-400">
                      <span>{getNotificationTypeLabel(item.type)}</span>
                      <span aria-hidden="true" className="h-1 w-1 rounded-full bg-gray-400" />
                      <time dateTime={item.createdAt} title={formatVnDateTime(item.createdAt)} className={item.isRead ? '' : 'font-medium text-brand-600 dark:text-brand-400'}>
                        {formatVnRelative(item.createdAt)}
                      </time>
                    </span>
                  </span>
                  {!item.isRead && <span data-testid="notification-unread-dot" aria-label="Chưa đọc" role="img" className="mt-2 h-3 w-3 shrink-0 rounded-full bg-brand-500" />}
                </button>
              </li>
            ))}
          </ul>
        )}
        {items.length > 0 && (
          <div className="py-2 text-center text-theme-xs text-gray-500 dark:text-gray-400">
            {isLoadMoreError ? (
              <span className="inline-flex items-center gap-2">
                Không tải thêm được thông báo.
                <button type="button" onClick={loadMore} className="rounded-lg border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/5">
                  Thử lại
                </button>
              </span>
            ) : isFetchingMore ? (
              <span aria-busy="true">Đang tải thêm…</span>
            ) : hasMore ? (
              <span ref={sentinelRef} data-testid="notification-dropdown-sentinel" className="block h-4" aria-hidden="true" />
            ) : (
              <span>Đã hết thông báo</span>
            )}
          </div>
        )}
      </div>

      <div className="border-t border-gray-100 p-2 dark:border-gray-800">
        <Link to="/notifications" onClick={onClose} className="flex justify-center rounded-lg px-3 py-2.5 text-sm font-medium text-brand-600 hover:bg-gray-100 dark:text-brand-400 dark:hover:bg-white/5">
          Xem tất cả thông báo
        </Link>
      </div>
    </div>
  );
};
