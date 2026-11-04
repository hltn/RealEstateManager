/**
 * Hàm thuần định dạng dữ liệu khách cho giao diện (không đọc store).
 */
import type { ContactChannel } from '@crm/types/crm';

export const CONTACT_CHANNEL_LABELS: Record<ContactChannel, string> = {
  CALL: 'Gọi điện',
  ZALO: 'Zalo',
  SMS: 'SMS',
  MEETING: 'Gặp trực tiếp',
  SITE_VISIT: 'Xem nhà / sa bàn',
  OTHER: 'Khác',
};

export const CONTACT_CHANNEL_ORDER: readonly ContactChannel[] = ['CALL', 'ZALO', 'MEETING', 'SITE_VISIT', 'SMS', 'OTHER'];

/** Nhãn danh sách dự án: dự án đầu + "+N" (bảng, thẻ, việc hôm nay). */
export const formatProjectSummary = (projects: readonly { label: string }[]): string => {
  if (projects.length === 0) return '';
  return projects.length > 1 ? `${projects[0].label} +${projects.length - 1}` : projects[0].label;
};
