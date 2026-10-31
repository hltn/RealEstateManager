import type { AccountRole, UserRole } from '@crm/types/crm';

/** Nhãn tiếng Việt của vai trò CRM (QT6). */
export const ROLE_LABELS: Record<UserRole, string> = {
  ADMIN: 'Quản trị',
  MANAGER: 'Quản lý',
  STAFF: 'Nhân viên',
};

/** Nhãn vai trò của TÀI KHOẢN: thêm EDITOR (Biên tập, quyền tin tức) bên cạnh 3 vai trò CRM. */
export const ACCOUNT_ROLE_LABELS: Record<AccountRole, string> = { ...ROLE_LABELS, EDITOR: 'Biên tập' };
