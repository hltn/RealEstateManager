/**
 * Nội dung trạng thái rỗng của danh sách khách (dùng chung web + mobile). Phân biệt 2 trường hợp:
 * - Hệ thống chưa có khách nào (không bộ lọc/từ khoá): "Chưa có khách." + nút thêm khách đầu tiên.
 * - Có khách nhưng bộ lọc/từ khoá/tab không khớp: "Không có khách hàng phù hợp" + hướng dẫn + nút xóa bộ lọc (nếu đang lọc).
 */
import { Plus } from 'lucide-react';
import { BUTTON_OUTLINE_CLASS, BUTTON_PRIMARY_CLASS } from '@crm/lib/uiClasses';

interface CustomerListEmptyStateProps {
  /** Hệ thống hoàn toàn chưa có khách (số đếm "Tất cả" = 0 khi không có bộ lọc nào). */
  hasNoCustomers: boolean;
  /** Đang có từ khoá tìm kiếm hoặc bộ lọc nâng cao. */
  hasActiveFilters: boolean;
  /** Câu hướng dẫn dưới tiêu đề (web/mobile khác độ dài). */
  hint: string;
  onCreateCustomer: () => void;
  onClearFilters: () => void;
}

export const CustomerListEmptyState = ({ hasNoCustomers, hasActiveFilters, hint, onCreateCustomer, onClearFilters }: CustomerListEmptyStateProps) => (
  <>
    <p className="text-base font-medium text-gray-700 dark:text-gray-300">{hasNoCustomers ? 'Chưa có khách.' : 'Không có khách hàng phù hợp'}</p>
    {hasNoCustomers ? (
      <button type="button" onClick={onCreateCustomer} className={BUTTON_PRIMARY_CLASS}>
        <Plus size={16} aria-hidden="true" />
        Thêm khách đầu tiên
      </button>
    ) : (
      <>
        <p className="text-theme-sm text-gray-500 dark:text-gray-400">{hint}</p>
        {hasActiveFilters && (
          <button type="button" onClick={onClearFilters} className={BUTTON_OUTLINE_CLASS}>
            Xóa bộ lọc
          </button>
        )}
      </>
    )}
  </>
);
