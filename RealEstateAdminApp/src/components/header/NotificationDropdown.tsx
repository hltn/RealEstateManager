import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { CRM_FEATURE_FLAGS } from "@crm/config/featureFlags";
import { useNotificationActions, useNotifications, useUnreadNotificationCount, type NotificationItem } from "@crm/api";
import { formatVnRelative } from "@crm/lib/dateTime";
import { getNotificationTypeLabel, resolveNotificationPath } from "@crm/lib/notifications";
import { Dropdown } from "../ui/dropdown/Dropdown";
import { DropdownItem } from "../ui/dropdown/DropdownItem";
import { useAuth } from "../../hooks/useAuth";
import { UserRole } from "../../types/user";

const PREVIEW_LIMIT = 8;

/** Vai trò có hộp thông báo (EDITOR không có quyền CRM: backend trả 403). */
const hasInbox = (role: string | undefined): boolean => role === UserRole.ADMIN || role === UserRole.MANAGER || role === UserRole.STAFF;

/**
 * Chuông thông báo trên header: số chưa đọc (làm mới mỗi phút), xem nhanh 8 thông báo mới nhất, đánh dấu đã đọc,
 * mở màn liên quan, "Xem tất cả" -> `/notifications`. Chỉ hiện khi module CRM bật và người dùng có quyền.
 */
export default function NotificationDropdown() {
  const { user } = useAuth();
  const isEnabled = CRM_FEATURE_FLAGS.isPrototypeEnabled && hasInbox(user?.role);
  const [isOpen, setIsOpen] = useState(false);
  const unreadCount = useUnreadNotificationCount(isEnabled);
  const { data, isLoading, error } = useNotifications({ limit: PREVIEW_LIMIT }, isEnabled && isOpen);
  const actions = useNotificationActions();
  const navigate = useNavigate();

  if (!isEnabled) return null;

  const closeDropdown = () => setIsOpen(false);

  const openItem = async (item: NotificationItem) => {
    closeDropdown();
    if (!item.isRead) await actions.markRead(item.id, true);
    const path = resolveNotificationPath(item);
    if (path) navigate(path);
  };

  return (
    <div className="relative">
      <button
        type="button"
        aria-label={unreadCount > 0 ? `Thông báo, ${unreadCount} chưa đọc` : "Thông báo"}
        className="relative flex items-center justify-center text-gray-500 transition-colors bg-white border border-gray-200 rounded-full dropdown-toggle hover:text-gray-700 h-11 w-11 hover:bg-gray-100 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white"
        onClick={() => setIsOpen((current) => !current)}
      >
        {unreadCount > 0 && (
          <span className="absolute -right-1 -top-1 z-10 flex h-5 min-w-5 items-center justify-center rounded-full bg-orange-500 px-1 text-[11px] font-semibold leading-none text-white">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
        <svg className="fill-current" width="20" height="20" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <path
            fillRule="evenodd"
            clipRule="evenodd"
            d="M10.75 2.29248C10.75 1.87827 10.4143 1.54248 10 1.54248C9.58583 1.54248 9.25004 1.87827 9.25004 2.29248V2.83613C6.08266 3.20733 3.62504 5.9004 3.62504 9.16748V14.4591H3.33337C2.91916 14.4591 2.58337 14.7949 2.58337 15.2091C2.58337 15.6234 2.91916 15.9591 3.33337 15.9591H4.37504H15.625H16.6667C17.0809 15.9591 17.4167 15.6234 17.4167 15.2091C17.4167 14.7949 17.0809 14.4591 16.6667 14.4591H16.375V9.16748C16.375 5.9004 13.9174 3.20733 10.75 2.83613V2.29248ZM14.875 14.4591V9.16748C14.875 6.47509 12.6924 4.29248 10 4.29248C7.30765 4.29248 5.12504 6.47509 5.12504 9.16748V14.4591H14.875ZM8.00004 17.7085C8.00004 18.1228 8.33583 18.4585 8.75004 18.4585H11.25C11.6643 18.4585 12 18.1228 12 17.7085C12 17.2943 11.6643 16.9585 11.25 16.9585H8.75004C8.33583 16.9585 8.00004 17.2943 8.00004 17.7085Z"
            fill="currentColor"
          />
        </svg>
      </button>
      <Dropdown
        isOpen={isOpen}
        onClose={closeDropdown}
        className="absolute -right-[240px] mt-[17px] flex max-h-[480px] w-[350px] flex-col rounded-2xl border border-gray-200 bg-white p-3 shadow-theme-lg dark:border-gray-800 dark:bg-gray-dark sm:w-[361px] lg:right-0"
      >
        <div className="flex items-center justify-between pb-3 mb-3 border-b border-gray-100 dark:border-gray-700">
          <h5 className="text-lg font-semibold text-gray-800 dark:text-gray-200">Thông báo</h5>
          <button
            type="button"
            onClick={closeDropdown}
            aria-label="Đóng"
            className="text-gray-500 transition dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
          >
            ✕
          </button>
        </div>
        <ul className="flex flex-col h-auto overflow-y-auto custom-scrollbar" aria-live="polite">
          {isLoading && <li className="p-4 text-theme-sm text-gray-500">Đang tải…</li>}
          {error && !isLoading && <li className="p-4 text-theme-sm text-error-600">{error.message}</li>}
          {!isLoading && !error && data.data.length === 0 && <li className="p-6 text-center text-theme-sm text-gray-500 dark:text-gray-400">Chưa có thông báo nào.</li>}
          {data.data.map((item) => (
            <li key={item.id}>
              <DropdownItem
                onItemClick={() => void openItem(item)}
                className={`flex gap-3 rounded-lg border-b border-gray-100 px-4 py-3 hover:bg-gray-100 dark:border-gray-800 dark:hover:bg-white/5 ${item.isRead ? "" : "bg-brand-25 dark:bg-brand-500/[0.06]"}`}
              >
                <span aria-hidden="true" className={`mt-2 h-2 w-2 shrink-0 rounded-full ${item.isRead ? "bg-transparent" : "bg-brand-500"}`} />
                <span className="block min-w-0">
                  <span className={`mb-1 block text-theme-sm text-gray-800 dark:text-white/90 ${item.isRead ? "" : "font-semibold"}`}>{item.title}</span>
                  <span className="mb-1 block text-theme-xs text-gray-500 dark:text-gray-400">{item.body}</span>
                  <span className="flex items-center gap-2 text-gray-500 text-theme-xs dark:text-gray-400">
                    <span>{getNotificationTypeLabel(item.type)}</span>
                    <span className="w-1 h-1 bg-gray-400 rounded-full"></span>
                    <span>{formatVnRelative(item.createdAt)}</span>
                  </span>
                </span>
              </DropdownItem>
            </li>
          ))}
        </ul>
        <Link
          to="/notifications"
          onClick={closeDropdown}
          className="flex justify-center p-3 mt-3 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700"
        >
          Xem tất cả thông báo
        </Link>
      </Dropdown>
    </div>
  );
}
