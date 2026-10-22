/**
 * Chip tình trạng khách — mẫu "chip trạng thái" của Admin (`UserManagementScreen.tsx:298-311`):
 * `rounded-full px-2.5 py-1 text-xs font-medium` + chấm 6px, luôn kèm chữ (02 §5).
 * Màu lấy từ `tone` của danh mục tình trạng (Có quan tâm xanh lá, Chưa tiếp cận xám, Khách net cam, Bỏ đỏ).
 */
import { CHIP_CLASS, CHIP_SMALL_CLASS } from '@crm/lib/uiClasses';
import type { StatusRef } from '@crm/types/crm';
import { STATUS_TONE_STYLES } from './statusToneStyles';

interface CustomerStatusChipProps {
  status: Pick<StatusRef, 'label' | 'tone'>;
  size?: 'default' | 'small';
  className?: string;
}

export const CustomerStatusChip = ({ status, size = 'default', className = '' }: CustomerStatusChipProps) => {
  const { chipClass, dotClass } = STATUS_TONE_STYLES[status.tone];
  return (
    <span className={`${size === 'small' ? CHIP_SMALL_CLASS : CHIP_CLASS} shrink-0 whitespace-nowrap ${chipClass} ${className}`}>
      <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${dotClass}`} />
      {status.label}
    </span>
  );
};
