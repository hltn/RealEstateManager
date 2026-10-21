/**
 * Thẻ khách hàng của danh sách app (M/views/CustomerListView.tsx). Admin không có bản thẻ cho mobile
 * (tài liệu 03 mục 10: "Danh sách thẻ khách hàng … Làm mới") → bố cục Stitch, vỏ = mẫu "thẻ" Admin
 * (`rounded-2xl border … dark:bg-white/[0.03]`), chip trạng thái/dự án + 4 nút liên hệ dùng chung.
 */
import { CalendarDays, Star } from 'lucide-react';
import { ContactActionGrid } from '@crm/components/ContactActionGrid';
import { CustomerStatusChip } from '@crm/components/CustomerStatusChip';
import { CARD_CLASS, PROJECT_CHIP_CLASS } from '@crm/lib/uiClasses';
import { getPrimaryProject } from '@crm/lib/customerAdapters';
import { TODAY_LABEL } from '@crm/lib/dateTime';
import { useCrmActions } from '@crm/store';
import type { Customer } from '@crm/types/crm';
import { maskPhone } from '@crm/lib/contact';
import { DealProgressDots } from './DealProgressDots';

const FIELD_LABEL_CLASS = 'shrink-0 text-theme-xs text-gray-400 dark:text-gray-500';

interface CustomerCardProps {
  customer: Customer;
}

export const CustomerCard = ({ customer }: CustomerCardProps) => {
  const { selectCustomer } = useCrmActions();
  const primaryProject = getPrimaryProject(customer);
  const isAppointmentToday = customer.nextAppointmentDate === TODAY_LABEL;

  return (
    <article className={`${CARD_CLASS} p-4`}>
      {/* Mã, tên, SĐT (che số) + chip trạng thái */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <button
            type="button"
            onClick={() => selectCustomer(customer.id)}
            className="flex min-w-0 items-baseline gap-1.5 text-left"
          >
            <span className="font-mono text-theme-xs text-gray-400 dark:text-gray-500">{customer.code}</span>
            <span className="truncate text-base font-semibold text-gray-800 transition-colors hover:text-brand-500 dark:text-white/90 dark:hover:text-brand-400">
              {customer.name}
            </span>
          </button>
          <p className="font-mono text-theme-xs text-gray-500 dark:text-gray-400">{maskPhone(customer.phone)}</p>
        </div>
        <CustomerStatusChip status={customer.status} />
      </div>

      {/* Dự án, tiến độ, phụ trách, lịch hẹn */}
      <dl className="my-3 grid grid-cols-2 gap-x-3 gap-y-2.5 border-y border-gray-100 py-3 dark:border-white/[0.05]">
        <div className="flex min-w-0 items-center gap-1.5">
          <dt className={FIELD_LABEL_CLASS}>Dự án:</dt>
          <dd className="min-w-0">
            <span className={PROJECT_CHIP_CLASS}>{primaryProject || '—'}</span>
          </dd>
        </div>

        <div className="flex items-center justify-end gap-1.5">
          <dt className="sr-only">Tiến độ</dt>
          <dd>
            <DealProgressDots progressPercentage={customer.progressPercentage} isHighlighted={customer.status === 'Khách net'} />
          </dd>
        </div>

        <div className="flex min-w-0 items-center gap-1.5">
          <dt className={FIELD_LABEL_CLASS}>Phụ trách:</dt>
          <dd className="flex min-w-0 items-center gap-1 text-theme-xs font-medium text-gray-700 dark:text-gray-300">
            <span className="truncate text-brand-500 dark:text-brand-400">{customer.staffLead}</span>
            <Star size={11} className="shrink-0 fill-warning-400 text-warning-400" aria-label="Phụ trách chính" />
            {customer.staffSupport.length > 0 && <span className="truncate">, {customer.staffSupport.join(', ')}</span>}
          </dd>
        </div>

        <div className="flex items-center justify-end gap-1">
          <dt className="sr-only">Hẹn tiếp theo</dt>
          <dd
            className={`flex items-center gap-1 text-theme-xs font-medium ${
              isAppointmentToday ? 'text-brand-500 dark:text-brand-400' : 'text-gray-700 dark:text-gray-300'
            }`}
          >
            <CalendarDays size={14} className="shrink-0 text-brand-500 dark:text-brand-400" aria-hidden="true" />
            {customer.nextAppointmentDate || 'Chờ lên lịch'}
          </dd>
        </div>
      </dl>

      <ContactActionGrid customerId={customer.id} />
    </article>
  );
};
