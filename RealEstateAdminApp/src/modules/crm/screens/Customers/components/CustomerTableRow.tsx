/**
 * 1 dòng bảng khách (02 §4.2) theo mẫu bảng Admin: ô chọn, khách (tên + SĐT che + mã), tình trạng, dự án, nguồn,
 * khu vực, tiến độ 4 chấm, phụ trách, hẹn tiếp theo, ngày cập nhật, thao tác (Gọi / Zalo / Ghi chú).
 * Cột phụ ẩn dần ở màn hẹp (khớp `CUSTOMER_TABLE_COLUMNS` ở màn), còn chật thì cuộn ngang trong vỏ bảng.
 */
import type { MouseEvent } from 'react';
import { Star } from 'lucide-react';
import type { CustomerListItem } from '@crm/api';
import { CustomerStatusChip } from '@crm/components/CustomerStatusChip';
import { ProgressDots } from '@crm/components/ProgressDots';
import { TableContactActions } from '@crm/components/TableContactActions';
import { formatProjectSummary } from '@crm/lib/customerAdapters';
import { formatVnDate, formatVnDateTime, formatVnRelative } from '@crm/lib/dateTime';
import { maskPhoneDisplay } from '@crm/lib/phone';
import { CHECKBOX_CLASS, PROJECT_CHIP_CLASS } from '@crm/lib/uiClasses';
import { useCrmActions } from '@crm/store';

interface CustomerTableRowProps {
  customer: CustomerListItem;
  isSelected: boolean;
  onToggleSelect: (customerId: string) => void;
}

const TEXT_MUTED = 'text-theme-xs text-gray-500 dark:text-gray-400';

export const CustomerTableRow = ({ customer, isSelected, onToggleSelect }: CustomerTableRowProps) => {
  const { selectCustomer } = useCrmActions();
  const openDetail = () => selectCustomer(customer.id);
  const stop = (event: MouseEvent) => event.stopPropagation();
  const projectSummary = formatProjectSummary(customer.projects);

  return (
    <tr onClick={openDetail} className={`cursor-pointer transition-colors hover:bg-gray-50 dark:hover:bg-white/[0.02] ${isSelected ? 'bg-brand-25 dark:bg-brand-500/[0.06]' : ''}`}>
      <td className="w-10 px-4 py-4" onClick={stop}>
        <input type="checkbox" checked={isSelected} onChange={() => onToggleSelect(customer.id)} aria-label={`Chọn ${customer.fullName}`} className={CHECKBOX_CLASS} />
      </td>
      <td className="px-4 py-4">
        <button
          type="button"
          onClick={(event) => {
            stop(event);
            openDetail();
          }}
          className="text-left text-theme-sm font-medium text-gray-800 transition-colors hover:text-brand-500 dark:text-white/90 dark:hover:text-brand-400"
        >
          {customer.fullName}
        </button>
        <p className={TEXT_MUTED}>
          <span className="tabular-nums">{maskPhoneDisplay(customer.phone)}</span>
          {customer.code && <span className="font-mono"> · {customer.code}</span>}
        </p>
        <div className="pt-1.5 2xl:hidden">{projectSummary && <span className={PROJECT_CHIP_CLASS}>{projectSummary}</span>}</div>
      </td>
      <td className="px-4 py-4">
        <CustomerStatusChip status={customer.status} />
      </td>
      <td className="hidden px-4 py-4 2xl:table-cell">{projectSummary ? <span className={PROJECT_CHIP_CLASS}>{projectSummary}</span> : <span className={TEXT_MUTED}>—</span>}</td>
      <td className={`hidden px-4 py-4 xl:table-cell ${TEXT_MUTED}`}>{customer.source?.label ?? '—'}</td>
      <td className={`hidden px-4 py-4 xl:table-cell ${TEXT_MUTED}`}>{customer.area?.label ?? '—'}</td>
      <td className="px-4 py-4">
        <ProgressDots progress={customer.progress} criteriaDone={customer.criteriaDone} />
      </td>
      <td className="hidden px-4 py-4 lg:table-cell">
        {customer.primaryAssignee ? (
          <span className="flex items-center gap-1 text-theme-sm font-medium text-gray-800 dark:text-white/90">
            <Star size={12} className="fill-warning-400 text-warning-400" aria-label="Phụ trách chính" />
            {customer.primaryAssignee.displayName}
            {customer.careTeamSize > 1 && <span className={TEXT_MUTED}>+{customer.careTeamSize - 1}</span>}
          </span>
        ) : (
          <span className={TEXT_MUTED}>Chưa phân</span>
        )}
      </td>
      <td className="hidden whitespace-nowrap px-4 py-4 xl:table-cell" title={formatVnDateTime(customer.nextAppointmentAt)}>
        <span className="text-theme-xs font-medium text-gray-800 dark:text-white/90">{customer.nextAppointmentAt ? formatVnRelative(customer.nextAppointmentAt) : '—'}</span>
      </td>
      <td className={`hidden whitespace-nowrap px-4 py-4 2xl:table-cell ${TEXT_MUTED}`} title={formatVnDateTime(customer.lastUpdatedAt)}>
        {formatVnDate(customer.lastUpdatedAt)}
      </td>
      <td className="px-4 py-4">
        <TableContactActions customerId={customer.id} customerName={customer.fullName} isPhoneMasked={customer.isPhoneMasked} />
      </td>
    </tr>
  );
};
