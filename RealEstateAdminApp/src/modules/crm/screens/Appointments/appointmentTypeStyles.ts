/**
 * Màu/icon theo loại lịch hẹn — dùng chung cho desktop, mobile và form tạo lịch.
 * Chuẩn màu Admin (tài liệu 03 mục 2.2 / 5): chỉ token brand/gray/success/warning/error/blue-light, luôn có cặp `dark:`.
 * Icon: lucide-react (thay Material Symbols của 2 template Stitch).
 *
 * Quy đổi so với nguồn Stitch: emerald -> success, amber/orange -> warning, purple -> blue-light
 * (Admin không có thang purple đầy đủ, chỉ có `theme-purple-500`).
 */
import {
  Ellipsis,
  FilePen,
  House,
  MessagesSquare,
  PhoneCall,
  type LucideIcon,
} from 'lucide-react';
import type { AppointmentType } from '@crm/types/crm';

/** Bộ nút thao tác trên thẻ lịch: xem/gặp (gọi + hồ sơ), ký cọc (xác nhận), nhắc gọi (gọi ngay). */
export type AppointmentActionVariant = 'visit' | 'deposit' | 'reminder';

export const getAppointmentActionVariant = (type: AppointmentType): AppointmentActionVariant => {
  if (type === 'DEPOSIT') return 'deposit';
  if (type === 'CALLBACK') return 'reminder';
  return 'visit';
};

export interface AppointmentTypeStyle {
  icon: LucideIcon;
  /** Viền trái của thẻ lịch. */
  accentBorderClass: string;
  /** Chip loại lịch (mẫu chip trạng thái của Admin). */
  chipClass: string;
  /** Ô vuông chứa icon (thẻ chọn loại trong form). */
  iconBoxClass: string;
  /** Nhãn ngắn cho danh sách "Lịch sắp tới". */
  shortLabel: string;
}

export const APPOINTMENT_TYPE_STYLES: Record<AppointmentType, AppointmentTypeStyle> = {
  SITE_VISIT: {
    icon: House,
    accentBorderClass: 'border-l-success-500',
    chipClass: 'bg-success-50 text-success-600 dark:bg-success-500/10 dark:text-success-500',
    iconBoxClass: 'bg-success-50 text-success-600 dark:bg-success-500/10 dark:text-success-500',
    shortLabel: 'Dẫn sa bàn',
  },
  DEPOSIT: {
    icon: FilePen,
    accentBorderClass: 'border-l-warning-500',
    chipClass: 'bg-warning-50 text-warning-700 dark:bg-warning-500/10 dark:text-warning-500',
    iconBoxClass: 'bg-warning-50 text-warning-600 dark:bg-warning-500/10 dark:text-warning-500',
    shortLabel: 'Ký cọc',
  },
  MEETING: {
    icon: MessagesSquare,
    accentBorderClass: 'border-l-blue-light-500',
    chipClass: 'bg-blue-light-50 text-blue-light-600 dark:bg-blue-light-500/10 dark:text-blue-light-500',
    iconBoxClass: 'bg-blue-light-50 text-blue-light-600 dark:bg-blue-light-500/10 dark:text-blue-light-500',
    shortLabel: 'Tư vấn',
  },
  CALLBACK: {
    icon: PhoneCall,
    accentBorderClass: 'border-l-brand-500',
    chipClass: 'bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-400',
    iconBoxClass: 'bg-brand-50 text-brand-500 dark:bg-brand-500/15 dark:text-brand-400',
    shortLabel: 'Nhắc gọi',
  },
  OTHER: {
    icon: Ellipsis,
    accentBorderClass: 'border-l-gray-400 dark:border-l-gray-600',
    chipClass: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
    iconBoxClass: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
    shortLabel: 'Khác',
  },
};
