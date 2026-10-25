import { QueryClient } from '@tanstack/react-query';

/**
 * QueryClient dùng chung toàn app. Export riêng để store đăng nhập có thể xóa cache khi đăng xuất/đổi tài khoản
 * (tránh lộ dữ liệu CRM của người trước cho người dùng sau).
 */
export const queryClient = new QueryClient();
