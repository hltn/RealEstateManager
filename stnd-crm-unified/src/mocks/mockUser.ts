import type { AuthUser } from '../types/user';

/** Tài khoản giả dùng chung cho seed auth (main.tsx) và handler `/auth/*`. */
export const MOCK_USER: AuthUser = {
  _id: '6650a1f0c0ffee0000000001',
  email: 'admin@stnd.vn',
  displayName: 'Nguyễn Quản Trị',
  role: 'ADMIN',
  status: 'ACTIVE',
};

export const MOCK_ACCESS_TOKEN = 'mock-access-token';
