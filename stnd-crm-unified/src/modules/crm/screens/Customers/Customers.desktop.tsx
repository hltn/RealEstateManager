// Port từ stnd-admin-real-estate-manager-crm-oct-16-2026-1-51-45-pm/src/components/CustomerListView.tsx
// Phong cách Admin (tài liệu 03 mục 5): đầu trang có nút, tab module, thanh lọc kiểu ExternalLogs,
// bảng `rounded-2xl` + thead gray-50/gray-900, `Pagination` của Admin dưới bảng.
// Dữ liệu: useFilteredCustomers() (áp `state.filters` dùng chung với bản app) -> sắp xếp + phân trang cục bộ.
import { useMemo, useState } from 'react';
import { Plus, SearchX } from 'lucide-react';
import { Pagination } from '../../../../components/common/Pagination';
import { DEFAULT_PAGE_SIZE } from '../../../../types/pagination';
import { CrmModuleTabs } from '@crm/components/CrmModuleTabs';
import { BUTTON_PRIMARY_CLASS, PAGE_DESCRIPTION_CLASS, PAGE_TITLE_CLASS } from '@crm/lib/uiClasses';
import { useCrmActions, useFilteredCustomers } from '@crm/store';
import { CustomerStatusPills } from './components/CustomerStatusPills';
import { CustomerTableRow } from './components/CustomerTableRow';
import { CustomerToolbar } from './components/CustomerToolbar';
import { getPageSlice, sortCustomers, toPaginationMeta, type CustomerSortKey } from './customerListHelpers';

const FIRST_PAGE = 1;

/** Cột bảng — `className` ẩn cột phụ ở màn hẹp (khớp `CustomerTableRow`). */
const CUSTOMER_TABLE_COLUMNS: { label: string; className?: string; isRightAligned?: boolean }[] = [
  { label: 'Khách hàng', className: 'min-w-[150px]' },
  { label: 'Tình trạng' },
  { label: 'Dự án quan tâm', className: 'hidden 2xl:table-cell' },
  { label: 'Tiến độ chốt deal', className: 'min-w-[130px]' },
  { label: 'Nhóm phụ trách', className: 'hidden xl:table-cell' },
  { label: 'Hẹn tiếp theo', className: 'hidden xl:table-cell min-w-[120px]' },
  { label: 'Thao tác', isRightAligned: true },
];

export const CustomersDesktop = () => {
  const filteredCustomers = useFilteredCustomers();
  const { navigate } = useCrmActions();
  const [sortKey, setSortKey] = useState<CustomerSortKey>('newest');
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [currentPage, setCurrentPage] = useState(FIRST_PAGE);

  const sortedCustomers = useMemo(() => sortCustomers(filteredCustomers, sortKey), [filteredCustomers, sortKey]);
  const pageSlice = getPageSlice(sortedCustomers, currentPage, pageSize);
  const paginationMeta = toPaginationMeta(pageSlice, sortedCustomers.length, pageSize);
  const resetToFirstPage = () => setCurrentPage(FIRST_PAGE);

  return (
    <div className="flex w-full flex-col gap-6">
      {/* Đầu trang có nút + tab module */}
      <div className="flex flex-col gap-4">
        <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div className="flex flex-col gap-2">
            <h2 className={PAGE_TITLE_CLASS}>Quản lý khách hàng</h2>
            <p className={`${PAGE_DESCRIPTION_CLASS} max-w-2xl`}>
              Theo dõi, phân loại và quản lý toàn bộ cơ sở dữ liệu khách hàng bất động sản.
            </p>
          </div>
          <button type="button" onClick={() => navigate('create_customer')} className={`${BUTTON_PRIMARY_CLASS} shrink-0 self-start md:self-auto`}>
            <Plus size={18} aria-hidden="true" />
            Thêm khách
          </button>
        </header>
        <CrmModuleTabs />
      </div>

      {/* Tab tình trạng + thanh lọc */}
      <div className="flex flex-col gap-4">
        <CustomerStatusPills onChange={resetToFirstPage} />
        <CustomerToolbar
          sortKey={sortKey}
          onSortChange={(nextSortKey) => {
            setSortKey(nextSortKey);
            resetToFirstPage();
          }}
          onFilterChange={resetToFirstPage}
        />
      </div>

      {/* Bảng — cuộn ngang trong vỏ nếu vẫn chật (AppLayout đã có `min-w-0` nên bảng không đẩy trang tràn ngang). */}
      <div className="flex flex-col gap-2">
        <div className="overflow-hidden rounded-2xl border border-gray-200 dark:border-white/[0.05]">
          <div className="overflow-x-auto custom-scrollbar">
            <table className="min-w-full">
              <thead className="border-b border-gray-100 dark:border-white/[0.05]">
                <tr className="bg-gray-50 dark:bg-gray-900">
                  {CUSTOMER_TABLE_COLUMNS.map((column) => (
                    <th
                      key={column.label}
                      scope="col"
                      className={`whitespace-nowrap px-5 py-3 text-theme-xs font-medium uppercase text-gray-500 dark:text-gray-400 ${
                        column.isRightAligned ? 'text-right' : 'text-left'
                      } ${column.className ?? ''}`}
                    >
                      {column.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-white/[0.05]">
                {pageSlice.pageItems.map((customer) => (
                  <CustomerTableRow key={customer.id} customer={customer} />
                ))}
                {pageSlice.pageItems.length === 0 && (
                  <tr>
                    <td colSpan={CUSTOMER_TABLE_COLUMNS.length} className="px-5 py-16 text-center">
                      <div className="flex flex-col items-center gap-3">
                        <span className="flex h-16 w-16 items-center justify-center rounded-full bg-gray-100 text-gray-400 dark:bg-gray-800 dark:text-gray-500">
                          <SearchX size={32} aria-hidden="true" />
                        </span>
                        <p className="text-base font-medium text-gray-700 dark:text-gray-300">Không có khách hàng phù hợp</p>
                        <p className="text-theme-sm text-gray-500 dark:text-gray-400">Thử đổi tab tình trạng, từ khoá hoặc bộ lọc nâng cao.</p>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <Pagination
          meta={paginationMeta}
          onPageChange={setCurrentPage}
          onLimitChange={(nextPageSize) => {
            setPageSize(nextPageSize);
            resetToFirstPage();
          }}
          itemLabel="khách hàng"
        />
      </div>
    </div>
  );
};

export default CustomersDesktop;
