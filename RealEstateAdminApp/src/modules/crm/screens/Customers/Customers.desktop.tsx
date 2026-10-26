// Danh sách khách (web) theo mẫu trang "Manage WP" của Admin (02 §4.2): đầu trang + tab module, tab danh sách có số đếm,
// thanh lọc, hành động hàng loạt, bảng `rounded-2xl`, `Pagination` của Admin.
// Dữ liệu: `GET /crm/customers` qua `useCustomerListScreen` (lọc + sắp xếp + phân trang ở lớp dữ liệu).
import { useRef, useState } from 'react';
import { Download, Plus, SearchX } from 'lucide-react';
import { TableSkeletonRows } from '../../../../components/common/TableSkeletonRows';
import { Pagination } from '../../../../components/common/Pagination';
import { DEFAULT_PAGE_SIZE } from '../../../../types/pagination';
import { canExportCustomers, canImportCustomers, useCrmActor } from '@crm/api';
import { useCustomerExport } from '@crm/api/mockHooks';
import { CRM_FEATURE_FLAGS } from '@crm/config/featureFlags';
import { CrmModuleTabs } from '@crm/components/CrmModuleTabs';
import { downloadCsv } from '@crm/lib/csv';
import { hasActiveCustomerFilters } from '@crm/lib/customerFilters';
import { BUTTON_OUTLINE_CLASS, BUTTON_PRIMARY_CLASS, CHECKBOX_CLASS, PAGE_DESCRIPTION_CLASS, PAGE_TITLE_CLASS } from '@crm/lib/uiClasses';
import { useCrmActions } from '@crm/store';
import { BulkActionBar } from './components/BulkActionBar';
import { CustomerListEmptyState } from './components/CustomerListEmptyState';
import { CustomerStatusPills } from './components/CustomerStatusPills';
import { CustomerTableRow } from './components/CustomerTableRow';
import { CustomerToolbar } from './components/CustomerToolbar';
import { ImportCustomersButton } from './components/ImportCustomersButton';
import { useCustomerListScreen } from './useCustomerListScreen';

/** Cột bảng — `className` ẩn cột phụ ở màn hẹp (khớp `CustomerTableRow`). */
const CUSTOMER_TABLE_COLUMNS: { label: string; className?: string; isRightAligned?: boolean }[] = [
  { label: 'Khách hàng', className: 'min-w-[170px]' },
  { label: 'Tình trạng' },
  { label: 'Dự án', className: 'hidden 2xl:table-cell' },
  { label: 'Nguồn', className: 'hidden xl:table-cell' },
  { label: 'Khu vực', className: 'hidden xl:table-cell' },
  { label: 'Tiến độ', className: 'min-w-[110px]' },
  { label: 'Phụ trách', className: 'hidden lg:table-cell' },
  { label: 'Hẹn', className: 'hidden xl:table-cell' },
  { label: 'Cập nhật', className: 'hidden 2xl:table-cell' },
  { label: 'Thao tác', isRightAligned: true },
];

export const CustomersDesktop = () => {
  const screen = useCustomerListScreen(DEFAULT_PAGE_SIZE);
  const { list, counts, filters, query, isLoading, error, refetch, updateFilters, setPage, setPageSize } = screen;
  const { navigate, showToast, resetFilters } = useCrmActions();
  const hasActiveFilters = hasActiveCustomerFilters(filters);
  const actor = useCrmActor();
  const exportCustomers = useCustomerExport();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  /** Tình trạng của khách ở các trang đã xem (để Hoàn tác đổi tình trạng hàng loạt). */
  const statusById = useRef(new Map<string, string>());
  list.data.forEach((customer) => statusById.current.set(customer.id, customer.status.id));
  const pageIds = list.data.map((customer) => customer.id);
  const isPageSelected = pageIds.length > 0 && pageIds.every((id) => selectedIds.includes(id));

  const toggleSelect = (customerId: string) =>
    setSelectedIds((current) => (current.includes(customerId) ? current.filter((id) => id !== customerId) : [...current, customerId]));
  const togglePage = () =>
    setSelectedIds((current) => (isPageSelected ? current.filter((id) => !pageIds.includes(id)) : [...new Set([...current, ...pageIds])]));

  const exportFiltered = () => {
    const result = exportCustomers({ ...query, page: 1, limit: list.meta.total });
    if (!result.ok) {
      showToast({ type: 'error', title: result.error.message });
      return;
    }
    const file = result.data;
    downloadCsv(file.fileName, file.content);
    showToast({ title: `Đã xuất ${file.rowCount} khách theo bộ lọc hiện tại`, message: 'File CSV (UTF-8) mở được bằng Excel. CCCD chỉ ghi 4 số cuối.' });
  };

  return (
    <div className="flex w-full flex-col gap-6">
      <div className="flex flex-col gap-4">
        <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div className="flex flex-col gap-2">
            <h2 className={PAGE_TITLE_CLASS}>Quản lý khách hàng</h2>
            <p className={`${PAGE_DESCRIPTION_CLASS} max-w-2xl`}>Theo dõi, chăm sóc khách hàng, nhắc việc và lịch hẹn.</p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {CRM_FEATURE_FLAGS.isMockImportExportEnabled && canImportCustomers(actor.role) && <ImportCustomersButton />}
            {canExportCustomers(actor.role) && CRM_FEATURE_FLAGS.isMockImportExportEnabled && (
              <button type="button" onClick={exportFiltered} disabled={list.meta.total === 0} className={BUTTON_OUTLINE_CLASS}>
                <Download size={18} aria-hidden="true" />
                Xuất Excel (CSV)
              </button>
            )}
            <button type="button" onClick={() => navigate('create_customer')} className={BUTTON_PRIMARY_CLASS}>
              <Plus size={18} aria-hidden="true" />
              Thêm khách
            </button>
          </div>
        </header>
        <CrmModuleTabs />
      </div>

      <div className="flex flex-col gap-4">
        <CustomerStatusPills activeTab={filters.listGroup} counts={counts} onChange={(listGroup) => updateFilters({ listGroup })} />
        <CustomerToolbar screen={screen} />
        {selectedIds.length > 0 && <BulkActionBar selectedIds={selectedIds} onClear={() => setSelectedIds([])} getStatusId={(id) => statusById.current.get(id)} />}
      </div>

      <div className="flex flex-col gap-2">
        <div className="overflow-hidden rounded-2xl border border-gray-200 dark:border-white/[0.05]">
          <div className="custom-scrollbar overflow-x-auto">
            <table className="min-w-full">
              <thead className="border-b border-gray-100 dark:border-white/[0.05]">
                <tr className="bg-gray-50 dark:bg-gray-900">
                  <th scope="col" className="w-10 px-4 py-3">
                    <input type="checkbox" checked={isPageSelected} onChange={togglePage} aria-label="Chọn tất cả khách trong trang" className={CHECKBOX_CLASS} />
                  </th>
                  {CUSTOMER_TABLE_COLUMNS.map((column) => (
                    <th
                      key={column.label}
                      scope="col"
                      className={`whitespace-nowrap px-4 py-3 text-theme-xs font-medium uppercase text-gray-500 dark:text-gray-400 ${
                        column.isRightAligned ? 'text-right' : 'text-left'
                      } ${column.className ?? ''}`}
                    >
                      {column.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-white/[0.05]">
                {isLoading && <TableSkeletonRows columnCount={CUSTOMER_TABLE_COLUMNS.length + 1} />}
                {!isLoading && error && (
                  <tr>
                    <td colSpan={CUSTOMER_TABLE_COLUMNS.length + 1} className="px-5 py-12 text-center" role="alert">
                      <p className="text-base font-medium text-gray-700 dark:text-gray-300">{error.message}</p>
                      <button type="button" onClick={refetch} className={`${BUTTON_OUTLINE_CLASS} mt-4`}>
                        Thử lại
                      </button>
                    </td>
                  </tr>
                )}
                {list.data.map((customer) => (
                  <CustomerTableRow key={customer.id} customer={customer} isSelected={selectedIds.includes(customer.id)} onToggleSelect={toggleSelect} />
                ))}
                {!isLoading && !error && list.data.length === 0 && (
                  <tr>
                    <td colSpan={CUSTOMER_TABLE_COLUMNS.length + 1} className="px-5 py-16 text-center">
                      <div className="flex flex-col items-center gap-3">
                        <span className="flex h-16 w-16 items-center justify-center rounded-full bg-gray-100 text-gray-400 dark:bg-gray-800 dark:text-gray-500">
                          <SearchX size={32} aria-hidden="true" />
                        </span>
                        <CustomerListEmptyState
                          hasNoCustomers={counts.ALL === 0 && !hasActiveFilters}
                          hasActiveFilters={hasActiveFilters}
                          hint="Thử đổi tab danh sách, từ khoá hoặc bộ lọc nâng cao."
                          onCreateCustomer={() => navigate('create_customer')}
                          onClearFilters={resetFilters}
                        />
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <Pagination meta={list.meta} onPageChange={setPage} onLimitChange={setPageSize} itemLabel="khách hàng" />
      </div>
    </div>
  );
};

export default CustomersDesktop;
