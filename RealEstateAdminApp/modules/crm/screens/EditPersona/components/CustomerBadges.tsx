import { Crown, User } from 'lucide-react';
import type { Customer } from '@crm/types/crm';
import { BRAND_SOFT_CHIP_CLASS, VIP_CHIP_CLASS } from '@crm/lib/uiClasses';

interface CustomerBadgesProps {
  customer: Pick<Customer, 'name' | 'isVip' | 'vipTier'>;
}

/** Chip tên khách + VIP cạnh tiêu đề form sửa hồ sơ (VIP dùng token warning thay `amber-*` của Stitch). */
export const CustomerBadges = ({ customer }: CustomerBadgesProps) => (
  <>
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${BRAND_SOFT_CHIP_CLASS}`}>
      <User size={12} aria-hidden="true" />
      {customer.name}
    </span>
    {customer.isVip && (
      <span className={VIP_CHIP_CLASS}>
        <Crown size={12} aria-hidden="true" />
        {customer.vipTier ?? 'VIP'}
      </span>
    )}
  </>
);
