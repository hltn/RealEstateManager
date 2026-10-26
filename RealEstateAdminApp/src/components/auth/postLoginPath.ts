import { UserRole } from '../../types/user';

/** Tham số truyền từ nơi gọi để helper này không phụ thuộc module CRM/cờ tính năng. */
interface PostLoginTarget {
  /** Đường dẫn muốn quay lại (từ `ProtectedRoute`); không tin cậy, sẽ được kiểm tra. */
  returnTo: unknown;
  role: UserRole;
  /** Module CRM có bật không (tắt thì không có route `/crm/*`). */
  isCrmEnabled: boolean;
  /** Màn CRM làm việc chính (`CRM_DEFAULT_PATH`). */
  crmDefaultPath: string;
}

/**
 * Chỉ chấp nhận đường dẫn NỘI BỘ (chống open redirect): bắt đầu bằng "/", không phải "//" hay "/\"
 * (trình duyệt coi là URL cùng giao thức tới host khác), không chứa ký tự điều khiển, không quay lại chính `/login`.
 */
export const isSafeReturnTo = (value: unknown): value is string => {
  if (typeof value !== 'string' || !value.startsWith('/')) return false;
  if (value.startsWith('//') || value.startsWith('/\\')) return false;
  if ([...value].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) return false;
  return !/^\/login(?:[/?#]|$)/.test(value);
};

/**
 * Đích sau đăng nhập: trang người dùng định vào trước đó (nếu an toàn và không phải gốc "/"),
 * không thì màn làm việc mặc định theo vai trò — vai trò CRM (ADMIN/MANAGER/STAFF) vào thẳng CRM, EDITOR ở "/".
 */
export const resolvePostLoginPath = ({ returnTo, role, isCrmEnabled, crmDefaultPath }: PostLoginTarget): string => {
  if (isSafeReturnTo(returnTo) && returnTo !== '/') return returnTo;
  if (isCrmEnabled && role !== UserRole.EDITOR) return crmDefaultPath;
  return '/';
};
