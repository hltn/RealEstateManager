import { MOCK_ACCESS_TOKEN, MOCK_USER } from '../mockUser';
import type { MockRoute } from '../types';
import { ok } from '../utils';

/** `/auth/*` — luôn đăng nhập được (prototype không kiểm tra mật khẩu). */
export const authRoutes: MockRoute[] = [
  { method: 'GET', pattern: /^\/auth\/me$/, handler: () => ok(MOCK_USER) },
  {
    method: 'POST',
    pattern: /^\/auth\/login$/,
    handler: ({ body }) => {
      const email = (body as { email?: string } | undefined)?.email;
      return ok({ accessToken: MOCK_ACCESS_TOKEN, user: { ...MOCK_USER, email: email || MOCK_USER.email } });
    },
  },
  { method: 'POST', pattern: /^\/auth\/refresh$/, handler: () => ok({ accessToken: MOCK_ACCESS_TOKEN }) },
  { method: 'POST', pattern: /^\/auth\/logout$/, handler: () => ok({ message: 'Đăng xuất thành công' }) },
];
