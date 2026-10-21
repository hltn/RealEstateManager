import { ShieldCheck, UserX } from 'lucide-react';
import type { Customer } from '@crm/types/crm';
import { getDuplicateOwnerText } from '../customerFormRules';

interface DuplicatePhoneBannerProps {
  duplicateCustomer: Customer | null;
  onOpenDuplicate: () => void;
  variant: 'desktop' | 'mobile';
}

/**
 * Banner đối soát trùng SĐT (tài liệu 02: "Đã có khách này, do [tên] chăm sóc").
 * Dùng mẫu "Thông báo trong trang" của Admin (`ExternalLogsScreen.tsx:194-199`): error khi trùng, brand khi chưa trùng.
 */
export const DuplicatePhoneBanner = ({ duplicateCustomer, onOpenDuplicate, variant }: DuplicatePhoneBannerProps) => {
  if (!duplicateCustomer) {
    return (
      <div className="flex items-start gap-3 rounded-lg border border-brand-100 bg-brand-50 p-4 text-brand-600 dark:border-brand-500/25 dark:bg-brand-500/15 dark:text-brand-400">
        <ShieldCheck size={20} aria-hidden="true" className="mt-0.5 shrink-0" />
        <div className="min-w-0">
          <p className="text-sm font-semibold">Kiểm tra trùng số điện thoại</p>
          <p className="mt-0.5 text-theme-sm text-gray-600 dark:text-gray-300">
            Khi nhập SĐT, hệ thống tự đối soát để tránh trùng khách giữa các chuyên viên và bảo vệ quyền lợi hoa hồng.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      role="alert"
      className={`flex gap-3 rounded-lg border border-error-100 bg-error-50 p-4 text-error-600 dark:border-error-500/25 dark:bg-error-500/15 dark:text-error-400 ${
        variant === 'mobile' ? 'flex-col' : 'flex-col sm:flex-row sm:items-start'
      }`}
    >
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <UserX size={20} aria-hidden="true" className="mt-0.5 shrink-0" />
        <div className="min-w-0">
          <p className="text-sm font-semibold">{getDuplicateOwnerText(duplicateCustomer)}</p>
          <p className="mt-0.5 text-theme-sm text-gray-700 dark:text-gray-300">
            Khách <strong className="font-semibold">{duplicateCustomer.name}</strong> ({duplicateCustomer.code}) đã có trên
            hệ thống với SĐT {duplicateCustomer.phone}. Liên hệ chuyên viên phụ trách để tránh trùng lặp.
          </p>
        </div>
      </div>
      <button
        type="button"
        onClick={onOpenDuplicate}
        className="shrink-0 self-start rounded-lg border border-error-200 bg-white px-3 py-1.5 text-sm font-medium text-error-600 transition-colors hover:bg-error-50 dark:border-error-500/30 dark:bg-transparent dark:text-error-400 dark:hover:bg-error-500/10"
      >
        Xem hồ sơ
      </button>
    </div>
  );
};
