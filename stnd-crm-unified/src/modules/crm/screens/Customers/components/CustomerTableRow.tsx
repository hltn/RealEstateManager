/**
 * 1 dòng bảng khách hàng (Admin Stitch `CustomerListView`) theo mẫu bảng Admin:
 * `tr.hover:bg-gray-50.dark:hover:bg-white/[0.02]`, `td.px-5.py-4.text-theme-sm` (tài liệu 03 mục 5).
 * Responsive (khớp `CUSTOMER_TABLE_COLUMNS` ở màn): cột "Dự án" ẩn < 1536px (chip dự án hiện dưới tên),
 * "Nhóm phụ trách" và "Hẹn tiếp theo" ẩn < 1280px → bảng không tràn ở 768–1279px.
 * Ô thao tác: `TableContactActions` dùng chung (Gọi / Zalo / Ghi chú nhanh).
 */
import type { MouseEvent } from 'react';
import { Star } from 'lucide-react';
import { CustomerStatusChip } from '@crm/components/CustomerStatusChip';
import { PROJECT_CHIP_CLASS } from '@crm/lib/uiClasses';
import { TableContactActions } from '@crm/components/TableContactActions';
import { getPrimaryProject } from '@crm/lib/customerAdapters';
import { TODAY_LABEL } from '@crm/lib/dateTime';
import { useCrmActions } from '@crm/store';
import type { Customer } from '@crm/types/crm';
import { DealProgressDots } from './DealProgressDots';

interface CustomerTableRowProps {
  customer: Customer;
}

export const CustomerTableRow = ({ customer }: CustomerTableRowProps) => {
  const { selectCustomer } = useCrmActions();
  const primaryProject = getPrimaryProject(customer);
  const isAppointmentToday = customer.nextAppointmentDate === TODAY_LABEL;

  const handleOpenDetail = () => selectCustomer(customer.id);
  const handleNameClick = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    handleOpenDetail();
  };

  return (
    <tr onClick={handleOpenDetail} className="cursor-pointer transition-colors hover:bg-gray-50 dark:hover:bg-white/[0.02]">
      {/* KHÁCH HÀNG */}
      <td className="px-5 py-4">
        <button
          type="button"
          onClick={handleNameClick}
          className="text-left text-theme-sm font-medium text-gray-800 transition-colors hover:text-brand-500 dark:text-white/90 dark:hover:text-brand-400"
        >
          {customer.name}
        </button>
        <p className="text-theme-xs text-gray-500 dark:text-gray-400">
          <span className="font-mono">{customer.code}</span> · {customer.phone}
        </p>
        <div className="pt-1.5 2xl:hidden">
          <span className={PROJECT_CHIP_CLASS}>{primaryProject || 'Chưa chọn dự án'}</span>
        </div>
      </td>

      {/* TÌNH TRẠNG */}
      <td className="px-5 py-4">
        <CustomerStatusChip status={customer.status} />
      </td>

      {/* DỰ ÁN QUAN TÂM */}
      <td className="hidden px-5 py-4 2xl:table-cell">
        <span className={PROJECT_CHIP_CLASS}>{primaryProject || 'Chưa chọn dự án'}</span>
        {customer.interestedProjects.length > 1 && (
          <span className="ml-1 text-theme-xs text-gray-400 dark:text-gray-500">+{customer.interestedProjects.length - 1}</span>
        )}
      </td>

      {/* TIẾN ĐỘ CHỐT DEAL */}
      <td className="px-5 py-4">
        <DealProgressDots progressPercentage={customer.progressPercentage} progressStep={customer.progressStep} />
      </td>

      {/* NHÓM PHỤ TRÁCH */}
      <td className="hidden px-5 py-4 xl:table-cell">
        <div className="flex items-center gap-1 text-theme-sm font-medium text-gray-800 dark:text-white/90">
          <span>{customer.staffLead}</span>
          <Star size={12} className="fill-warning-400 text-warning-400" aria-label="Phụ trách chính" />
        </div>
        {customer.staffSupport.length > 0 && (
          <p className="text-theme-xs text-gray-500 dark:text-gray-400">Hỗ trợ: {customer.staffSupport.join(', ')}</p>
        )}
      </td>

      {/* HẸN TIẾP THEO */}
      <td className="hidden px-5 py-4 xl:table-cell">
        {isAppointmentToday ? (
          <p className="flex items-center gap-1.5 text-theme-xs font-semibold text-brand-500 dark:text-brand-400">
            <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-brand-500" />
            {TODAY_LABEL} · {customer.nextAppointmentTime}
          </p>
        ) : (
          <p className="text-theme-xs font-medium text-gray-800 dark:text-white/90">
            {customer.nextAppointmentDate || 'Chờ lên lịch'}
            {customer.nextAppointmentTime && <span className="text-gray-500 dark:text-gray-400"> · {customer.nextAppointmentTime}</span>}
          </p>
        )}
        {customer.nextAppointmentNote && (
          <p className="mt-0.5 line-clamp-1 text-theme-xs text-gray-500 dark:text-gray-400">{customer.nextAppointmentNote}</p>
        )}
      </td>

      {/* THAO TÁC */}
      <td className="px-5 py-4">
        <TableContactActions customerId={customer.id} customerName={customer.name} />
      </td>
    </tr>
  );
};
