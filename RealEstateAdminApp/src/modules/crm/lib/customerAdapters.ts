/**
 * Hàm thuần định dạng dữ liệu khách cho giao diện (không đọc store).
 */
import { PURCHASE_PURPOSE_CODE_LABELS } from '@crm/data/personaFields';
import type { ContactChannel, PersonaFieldDefinition } from '@crm/types/crm';

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

/**
 * Mã "Mục đích mua" -> chuỗi nhãn phân cách dấu phẩy (ô Khách hàng). Nhãn lấy theo cấu hình trường chân dung hiện hành
 * (`optionItems`, kể cả lựa chọn đã tắt); chưa có cấu hình -> bảng nhãn mặc định; mã lạ -> giữ nguyên mã.
 */
export const formatPurchasePurposes = (codes: readonly string[], field?: Pick<PersonaFieldDefinition, 'optionItems'>): string =>
  codes.map((code) => field?.optionItems?.find((option) => option.value === code)?.label ?? PURCHASE_PURPOSE_CODE_LABELS[code] ?? code).join(', ');
