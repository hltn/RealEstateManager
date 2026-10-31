import { ExternalLink, ShieldCheck, UserPlus, UserX } from 'lucide-react';
import type { PhoneLookupResult } from '@crm/api';
import { useCrmActions } from '@crm/store';

interface DuplicatePhoneBannerProps {
  lookup: PhoneLookupResult | null;
  onRequestJoin: () => void;
  variant: 'desktop' | 'mobile';
}

/**
 * Banner kiểm trùng SĐT (X2, 02 §5): chỉ báo "Đã có khách hàng với số điện thoại này, do [tên] chăm sóc".
 * Khách ngoài phạm vi xem: KHÔNG hiện tên/mã/SĐT, chỉ có "Đề nghị tham gia nhóm chăm sóc".
 * Khách đã trong phạm vi xem của người dùng: hiện "Xem hồ sơ" (không lộ thêm gì).
 */
export const DuplicatePhoneBanner = ({ lookup, onRequestJoin, variant }: DuplicatePhoneBannerProps) => {
  const { selectCustomer } = useCrmActions();
  if (!lookup?.exists) {
    return (
      <div className="flex items-start gap-3 rounded-lg border border-brand-100 bg-brand-50 p-4 text-brand-600 dark:border-brand-500/25 dark:bg-brand-500/15 dark:text-brand-400">
        <ShieldCheck size={20} aria-hidden="true" className="mt-0.5 shrink-0" />
        <div className="min-w-0">
          <p className="text-sm font-semibold">Kiểm tra trùng số điện thoại</p>
          <p className="mt-0.5 text-theme-sm text-gray-600 dark:text-gray-300">Khi nhập SĐT, hệ thống tự kiểm tra để tránh tạo trùng khách đã có.</p>
        </div>
      </div>
    );
  }

  const ownerText = lookup.caredByName ? `, do ${lookup.caredByName} chăm sóc` : '';
  return (
    <div
      role="alert"
      className={`flex gap-3 rounded-lg border border-error-100 bg-error-50 p-4 text-error-600 dark:border-error-500/25 dark:bg-error-500/15 dark:text-error-400 ${
        variant === 'mobile' ? 'flex-col' : 'flex-col sm:flex-row sm:items-center'
      }`}
    >
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <UserX size={20} aria-hidden="true" className="mt-0.5 shrink-0" />
        <p className="text-sm font-semibold">Đã có khách hàng với số điện thoại này{ownerText}.</p>
      </div>
      {lookup.isAccessible && lookup.customerId ? (
        <button
          type="button"
          onClick={() => selectCustomer(lookup.customerId as string)}
          className="inline-flex shrink-0 items-center gap-1.5 self-start rounded-lg border border-error-200 bg-white px-3 py-1.5 text-sm font-medium text-error-600 transition-colors hover:bg-error-50 dark:border-error-500/30 dark:bg-transparent dark:text-error-400 dark:hover:bg-error-500/10"
        >
          <ExternalLink size={16} aria-hidden="true" />
          Xem hồ sơ
        </button>
      ) : lookup.hasPendingRequest ? (
        <span className="shrink-0 self-start text-theme-xs font-medium text-gray-600 dark:text-gray-300">Đã gửi đề nghị, đang chờ duyệt</span>
      ) : (
        lookup.canRequestJoin && (
          <button
            type="button"
            onClick={onRequestJoin}
            className="inline-flex shrink-0 items-center gap-1.5 self-start rounded-lg border border-error-200 bg-white px-3 py-1.5 text-sm font-medium text-error-600 transition-colors hover:bg-error-50 dark:border-error-500/30 dark:bg-transparent dark:text-error-400 dark:hover:bg-error-500/10"
          >
            <UserPlus size={16} aria-hidden="true" />
            Đề nghị tham gia nhóm chăm sóc
          </button>
        )
      )}
    </div>
  );
};
