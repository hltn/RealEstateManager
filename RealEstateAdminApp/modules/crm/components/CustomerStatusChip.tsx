/**
 * Chip tình trạng khách — mẫu "chip trạng thái" của Admin (`UserManagementScreen.tsx:298-311`):
 * `rounded-full px-2.5 py-1 text-xs font-medium` + chấm 6px, màu token success/warning/gray/error, có cặp `dark:`.
 * `CUSTOMER_STATUS_STYLE` là bảng màu DUY NHẤT cho tình trạng khách (bảng khách, thẻ mobile, việc hôm nay,
 * dropdown đổi trạng thái ở chi tiết, nhãn khách trên thẻ lịch hẹn).
 */
import { CHIP_CLASS, CHIP_TONE_CLASS, type ChipTone } from '@crm/lib/uiClasses';
import type { CustomerStatus } from '@crm/types/crm';

interface CustomerStatusStyle {
  tone: ChipTone;
  dotClassName: string;
}

/** Quan tâm = xanh lá, khách net = vàng (warning), chưa tiếp cận = xám, bỏ = đỏ. */
export const CUSTOMER_STATUS_STYLE: Record<CustomerStatus, CustomerStatusStyle> = {
  'Có quan tâm': { tone: 'success', dotClassName: 'bg-success-500' },
  'Khách net': { tone: 'warning', dotClassName: 'bg-warning-500' },
  'Chưa tiếp cận': { tone: 'gray', dotClassName: 'bg-gray-400' },
  'Bỏ / Không nhu cầu': { tone: 'error', dotClassName: 'bg-error-500' },
};

const isCustomerStatus = (value: string): value is CustomerStatus => value in CUSTOMER_STATUS_STYLE;

/** Lớp màu chip cho một nhãn bất kỳ: tình trạng khách theo bảng trên, nhãn tự do (vd "Chờ gọi lại") -> xám. */
export const getCustomerStatusToneClass = (label: string): string =>
  CHIP_TONE_CLASS[isCustomerStatus(label) ? CUSTOMER_STATUS_STYLE[label].tone : 'gray'];

interface CustomerStatusChipProps {
  status: CustomerStatus;
  className?: string;
}

export const CustomerStatusChip = ({ status, className = '' }: CustomerStatusChipProps) => {
  const { tone, dotClassName } = CUSTOMER_STATUS_STYLE[status];
  return (
    <span className={`${CHIP_CLASS} shrink-0 whitespace-nowrap ${CHIP_TONE_CLASS[tone]} ${className}`}>
      <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${dotClassName}`} />
      {status}
    </span>
  );
};
