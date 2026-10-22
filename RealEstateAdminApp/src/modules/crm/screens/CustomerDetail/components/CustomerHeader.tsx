// Đầu trang chi tiết khách (02 §4.3): tên + tình trạng (đổi được) + phụ trách chính + SĐT che + Gọi/Zalo + ghi chú nhanh/đặt hẹn.
// Desktop: breadcrumb + thẻ ngang; mobile: thẻ gọn (nút Gọi/Zalo cố định ở `MobileContactFooter`).
import { CalendarPlus, MessageCircle, NotebookPen, Phone, Star } from 'lucide-react';
import type { CustomerDetail } from '@crm/api';
import { CrmBreadcrumb } from '@crm/components/CrmBreadcrumb';
import { useContactActions } from '@crm/hooks/useContactActions';
import { formatVnRelative, formatVnDateTime } from '@crm/lib/dateTime';
import { getInitials } from '@crm/lib/staff';
import { BUTTON_PRIMARY_LG_CLASS, BUTTON_SUCCESS_LG_CLASS, CARD_CLASS, ICON_BUTTON_OUTLINE_CLASS } from '@crm/lib/uiClasses';
import { buildCrmPath } from '@crm/routes';
import { useCrmActions } from '@crm/store';
import { PhoneDisplay, StatusDropdown } from './DetailParts';

interface CustomerHeaderProps {
  customer: CustomerDetail;
  variant: 'desktop' | 'mobile';
}

export const CustomerHeader = ({ customer, variant }: CustomerHeaderProps) => {
  const { navigate } = useCrmActions();
  const { callCustomer, messageZalo, openQuickNote } = useContactActions();
  const isDesktop = variant === 'desktop';
  const updatedText = formatVnRelative(customer.lastUpdatedAt);

  const meta = (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-theme-sm text-gray-500 dark:text-gray-400">
      <span className="inline-flex items-center gap-1.5">
        <Phone size={15} aria-hidden="true" className="text-gray-400" />
        <PhoneDisplay customer={customer} />
      </span>
      <span className="inline-flex items-center gap-1">
        <Star size={14} aria-hidden="true" className="fill-warning-400 text-warning-400" />
        Phụ trách chính:{' '}
        <strong className="font-semibold text-gray-800 dark:text-white/90">{customer.primaryAssignee?.displayName ?? 'Chưa phân'}</strong>
      </span>
      <span title={formatVnDateTime(customer.lastUpdatedAt)}>
        Cập nhật cuối: {updatedText} · {customer.lastUpdatedBy.displayName}
      </span>
    </div>
  );

  if (!isDesktop) {
    return (
      <section aria-label="Tóm tắt hồ sơ" className={`${CARD_CLASS} space-y-3 p-4`}>
        <div className="flex items-start justify-between gap-2">
          <h2 className="min-w-0 text-xl font-semibold text-gray-800 dark:text-white/90">{customer.fullName}</h2>
          <StatusDropdown customer={customer} align="right" />
        </div>
        {meta}
        <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={() => openQuickNote(customer.id)} className={`${ICON_BUTTON_OUTLINE_CLASS} w-full gap-1.5 text-sm`}>
            <NotebookPen size={16} aria-hidden="true" />
            Ghi chú
          </button>
          <button type="button" onClick={() => navigate('create_appointment')} className={`${ICON_BUTTON_OUTLINE_CLASS} w-full gap-1.5 text-sm`}>
            <CalendarPlus size={16} aria-hidden="true" />
            Hẹn nhắc
          </button>
        </div>
      </section>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <CrmBreadcrumb items={[{ label: 'Quản lý khách hàng', to: buildCrmPath('customers') }, { label: customer.fullName }]} />
      <section aria-label="Hồ sơ khách hàng" className={`${CARD_CLASS} flex flex-col justify-between gap-5 p-5 md:p-6 xl:flex-row xl:items-center`}>
        <div className="flex min-w-0 items-start gap-4">
          <span aria-hidden="true" className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-brand-500 text-lg font-semibold text-white">
            {getInitials(customer.fullName)}
          </span>
          <div className="min-w-0 space-y-2">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-xl font-semibold text-gray-800 md:text-2xl dark:text-white/90">{customer.fullName}</h1>
              <StatusDropdown customer={customer} />
            </div>
            {meta}
          </div>
        </div>

        {/* 1 nút brand duy nhất (Gọi) theo quy tắc màu Admin: Gọi xanh dương, Zalo xanh lá. */}
        <div className="flex shrink-0 flex-wrap items-center gap-3">
          <button type="button" onClick={() => callCustomer(customer.id)} className={BUTTON_PRIMARY_LG_CLASS}>
            <Phone size={18} aria-hidden="true" />
            Gọi
          </button>
          <button type="button" onClick={() => messageZalo(customer.id)} className={BUTTON_SUCCESS_LG_CLASS}>
            <MessageCircle size={18} aria-hidden="true" />
            Zalo
          </button>
          <button type="button" onClick={() => openQuickNote(customer.id)} aria-label="Ghi chú nhanh" title="Ghi chú nhanh" className={ICON_BUTTON_OUTLINE_CLASS}>
            <NotebookPen size={18} aria-hidden="true" />
          </button>
          <button type="button" onClick={() => navigate('create_appointment')} aria-label="Đặt lịch hẹn" title="Đặt lịch hẹn" className={ICON_BUTTON_OUTLINE_CLASS}>
            <CalendarPlus size={18} aria-hidden="true" />
          </button>
        </div>
      </section>
    </div>
  );
};
