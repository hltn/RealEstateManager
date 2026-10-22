/**
 * Xuất danh sách khách (X8 — mô phỏng `POST /crm/customer-exports`): áp ĐÚNG bộ lọc + phạm vi quyền hiện tại,
 * KHÔNG chứa CCCD đầy đủ (chỉ "••••1234" — 04 §7.3). Backend sẽ chạy job nền + signed URL; prototype dựng CSV tại chỗ.
 */
import { formatVnDate, formatVnDateTime, getVnTodayKey } from '@crm/lib/dateTime';
import { getProgressPercent, maskNationalId } from '@crm/lib/customerRules';
import { formatPhoneDisplay, normalizePhone } from '@crm/lib/phone';
import { toCsv } from '@crm/lib/csv';
import type { CrmDataState } from '@crm/store/crmReducer';
import type { CrmActor } from './access';
import { queryCustomers, toStatusRef, toUserRef } from './queries';
import type { CustomerListQuery } from './types';

/**
 * SĐT cho cột CSV: số VN dạng hiển thị "0912 345 678"; số nước ngoài dạng "0044…" (tiền tố 00 thay "+") —
 * không bắt đầu bằng ký tự công thức nên không cần tiền tố nháy, Excel hiển thị đúng và nhập lại được (`normalizePhone` nhận 00).
 */
export const formatPhoneForExport = (phone: string): string => {
  const normalized = normalizePhone(phone);
  if (!normalized) return phone.trim();
  return normalized.startsWith('+84') ? formatPhoneDisplay(normalized) : `00${normalized.slice(1)}`;
};

export const EXPORT_COLUMNS = [
  'Mã KH',
  'Họ tên',
  'Số điện thoại',
  'Tình trạng',
  'Nguồn khách',
  'Dự án quan tâm',
  'Khu vực',
  'Thẻ',
  'Tiến độ (%)',
  'Phụ trách chính',
  'Số người chăm sóc',
  'CCCD (che)',
  'Lịch hẹn tiếp theo',
  'Lần chăm sóc gần nhất',
  'Cập nhật cuối',
  'Ngày tạo',
] as const;

/** Dựng file CSV từ danh sách khách theo bộ lọc; trả tên file + nội dung + số dòng. */
export const buildCustomerExport = (
  state: CrmDataState,
  actor: CrmActor,
  query: CustomerListQuery,
  now: Date = new Date(),
): { fileName: string; content: string; rowCount: number } => {
  const customers = queryCustomers(state, actor, query);
  const rows = customers.map((customer) => [
    customer.code,
    customer.fullName,
    formatPhoneForExport(customer.phone),
    toStatusRef(state.catalogs, customer.statusId).label,
    state.catalogs.leadSources.find((source) => source.id === customer.sourceId)?.label ?? '',
    customer.interestedProjectIds.map((id) => state.catalogs.projects.find((project) => project.id === id)?.name ?? '').filter(Boolean).join('; '),
    state.catalogs.areas.find((area) => area.id === customer.areaId)?.name ?? '',
    customer.tagIds.map((id) => state.catalogs.tags.find((tag) => tag.id === id)?.name ?? '').filter(Boolean).join('; '),
    String(getProgressPercent(customer.criteria)),
    toUserRef(state.users, customer.primaryAssigneeId)?.displayName ?? '',
    String(customer.careTeam.length),
    maskNationalId(customer.nationalIdLast4),
    formatVnDateTime(customer.nextAppointmentAt),
    formatVnDateTime(customer.lastCareLogAt),
    formatVnDateTime(customer.lastUpdatedAt),
    formatVnDate(customer.createdAt),
  ]);
  return {
    fileName: `khach-hang-${getVnTodayKey(now)}.csv`,
    content: toCsv([[...EXPORT_COLUMNS], ...rows]),
    rowCount: rows.length,
  };
};
