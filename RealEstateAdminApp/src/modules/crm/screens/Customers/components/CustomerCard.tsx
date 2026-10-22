/**
 * Thẻ khách của danh sách trên điện thoại (02 §7: bảng chuyển thành danh sách thẻ).
 * Tên + SĐT che + tình trạng, dự án, tiến độ 4 chấm, phụ trách, hẹn tiếp theo, cập nhật cuối + 4 nút liên hệ.
 */
import { CalendarDays, Star } from 'lucide-react';
import type { CustomerListItem } from '@crm/api';
import { ContactActionGrid } from '@crm/components/ContactActionGrid';
import { CustomerStatusChip } from '@crm/components/CustomerStatusChip';
import { ProgressDots } from '@crm/components/ProgressDots';
import { formatProjectSummary } from '@crm/lib/customerAdapters';
import { formatVnDate, formatVnRelative } from '@crm/lib/dateTime';
import { maskPhoneDisplay } from '@crm/lib/phone';
import { CARD_CLASS, PROJECT_CHIP_CLASS } from '@crm/lib/uiClasses';
import { useCrmActions } from '@crm/store';

const FIELD_LABEL_CLASS = 'shrink-0 text-theme-xs text-gray-400 dark:text-gray-500';

interface CustomerCardProps {
  customer: CustomerListItem;
}

export const CustomerCard = ({ customer }: CustomerCardProps) => {
  const { selectCustomer } = useCrmActions();
  const projectSummary = formatProjectSummary(customer.projects);

  return (
    <article className={`${CARD_CLASS} p-4`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <button type="button" onClick={() => selectCustomer(customer.id)} className="flex min-w-0 items-baseline gap-1.5 text-left">
            {customer.code && <span className="font-mono text-theme-xs text-gray-400 dark:text-gray-500">{customer.code}</span>}
            <span className="truncate text-base font-semibold text-gray-800 transition-colors hover:text-brand-500 dark:text-white/90 dark:hover:text-brand-400">
              {customer.fullName}
            </span>
          </button>
          <p className="font-mono text-theme-xs text-gray-500 dark:text-gray-400">{maskPhoneDisplay(customer.phone)}</p>
        </div>
        <CustomerStatusChip status={customer.status} />
      </div>

      <dl className="my-3 grid grid-cols-2 gap-x-3 gap-y-2.5 border-y border-gray-100 py-3 dark:border-white/[0.05]">
        <div className="flex min-w-0 items-center gap-1.5">
          <dt className={FIELD_LABEL_CLASS}>Dự án:</dt>
          <dd className="min-w-0">
            <span className={PROJECT_CHIP_CLASS}>{projectSummary || '—'}</span>
          </dd>
        </div>
        <div className="flex items-center justify-end">
          <dt className="sr-only">Tiến độ</dt>
          <dd>
            <ProgressDots progress={customer.progress} criteriaDone={customer.criteriaDone} />
          </dd>
        </div>
        <div className="flex min-w-0 items-center gap-1.5">
          <dt className={FIELD_LABEL_CLASS}>Phụ trách:</dt>
          <dd className="flex min-w-0 items-center gap-1 text-theme-xs font-medium text-gray-700 dark:text-gray-300">
            {customer.primaryAssignee ? (
              <>
                <Star size={11} className="shrink-0 fill-warning-400 text-warning-400" aria-label="Phụ trách chính" />
                <span className="truncate">{customer.primaryAssignee.displayName}</span>
                {customer.careTeamSize > 1 && <span className="text-gray-400">+{customer.careTeamSize - 1}</span>}
              </>
            ) : (
              'Chưa phân'
            )}
          </dd>
        </div>
        <div className="flex items-center justify-end gap-1 text-theme-xs font-medium text-gray-700 dark:text-gray-300">
          <dt className="sr-only">Hẹn tiếp theo</dt>
          <dd className="flex items-center gap-1">
            <CalendarDays size={14} className="shrink-0 text-brand-500 dark:text-brand-400" aria-hidden="true" />
            {customer.nextAppointmentAt ? formatVnRelative(customer.nextAppointmentAt) : 'Chưa có hẹn'}
          </dd>
        </div>
        <div className="col-span-2 flex items-center gap-1.5">
          <dt className={FIELD_LABEL_CLASS}>Cập nhật:</dt>
          <dd className="text-theme-xs text-gray-600 dark:text-gray-400">
            {formatVnDate(customer.lastUpdatedAt)}
            {customer.area && ` · ${customer.area.label}`}
          </dd>
        </div>
      </dl>

      <ContactActionGrid customerId={customer.id} isPhoneMasked={customer.isPhoneMasked} />
    </article>
  );
};
