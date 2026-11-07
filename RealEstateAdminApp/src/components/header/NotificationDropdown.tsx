import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CRM_FEATURE_FLAGS } from "@crm/config/featureFlags";
import { useUnreadNotificationCount } from "@crm/api";
import { useIsMobile } from "@crm/hooks/useIsMobile";
import { useAuth } from "../../hooks/useAuth";
import { hasCrmRole } from "../../utils/userRoles";
import { computeHorizontalShift, computeMaxHeight } from "./notificationDropdownLayout";
import { NotificationDropdownPanel } from "./NotificationDropdownPanel";
import { useDismissibleLayer } from "./useDismissibleLayer";

/**
 * Chuông thông báo trên header: số chưa đọc (làm mới mỗi phút). Chỉ hiện khi module CRM bật và người dùng có quyền.
 * FR-38 (T-57): desktop mở dropdown kiểu Facebook NEO DƯỚI CHUÔNG (căn mép phải theo chuông, không còn `-right-[240px]`,
 * có kẹp ngang để không tràn viewport); mobile (< md) bấm chuông sang màn `/notifications`. Esc/bấm ra ngoài thì đóng.
 */
export default function NotificationDropdown() {
  const { user } = useAuth();
  const isEnabled = CRM_FEATURE_FLAGS.isPrototypeEnabled && hasCrmRole(user) /* EDITOR thuần không có quyền CRM: backend trả 403 */;
  const [isOpen, setIsOpen] = useState(false);
  const unreadCount = useUnreadNotificationCount(isEnabled);
  const navigate = useNavigate();
  // FR-38: mobile (< md) bấm chuông sang màn `/notifications` (danh sách cuộn vô hạn), không mở popup.
  const isMobile = useIsMobile();
  const isPanelVisible = isOpen && !isMobile;

  const containerRef = useRef<HTMLDivElement>(null);
  const bellRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  // Độ dịch ngang (px) để khung nằm trọn trong viewport; 0 khi bố cục đủ chỗ (trường hợp thường gặp).
  const [shiftX, setShiftX] = useState(0);
  // Chiều cao tối đa (px) theo chỗ còn lại dưới chuông: dưới lg chuông nằm ở hàng menu thu gọn nên thấp hơn nhiều so với đỉnh trang.
  const [maxHeightPx, setMaxHeightPx] = useState<number | null>(null);

  const closeDropdown = useCallback(() => setIsOpen(false), []);
  useDismissibleLayer(isPanelVisible, containerRef, closeDropdown, bellRef);

  // Đo khung sau khi vẽ (trước khi trình duyệt hiển thị) và mỗi lần đổi cỡ cửa sổ: kẹp lại nếu tràn mép viewport.
  useLayoutEffect(() => {
    if (!isPanelVisible) return undefined;
    const clampToViewport = () => {
      const rect = panelRef.current?.getBoundingClientRect();
      if (!rect) return;
      setShiftX((current) => computeHorizontalShift({ left: rect.left - current, right: rect.right - current, viewportWidth: document.documentElement.clientWidth }));
      setMaxHeightPx(computeMaxHeight({ top: rect.top, viewportHeight: window.innerHeight }));
    };
    clampToViewport();
    window.addEventListener("resize", clampToViewport);
    return () => {
      window.removeEventListener("resize", clampToViewport);
      setShiftX(0);
      setMaxHeightPx(null);
    };
  }, [isPanelVisible]);

  if (!isEnabled) return null;

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={bellRef}
        type="button"
        data-testid="notification-bell"
        aria-label={unreadCount > 0 ? `Thông báo, ${unreadCount} chưa đọc` : "Thông báo"}
        aria-haspopup={isMobile ? undefined : "dialog"}
        aria-expanded={isMobile ? undefined : isPanelVisible}
        className="relative flex items-center justify-center text-gray-500 transition-colors bg-white border border-gray-200 rounded-full hover:text-gray-700 h-11 w-11 hover:bg-gray-100 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white"
        onClick={() => (isMobile ? navigate("/notifications") : setIsOpen((current) => !current))}
      >
        {unreadCount > 0 && (
          <span data-testid="notification-bell-count" className="absolute -right-1 -top-1 z-10 flex h-5 min-w-5 items-center justify-center rounded-full bg-orange-500 px-1 text-[11px] font-semibold leading-none text-white">
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
      {isPanelVisible && (
        <div
          ref={panelRef}
          role="dialog"
          aria-label="Thông báo"
          data-testid="notification-dropdown"
          style={shiftX === 0 && maxHeightPx === null ? undefined : { transform: shiftX === 0 ? undefined : `translateX(${shiftX}px)`, maxHeight: maxHeightPx ?? undefined }}
          className="absolute right-0 top-full z-40 mt-2 flex max-h-[min(36rem,calc(100dvh-5rem))] w-[360px] max-w-[calc(100vw-1rem)] flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-theme-lg dark:border-gray-800 dark:bg-gray-dark"
        >
          <NotificationDropdownPanel onClose={closeDropdown} />
        </div>
      )}
    </div>
  );
}
