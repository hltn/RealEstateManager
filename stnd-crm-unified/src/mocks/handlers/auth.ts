import { getDefaultCrmStore } from '@crm/store/crmStore';
import type { AdminUser } from '@crm/types/crm';
import { useAuthStore } from '../../stores/auth.store';
import { MOCK_ACCESS_TOKEN, MOCK_USER, toAuthUser } from '../mockUser';
import type { MockRoute } from '../types';
import { fail, ok } from '../utils';
import { readString } from './shared';

/** Hồ sơ mới nhất của tài khoản trong store CRM (vai trò/nhóm có thể đã đổi sau khi đăng nhập). */
const findAccount = (predicate: (user: AdminUser) => boolean) => {
  const { users, teams } = getDefaultCrmStore().getState().state;
  const user = users.find(predicate);
  return user ? { user, authUser: toAuthUser(user, teams) } : null;
};

/**
 * `/auth/*` — [Prototype] đăng nhập giả theo TÀI KHOẢN MẪU (`SEED_USERS`): đúng email -> thành công với MẬT KHẨU BẤT KỲ;
 * email lạ -> 401 như app chính (để xem giao diện lỗi đăng nhập); tài khoản bị khóa -> 403.
 */
export const authRoutes: MockRoute[] = [
  {
    method: 'GET',
    pattern: /^\/auth\/me$/,
    handler: () => {
      const currentId = useAuthStore.getState().user?._id ?? MOCK_USER._id;
      return ok(findAccount((user) => user.id === currentId)?.authUser ?? MOCK_USER);
    },
  },
  {
    method: 'POST',
    pattern: /^\/auth\/login$/,
    handler: ({ body, path }) => {
      const email = readString(body, 'email')?.trim().toLowerCase() ?? '';
      const account = findAccount((user) => (user.email ?? '').toLowerCase() === email);
      if (!account) return fail(401, 'Email hoặc mật khẩu không đúng', path);
      if (!account.user.isActive) return fail(403, 'Tài khoản đã bị khóa', path);
      return ok({ accessToken: MOCK_ACCESS_TOKEN, user: account.authUser });
    },
  },
  { method: 'POST', pattern: /^\/auth\/refresh$/, handler: () => ok({ accessToken: MOCK_ACCESS_TOKEN }) },
  { method: 'POST', pattern: /^\/auth\/logout$/, handler: () => ok({ message: 'Đăng xuất thành công' }) },
];
