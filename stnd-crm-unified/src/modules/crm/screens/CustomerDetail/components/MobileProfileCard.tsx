// Thẻ tóm tắt hồ sơ (Mobile CustomerDetailView): tên, SĐT, trạng thái, Gọi/Zalo, nhóm chăm sóc (C8).
// Dropdown trạng thái = `Dropdown` của Admin (qua `StatusDropdown`); avatar chồng vẽ theo Stitch bằng token Admin.
import { useState } from 'react';
import { Eye, EyeOff, MessageCircle, Phone, UserPlus } from 'lucide-react';
import { AVATAR_HANH, CURRENT_USER } from '@crm/data/mockData';
import { useContactActions } from '@crm/hooks/useContactActions';
import type { Customer } from '@crm/types/crm';
import { maskPhone } from '@crm/lib/contact';
import { useCustomerDetailActions } from '../useCustomerDetailActions';
import { CareTeamAvatars, StatusDropdown, VipChip } from './DetailParts';
import {
  BUTTON_DASHED_CLASS,
  BUTTON_LINK_CLASS,
  BUTTON_PRIMARY_LG_CLASS,
  BUTTON_SUCCESS_LG_CLASS,
  DIVIDER_CLASS,
} from '@crm/lib/uiClasses';
import { MOBILE_CARD_CLASS } from './MobileSectionParts';

interface MobileProfileCardProps {
  customer: Customer;
}

/** Prototype chỉ có ảnh đại diện của người dùng hiện tại (Trần Mỹ Hạnh); người khác dùng avatar chữ. */
const LEAD_AVATAR_BY_NAME: Record<string, string> = { [CURRENT_USER.fullName]: AVATAR_HANH };

export const MobileProfileCard = ({ customer }: MobileProfileCardProps) => {
  const { callCustomer, messageZalo } = useContactActions();
  const { notify } = useCustomerDetailActions(customer.id);
  const [isPhoneVisible, setIsPhoneVisible] = useState(false);
  const PhoneToggleIcon = isPhoneVisible ? EyeOff : Eye;

  return (
    <section aria-label="Tóm tắt hồ sơ" className={MOBILE_CARD_CLASS}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-xl font-semibold text-gray-800 dark:text-white/90">{customer.name}</h2>
            {customer.isVip && <VipChip label="VIP" />}
          </div>
          <div className="flex flex-wrap items-center gap-1">
            <span className="font-mono text-theme-sm font-medium tracking-tight text-gray-600 dark:text-gray-400">
              {isPhoneVisible ? customer.phone : maskPhone(customer.phone)}
            </span>
            <button
              type="button"
              onClick={() => setIsPhoneVisible((isVisible) => !isVisible)}
              aria-pressed={isPhoneVisible}
              className={BUTTON_LINK_CLASS}
            >
              <PhoneToggleIcon size={14} aria-hidden="true" />
              {isPhoneVisible ? 'Ẩn số' : 'Hiện số'}
            </button>
          </div>
        </div>

        <div className="shrink-0">
          <StatusDropdown customerId={customer.id} status={customer.status} align="right" />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <button type="button" onClick={() => callCustomer(customer.id)} className={BUTTON_PRIMARY_LG_CLASS}>
          <Phone size={16} aria-hidden="true" />
          Gọi ngay
        </button>
        <button type="button" onClick={() => messageZalo(customer.id)} className={BUTTON_SUCCESS_LG_CLASS}>
          <MessageCircle size={16} aria-hidden="true" />
          Nhắn Zalo
        </button>
      </div>

      {/* Nhóm cùng chăm sóc (C8) */}
      <div className={`flex items-center justify-between gap-2 border-t pt-3 ${DIVIDER_CLASS}`}>
        <div className="flex min-w-0 items-center gap-2.5">
          <CareTeamAvatars
            staffLead={customer.staffLead}
            staffSupport={customer.staffSupport}
            leadAvatarUrl={LEAD_AVATAR_BY_NAME[customer.staffLead]}
          />
          <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-1 text-theme-xs font-medium text-gray-800 dark:text-white/90">
              {customer.staffLead && <span>★ {customer.staffLead}</span>}
              {customer.staffLead && customer.staffSupport.length > 0 && (
                <span aria-hidden="true" className="text-gray-400">
                  ·
                </span>
              )}
              {customer.staffSupport.length > 0 && (
                <span className="font-normal text-gray-500 dark:text-gray-400">{customer.staffSupport.join(', ')}</span>
              )}
            </p>
            <p className="text-theme-xs text-gray-400 dark:text-gray-500">Nhóm cùng chăm sóc (C8)</p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => notify('Thêm chuyên viên phối hợp chăm sóc khách hàng')}
          className={BUTTON_DASHED_CLASS}
        >
          <UserPlus size={14} aria-hidden="true" />
          Thêm người
        </button>
      </div>
    </section>
  );
};
