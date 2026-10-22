/**
 * Bộ chuyển "đăng nhập giả" theo người dùng/vai trò — CHỈ render ở môi trường dev (CrmLayout kiểm `import.meta.env.DEV`).
 * Dùng để kiểm tra phân quyền (Quản trị / Quản lý / Nhân viên) trên dữ liệu mock. Không có ở bản build production.
 */
import { FlaskConical } from 'lucide-react';
import { useCrmActions, useCrmRawState, useCurrentUser } from '@crm/store';
import { ROLE_LABELS } from '@crm/lib/roles';

export const DevUserSwitcher = () => {
  const { users } = useCrmRawState();
  const currentUser = useCurrentUser();
  const { switchUser, showToast } = useCrmActions();

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-warning-300 bg-warning-50 px-3 py-2 text-theme-xs text-warning-700 dark:border-warning-500/40 dark:bg-warning-500/10 dark:text-warning-400">
      <FlaskConical size={14} aria-hidden="true" />
      <label htmlFor="crm-dev-user" className="font-medium">
        Đăng nhập giả (chỉ môi trường dev):
      </label>
      <select
        id="crm-dev-user"
        value={currentUser.id}
        onChange={(event) => {
          switchUser(event.target.value);
          const user = users.find((item) => item.id === event.target.value);
          if (user) showToast({ type: 'info', title: `Đang xem với vai trò ${ROLE_LABELS[user.role]}: ${user.fullName}` });
        }}
        className="h-8 rounded-md border border-warning-200 bg-white px-2 text-theme-xs text-gray-800 dark:border-warning-500/30 dark:bg-gray-900 dark:text-white/90"
      >
        {users
          .filter((user) => user.isActive)
          .map((user) => (
            <option key={user.id} value={user.id}>
              {user.fullName} — {ROLE_LABELS[user.role]}
            </option>
          ))}
      </select>
    </div>
  );
};
