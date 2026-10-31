import { User } from 'lucide-react';
import { BRAND_SOFT_CHIP_CLASS } from '@crm/lib/uiClasses';

interface CustomerBadgesProps {
  customer: { name: string };
}

/** Chip tên khách cạnh tiêu đề form sửa hồ sơ. */
export const CustomerBadges = ({ customer }: CustomerBadgesProps) => (
  <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${BRAND_SOFT_CHIP_CLASS}`}>
    <User size={12} aria-hidden="true" />
    {customer.name}
  </span>
);
