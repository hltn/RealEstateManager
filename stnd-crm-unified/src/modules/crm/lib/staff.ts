/**
 * Hàm thuần về danh tính nhân viên. Mọi trường tên nhân viên trong dữ liệu CRM (`Customer.staffLead/staffSupport`,
 * `Appointment.leadStaffName/supportStaff`, `DailyTask.assignee`, `StaffPerformance.name`) dùng CÙNG một dạng:
 * họ tên đầy đủ trong `STAFF_LIST` (vd "Trần Mỹ Hạnh") -> so khớp bằng `isSameStaffName`, không cắt tên ngắn.
 */

const normalizeName = (value: string): string => value.trim().replace(/\s+/g, ' ').toLowerCase();

/** So khớp 2 tên nhân viên (bỏ khác biệt hoa/thường, khoảng trắng). */
export const isSameStaffName = (first: string, second: string): boolean => normalizeName(first) === normalizeName(second);

/** "Trần Mỹ Hạnh" -> "TH" (chữ cái đầu của từ đầu và từ cuối) — avatar chữ của nhân viên / khách. */
export const getInitials = (fullName: string): string => {
  const words = fullName
    .replace(/[^\p{L}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return '?';
  const first = words[0].charAt(0);
  const last = words.length > 1 ? words[words.length - 1].charAt(0) : '';
  return `${first}${last}`.toUpperCase();
};
