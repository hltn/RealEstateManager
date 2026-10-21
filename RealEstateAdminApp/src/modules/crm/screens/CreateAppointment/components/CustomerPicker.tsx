/**
 * Ô chọn khách (desktop) — thẻ khách đang chọn + nút "Thay đổi khách" mở `Dropdown` của Admin
 * (nguồn Stitch: popup tự viết). Có ô tìm theo tên/SĐT vì danh sách khách có thể dài.
 */
import { Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Dropdown } from '../../../../../components/ui/dropdown/Dropdown';
import { getInitials } from '@crm/lib/staff';
import type { Customer } from '@crm/types/crm';
import { getCustomerStatusToneClass } from '@crm/components/CustomerStatusChip';
import { CHIP_SMALL_CLASS } from '@crm/lib/uiClasses';

interface CustomerPickerProps {
  id: string;
  customers: Customer[];
  selectedCustomer: Customer | null;
  hasError: boolean;
  onChange: (customerId: string) => void;
}

const normalize = (value: string): string => value.trim().toLowerCase();

export const CustomerPicker = ({ id, customers, selectedCustomer, hasError, onChange }: CustomerPickerProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const [keyword, setKeyword] = useState('');

  const matchedCustomers = useMemo(() => {
    const normalizedKeyword = normalize(keyword);
    const keywordDigits = keyword.replace(/\D/g, '');
    if (!normalizedKeyword) return customers;
    return customers.filter(
      (customer) =>
        normalize(customer.name).includes(normalizedKeyword) ||
        (keywordDigits.length > 0 && customer.phone.replace(/\D/g, '').includes(keywordDigits)),
    );
  }, [customers, keyword]);

  const closePicker = () => {
    setIsOpen(false);
    setKeyword('');
  };

  return (
    <div
      className={`flex flex-col justify-between gap-3 rounded-xl border p-3.5 sm:flex-row sm:items-center ${
        hasError
          ? 'border-error-500 dark:border-error-500'
          : 'border-brand-200 bg-brand-25 dark:border-brand-500/30 dark:bg-brand-500/[0.06]'
      }`}
    >
      {selectedCustomer ? (
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand-500 text-sm font-semibold text-white">
            {getInitials(selectedCustomer.name)}
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="text-sm font-semibold text-gray-800 dark:text-white/90">{selectedCustomer.name}</span>
              <span className="text-theme-xs text-gray-500 dark:text-gray-400">— {selectedCustomer.phone}</span>
              <span className={`${CHIP_SMALL_CLASS} ${getCustomerStatusToneClass(selectedCustomer.status)}`}>{selectedCustomer.status}</span>
            </div>
            <p className="mt-0.5 truncate text-theme-xs text-gray-500 dark:text-gray-400">
              Nhu cầu: {selectedCustomer.bedroomType || 'Chưa rõ'} • {selectedCustomer.interestedProjects.join(', ') || 'Chưa chọn dự án'}
            </p>
          </div>
        </div>
      ) : (
        <p className="text-theme-sm text-gray-500 dark:text-gray-400">Chưa chọn khách hàng.</p>
      )}

      <div className="relative shrink-0">
        <button
          id={id}
          type="button"
          aria-haspopup="listbox"
          aria-expanded={isOpen}
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
              onChange={(event) => setKeyword(event.target.value)}
              placeholder="Tìm tên hoặc SĐT..."
              aria-label="Tìm khách hàng"
              className="w-full rounded-lg border border-gray-200 bg-white py-2 pl-9 pr-3 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-brand-500 dark:border-white/[0.1] dark:bg-gray-900 dark:text-white/90"
            />
          </div>
          <ul role="listbox" aria-label="Danh sách khách hàng" className="max-h-60 space-y-0.5 overflow-y-auto">
            {matchedCustomers.length === 0 && (
              <li className="px-2 py-3 text-center text-theme-xs text-gray-500 dark:text-gray-400">Không tìm thấy khách phù hợp.</li>
            )}
            {matchedCustomers.map((customer) => {
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
                    <span className="block text-sm font-medium text-gray-800 dark:text-white/90">{customer.name}</span>
                    <span className="block text-theme-xs text-gray-500 dark:text-gray-400">
                      {customer.phone} • {customer.status}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </Dropdown>
      </div>
    </div>
  );
};
