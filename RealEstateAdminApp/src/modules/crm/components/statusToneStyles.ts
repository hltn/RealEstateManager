import { CHIP_TONE_CLASS } from '@crm/lib/uiClasses';
import type { StatusTone } from '@crm/types/crm';

/** Bảng màu DUY NHẤT theo `tone` của tình trạng khách (chip, chấm, thanh báo cáo, dropdown đổi tình trạng). */
export const STATUS_TONE_STYLES: Record<StatusTone, { chipClass: string; dotClass: string; fillClass: string; strokeClass: string }> = {
  gray: { chipClass: CHIP_TONE_CLASS.gray, dotClass: 'bg-gray-400', fillClass: 'bg-gray-400 dark:bg-gray-500', strokeClass: 'text-gray-400 dark:text-gray-500' },
  success: { chipClass: CHIP_TONE_CLASS.success, dotClass: 'bg-success-500', fillClass: 'bg-success-500', strokeClass: 'text-success-500' },
  warning: { chipClass: CHIP_TONE_CLASS.warning, dotClass: 'bg-warning-500', fillClass: 'bg-warning-500', strokeClass: 'text-warning-500' },
  error: { chipClass: CHIP_TONE_CLASS.error, dotClass: 'bg-error-500', fillClass: 'bg-error-500', strokeClass: 'text-error-500' },
  brand: { chipClass: CHIP_TONE_CLASS.brand, dotClass: 'bg-brand-500', fillClass: 'bg-brand-500', strokeClass: 'text-brand-500' },
};
