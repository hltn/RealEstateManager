import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, CheckCheck } from 'lucide-react';
import { Pagination } from '../../../../components/common/Pagination';
import { useNotificationActions, useNotifications, type NotificationItem } from '@crm/api';
import { CrmUnavailable } from '@crm/components/CrmUnavailable';
import { formatVnDateTime, formatVnRelative } from '@crm/lib/dateTime';
import { getNotificationTypeLabel, resolveNotificationPath } from '@crm/lib/notifications';
import { BUTTON_OUTLINE_CLASS, CARD_CLASS, CHIP_SMALL_CLASS, CHIP_TONE_CLASS, PAGE_DESCRIPTION_CLASS, PAGE_TITLE_CLASS, TAB_ACTIVE_CLASS, TAB_BASE_CLASS, TAB_INACTIVE_CLASS } from '@crm/lib/uiClasses';
import { toast } from './toast';

const PAGE_SIZE = 20;

type Filter = 'all' | 'unread';

/**
 * Trang "Thông báo" (`/notifications`): hộp thông báo trong app của CHÍNH người dùng (05 §2.10), mới nhất trước, lọc chưa đọc,
 * đánh dấu đã đọc từng cái/tất cả, bấm để mở màn liên quan. Làm mới định kỳ (chưa có push — M7).
 * Nằm ngoài `/crm` (không có CrmProvider) nên dùng toast trực tiếp.
 */
export const NotificationsScreen = () => {
  const [filter, setFilter] = useState<Filter>('all');
  const [page, setPage] = useState(1);
  const { data, isLoading, error, refetch } = useNotifications({ isRead: filter === 'unread' ? false : undefined, page, limit: PAGE_SIZE });
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

  if (error && !isLoading) return <CrmUnavailable error={error} onRetry={refetch} />;

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
              onClick={() => {
                setFilter(value);
                setPage(1);
              }}
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
        ) : data.data.length === 0 ? (
          <div className={`${CARD_CLASS} flex flex-col items-center px-6 py-12 text-center`}>
            <span className="mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-gray-100 text-gray-400 dark:bg-gray-800">
              <Bell size={28} aria-hidden="true" />
            </span>
            <p className="text-base font-medium text-gray-700 dark:text-gray-300">{filter === 'unread' ? 'Không có thông báo chưa đọc' : 'Chưa có thông báo nào'}</p>
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {data.data.map((item) => (
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
        <Pagination meta={data.meta} onPageChange={setPage} itemLabel="thông báo" />
      </div>
    </div>
  );
};

export default NotificationsScreen;
