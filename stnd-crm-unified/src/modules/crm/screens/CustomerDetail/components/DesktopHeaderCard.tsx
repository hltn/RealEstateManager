// Breadcrumb + thẻ đầu trang khách hàng (Admin CustomerDetailView, khối 1) theo phong cách Admin.
// Breadcrumb: `CrmBreadcrumb` dùng chung (lớp chữ của `PageBreadCrumb`). Avatar chữ: mẫu `UserDropdown.tsx:40` (tròn, bg-brand-500).
import { useState } from 'react';
import { CalendarPlus, Eye, EyeOff, MessageCircle, NotebookPen, Phone, Plus } from 'lucide-react';
import { CrmBreadcrumb } from '@crm/components/CrmBreadcrumb';
import { useContactActions } from '@crm/hooks/useContactActions';
import { buildCrmPath } from '@crm/routes';
import { useCrmActions } from '@crm/store';
import type { Customer } from '@crm/types/crm';
import { getInitials } from '@crm/lib/staff';
import { maskPhoneAdmin } from '../customerDetailUtils';
import { useCustomerDetailActions } from '../useCustomerDetailActions';
import { CareTeamAvatars, StatusDropdown, VipChip } from './DetailParts';
import {
  BUTTON_DASHED_CLASS,
  BUTTON_LINK_CLASS,
  BUTTON_PRIMARY_LG_CLASS,
  BUTTON_SUCCESS_LG_CLASS,
  CARD_CLASS,
  ICON_BUTTON_OUTLINE_CLASS,
} from '@crm/lib/uiClasses';

interface DesktopHeaderCardProps {
  customer: Customer;
}

const DEFAULT_TEAM_GROUP = 'Nhóm C8';
export const DesktopHeaderCard = ({ customer }: DesktopHeaderCardProps) => {
  const { navigate } = useCrmActions();
  const { callCustomer, messageZalo, openQuickNote } = useContactActions();
  const { notify } = useCustomerDetailActions(customer.id);
  const [isPhoneVisible, setIsPhoneVisible] = useState(false);
  const PhoneToggleIcon = isPhoneVisible ? EyeOff : Eye;

  const supportNames = customer.staffSupport.join(', ');
  const supportText = customer.staffLead && supportNames ? `, ${supportNames}` : supportNames;

  return (
    <div className="flex flex-col gap-4">
      <CrmBreadcrumb
        items={[
          { label: 'Quản lý khách hàng', to: buildCrmPath('today') },
          { label: 'Danh sách khách hàng', to: buildCrmPath('customers') },
          { label: customer.name },
        ]}
      />

      <section
        aria-label="Hồ sơ khách hàng"
        className={`${CARD_CLASS} flex flex-col justify-between gap-5 p-5 md:p-6 xl:flex-row xl:items-center`}
      >
        <div className="flex min-w-0 items-start gap-4">
          <span
            aria-hidden="true"
            className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-brand-500 text-lg font-semibold text-white"
          >
            {getInitials(customer.name)}
          </span>

          <div className="min-w-0 space-y-2">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-xl font-semibold text-gray-800 md:text-2xl dark:text-white/90">{customer.name}</h1>
              {customer.isVip && <VipChip label={customer.vipTier ?? 'VIP Platinum'} />}
              <StatusDropdown customerId={customer.id} status={customer.status} />
            </div>

            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-theme-sm text-gray-500 dark:text-gray-400">
              {/* SĐT che bớt + nút hiện/ẩn */}
              <div className="flex items-center gap-1.5">
                <Phone size={16} aria-hidden="true" className="text-gray-400" />
                <span className="font-medium tracking-wide text-gray-800 tabular-nums dark:text-white/90">
                  {isPhoneVisible ? customer.phone : maskPhoneAdmin(customer.phone)}
                </span>
                <button
                  type="button"
                  onClick={() => setIsPhoneVisible((isVisible) => !isVisible)}
                  className={BUTTON_LINK_CLASS}
                  aria-pressed={isPhoneVisible}
                >
                  <PhoneToggleIcon size={14} aria-hidden="true" />
                  {isPhoneVisible ? 'Ẩn số' : 'Hiện số'}
                </button>
              </div>

              {/* Nhóm chăm sóc (C8) */}
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <span className="text-theme-xs font-medium uppercase tracking-wider text-gray-400">Nhóm chăm sóc</span>
                <CareTeamAvatars staffLead={customer.staffLead} staffSupport={customer.staffSupport} />
                <span className="text-theme-xs text-gray-700 dark:text-gray-300">
                  {customer.staffLead && (
                    <strong className="font-semibold text-warning-600 dark:text-warning-500">★ {customer.staffLead} (Chính)</strong>
                  )}
                  {supportText} ({customer.teamGroup || DEFAULT_TEAM_GROUP})
                </span>
                <button
                  type="button"
                  onClick={() => notify('Thêm chuyên viên phối hợp chăm sóc khách hàng')}
                  className={BUTTON_DASHED_CLASS}
                >
                  <Plus size={12} aria-hidden="true" />
                  Thêm người
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Nút hành động: 1 nút brand duy nhất (Gọi ngay) theo quy tắc Admin */}
        <div className="flex shrink-0 flex-wrap items-center gap-3">
          <button type="button" onClick={() => messageZalo(customer.id)} className={BUTTON_SUCCESS_LG_CLASS}>
            <MessageCircle size={18} aria-hidden="true" />
            Nhắn Zalo
          </button>
          <button type="button" onClick={() => callCustomer(customer.id)} className={BUTTON_PRIMARY_LG_CLASS}>
            <Phone size={18} aria-hidden="true" />
            Gọi ngay
          </button>
          <button
            type="button"
            onClick={() => openQuickNote(customer.id)}
            aria-label="Ghi chú nhanh"
            title="Ghi chú nhanh"
            className={ICON_BUTTON_OUTLINE_CLASS}
          >
            <NotebookPen size={18} aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => navigate('create_appointment')}
            aria-label="Đặt lịch hẹn gặp khách"
            title="Đặt lịch hẹn gặp khách"
            className={ICON_BUTTON_OUTLINE_CLASS}
          >
            <CalendarPlus size={18} aria-hidden="true" />
          </button>
        </div>
      </section>
    </div>
  );
};
