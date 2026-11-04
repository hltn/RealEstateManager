import { ShieldAlert, WifiOff } from 'lucide-react';
import type { ApiError } from '@crm/api';
import { BUTTON_OUTLINE_LG_CLASS, CARD_CLASS } from '@crm/lib/uiClasses';

interface CrmUnavailableProps {
  error: ApiError | null;
  /** Có hàm thử lại thì hiện nút "Thử lại" (lỗi mạng/503); lỗi quyền (403) không thử lại được. */
  onRetry?: () => void;
}

/** Trạng thái lỗi toàn module (không tải được danh mục, không có quyền, hệ thống bảo trì...). */
export const CrmUnavailable = ({ error, onRetry }: CrmUnavailableProps) => {
  const isForbidden = error?.statusCode === 403;
  const Icon = isForbidden ? ShieldAlert : WifiOff;
  return (
    <div role="alert" className={`${CARD_CLASS} mx-auto flex max-w-lg flex-col items-center px-6 py-12 text-center`}>
      <span className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gray-100 text-gray-400 dark:bg-gray-800 dark:text-gray-500">
        <Icon size={32} aria-hidden="true" />
      </span>
      <p className="text-base font-medium text-gray-700 dark:text-gray-300">{isForbidden ? 'Bạn không có quyền truy cập' : 'Không tải được dữ liệu'}</p>
      <p className="mt-1 max-w-sm text-theme-sm text-gray-500 dark:text-gray-400">{error?.message ?? 'Vui lòng thử lại sau.'}</p>
      {onRetry && !isForbidden && (
        <button type="button" onClick={onRetry} className={`${BUTTON_OUTLINE_LG_CLASS} mt-6`}>
          Thử lại
        </button>
      )}
    </div>
  );
};
