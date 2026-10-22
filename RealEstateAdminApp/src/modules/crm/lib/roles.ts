import type { UserRole } from '@crm/types/crm';

/** Nhãn tiếng Việt của vai trò CRM (QT6). */
export const ROLE_LABELS: Record<UserRole, string> = {
  ADMIN: 'Quản trị',
  MANAGER: 'Quản lý',
  STAFF: 'Nhân viên',
};
