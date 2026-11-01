/**
 * Ô chọn khách (desktop) — thẻ khách đang chọn + nút "Thay đổi khách" mở `Dropdown` của Admin
 * (nguồn Stitch: popup tự viết). Có ô tìm theo tên/SĐT vì danh sách khách có thể dài.
 * Khóa (`isLocked`, mở từ chi tiết khách): chỉ hiện thẻ khách + nhãn "Khách đang xem", không có nút đổi khách.
 * Thẻ khóa dùng chung cho desktop và mobile (mobile không dùng `<select>` khi khóa).
 */
import { Lock, Search } from 'lucide-react';
import { useState } from 'react';
import { Dropdown } from '../../../../../components/ui/dropdown/Dropdown';
import { getInitials } from '@crm/lib/staff';
import type { CustomerDetail, CustomerListItem } from '@crm/api';
import { CustomerStatusChip } from '@crm/components/CustomerStatusChip';
import { getHintId, getLabelId } from '@crm/components/form/FormField';
import { formatProjectSummary } from '@crm/lib/customerAdapters';

interface CustomerPickerProps {
  id: string;
  customers: CustomerListItem[];
  /** Tổng số khách khớp từ khoá (có thể nhiều hơn số đang hiển thị). */
  total: number;
  onSearch: (keyword: string) => void;
  selectedCustomer: CustomerDetail | null;
  /** Đang tải thông tin khách chọn sẵn. */
  isLoading?: boolean;
  /** Khóa chọn khách (đang đặt lịch cho đúng khách mở từ chi tiết khách). */
  isLocked?: boolean;
  hasError: boolean;
  onChange: (customerId: string) => void;
}

export const CustomerPicker = ({ id, customers, total, onSearch, selectedCustomer, isLoading = false, isLocked = false, hasError, onChange }: CustomerPickerProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const [keyword, setKeyword] = useState('');

  const closePicker = () => {
    setIsOpen(false);
    setKeyword('');
    onSearch('');
  };

  return (
    <div
      // Khóa: thẻ chỉ-đọc, nhãn "Khách hàng" + dòng giải thích gắn qua aria (không có phần tử nhập để `<label for>` trỏ vào).
      {...(isLocked ? { role: 'group', 'aria-labelledby': getLabelId(id), 'aria-describedby': getHintId(id) } : {})}
      className={`flex flex-col justify-between gap-3 rounded-xl border p-3.5 sm:flex-row sm:items-center ${
        hasError
          ? 'border-error-500 dark:border-error-500'
          : 'border-brand-200 bg-brand-25 dark:border-brand-500/30 dark:bg-brand-500/[0.06]'
      }`}
    >
      {selectedCustomer ? (
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand-500 text-sm font-semibold text-white">
            {getInitials(selectedCustomer.fullName)}
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="text-sm font-semibold text-gray-800 dark:text-white/90">{selectedCustomer.fullName}</span>
              <span className="text-theme-xs text-gray-500 dark:text-gray-400">— {selectedCustomer.phoneMasked}</span>
              <CustomerStatusChip status={selectedCustomer.status} size="small" />
            </div>
            <p className="mt-0.5 truncate text-theme-xs text-gray-500 dark:text-gray-400">
              Dự án: {formatProjectSummary(selectedCustomer.projects) || 'Chưa chọn dự án'}
            </p>
          </div>
        </div>
      ) : (
        <p role={isLoading ? 'status' : undefined} className="text-theme-sm text-gray-500 dark:text-gray-400">{isLoading ? 'Đang tải thông tin khách…' : 'Chưa chọn khách hàng.'}</p>
      )}

      {isLocked ? (
        <span className="inline-flex shrink-0 items-center gap-1.5 text-theme-xs font-medium text-gray-500 dark:text-gray-400">
          <Lock size={14} aria-hidden="true" />
          Khách đang xem
        </span>
      ) : (
        <div className="relative shrink-0">
          <button
            id={id}
            type="button"
            aria-haspopup="listbox"
            aria-expanded={isOpen}
            // Tên truy cập khớp chữ hiển thị (nhãn "Khách hàng" trỏ vào nút sẽ làm tên nút lệch chữ).
            aria-label={selectedCustomer ? 'Thay đổi khách' : 'Chọn khách'}
            onClick={() => (isOpen ? closePicker() : setIsOpen(true))}
            className="dropdown-toggle inline-flex h-9 items-center rounded-lg border border-brand-200 bg-white px-3 text-xs font-semibold text-brand-600 transition-colors hover:bg-brand-50 dark:border-brand-500/30 dark:bg-gray-900 dark:text-brand-400 dark:hover:bg-brand-500/10"
          >
            {selectedCustomer ? 'Thay đổi khách' : 'Chọn khách'}
          </button>
          <Dropdown isOpen={isOpen} onClose={closePicker} className="w-72 p-2">
            <div className="relative mb-2">
              <Search size={16} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="search"
                value={keyword}
                autoFocus
                onChange={(event) => {
                  setKeyword(event.target.value);
                  onSearch(event.target.value);
                }}
                placeholder="Tìm tên hoặc SĐT..."
                aria-label="Tìm khách hàng"
                className="w-full rounded-lg border border-gray-200 bg-white py-2 pl-9 pr-3 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-brand-500 dark:border-white/[0.1] dark:bg-gray-900 dark:text-white/90"
              />
            </div>
            <ul role="listbox" aria-label="Danh sách khách hàng" className="max-h-60 space-y-0.5 overflow-y-auto">
              {customers.length === 0 && (
                <li className="px-2 py-3 text-center text-theme-xs text-gray-500 dark:text-gray-400">Không tìm thấy khách phù hợp.</li>
              )}
              {customers.map((customer) => {
                const isSelected = customer.id === selectedCustomer?.id;
                return (
                  <li key={customer.id} role="option" aria-selected={isSelected}>
                    <button
                      type="button"
                      onClick={() => {
                        onChange(customer.id);
                        closePicker();
                      }}
                      className={`w-full rounded-lg px-2.5 py-2 text-left transition-colors ${
                        isSelected ? 'bg-brand-50 dark:bg-brand-500/15' : 'hover:bg-gray-100 dark:hover:bg-white/5'
                      }`}
                    >
                      <span className="block text-sm font-medium text-gray-800 dark:text-white/90">{customer.fullName}</span>
                      <span className="block text-theme-xs text-gray-500 dark:text-gray-400">
                        {customer.phoneMasked} • {customer.status.label}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
            {total > customers.length && (
              <p className="px-2 pt-2 text-center text-theme-xs text-gray-500 dark:text-gray-400">Còn {total - customers.length} khách nữa — gõ tên hoặc SĐT để thu hẹp.</p>
            )}
          </Dropdown>
        </div>
      )}
    </div>
  );
};
