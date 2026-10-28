import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import UserManagementScreen from './UserManagementScreen';
import toast from 'react-hot-toast';
import { fetchUsers, resetUserPassword, updateUser } from '../api/users.api';
import { logout } from '../api/auth.api';
import type { UserListItem } from '../types/user';

vi.mock('../api/users.api', () => ({
  fetchUsers: vi.fn(),
  createUser: vi.fn(),
  updateUserStatus: vi.fn(),
  updateUserRole: vi.fn(),
  updateUser: vi.fn(),
  resetUserPassword: vi.fn(),
}));
vi.mock('../api/auth.api', () => ({ logout: vi.fn() }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

const setUser = vi.fn();
const clearAuth = vi.fn();
const currentUser = { _id: 'u-admin', email: 'admin@example.com', displayName: 'Admin', role: 'ADMIN' as const };
vi.mock('../hooks/useAuth', () => ({
  useAuth: () => ({ user: currentUser, clearAuth, setUser }),
}));

const editor: UserListItem = {
  _id: 'u-editor',
  email: 'editor@example.com',
  displayName: 'Editor One',
  role: 'EDITOR',
  status: 'ACTIVE',
};

const self: UserListItem = { _id: 'u-admin', email: 'admin@example.com', displayName: 'Admin', role: 'ADMIN', status: 'ACTIVE' };

async function openSelfEditModal() {
  vi.mocked(fetchUsers).mockResolvedValue({ data: [self], meta: { total: 1, page: 1, limit: 20, totalPages: 1 } });
  renderScreen();
  fireEvent.click(await screen.findByRole('button', { name: 'Sửa tài khoản Admin' }));
  await screen.findByRole('heading', { name: 'Sửa tài khoản của bạn' });
}

function renderScreen() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <UserManagementScreen />
    </QueryClientProvider>,
  );
}

async function openEditModal() {
  renderScreen();
  fireEvent.click(await screen.findByRole('button', { name: 'Sửa tài khoản Editor One' }));
  return screen.findByRole('heading', { name: 'Sửa tài khoản' });
}

describe('UserManagementScreen - sửa tài khoản', () => {
  beforeEach(() => {
    vi.mocked(fetchUsers).mockReset();
    vi.mocked(updateUser).mockReset();
    vi.mocked(resetUserPassword).mockReset();
    setUser.mockReset();
    clearAuth.mockReset();
    vi.mocked(logout).mockReset().mockResolvedValue(undefined);
    vi.mocked(toast.success).mockClear();
    vi.mocked(fetchUsers).mockResolvedValue({
      data: [editor],
      meta: { total: 1, page: 1, limit: 20, totalPages: 1 },
    });
  });

  it('chỉ gửi trường thực sự đổi, cảnh báo khi đổi email và đóng popup sau khi lưu', async () => {
    vi.mocked(updateUser).mockResolvedValue({ ...editor, email: 'new@example.com' });
    await openEditModal();

    expect(screen.getByRole('button', { name: 'Lưu thay đổi' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'New@Example.com' } });
    expect(screen.getByText(/phải đăng nhập lại bằng email mới/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Lưu thay đổi' }));

    await waitFor(() => expect(updateUser).toHaveBeenCalledWith('u-editor', { email: 'new@example.com' }));
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Sửa tài khoản' })).not.toBeInTheDocument());
    // Sửa người khác không được đụng tới user đang đăng nhập ở store.
    expect(setUser).not.toHaveBeenCalled();
    expect(clearAuth).not.toHaveBeenCalled();
    expect(logout).not.toHaveBeenCalled();
  });

  it('Admin tự đổi tên: đồng bộ tên mới vào store (header), giữ nguyên các field còn lại và không đăng xuất', async () => {
    vi.mocked(updateUser).mockResolvedValue({ ...self, displayName: 'Admin Mới' });
    await openSelfEditModal();

    fireEvent.change(screen.getByLabelText('Tên hiển thị'), { target: { value: 'Admin Mới' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu thay đổi' }));

    await waitFor(() => expect(updateUser).toHaveBeenCalledWith('u-admin', { displayName: 'Admin Mới' }));
    await waitFor(() =>
      expect(setUser).toHaveBeenCalledWith({ ...currentUser, displayName: 'Admin Mới', email: 'admin@example.com' }),
    );
    // Chỉ đổi tên hiển thị thì phiên giữ nguyên.
    expect(clearAuth).not.toHaveBeenCalled();
    expect(logout).not.toHaveBeenCalled();
  });

  it('Admin tự đổi email: cảnh báo đăng xuất ngay, đóng popup, logout + clearAuth kèm toast', async () => {
    vi.mocked(updateUser).mockResolvedValue({ ...self, email: 'admin2@example.com' });
    await openSelfEditModal();

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'admin2@example.com' } });
    expect(screen.getByText(/Sau khi đổi email, bạn sẽ bị đăng xuất ngay/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Lưu thay đổi' }));

    await waitFor(() => expect(clearAuth).toHaveBeenCalledTimes(1));
    expect(logout).toHaveBeenCalledTimes(1);
    // logout cần access token nên phải chạy TRƯỚC clearAuth (xóa token thì logout bị 401, cookie không được xóa).
    expect(vi.mocked(logout).mock.invocationCallOrder[0]).toBeLessThan(clearAuth.mock.invocationCallOrder[0]);
    expect(toast.success).toHaveBeenCalledWith('Đã đổi email, vui lòng đăng nhập lại bằng email mới.', expect.anything());
    expect(screen.queryByRole('heading', { name: 'Sửa tài khoản của bạn' })).not.toBeInTheDocument();
    expect(setUser).not.toHaveBeenCalled();
  });

  it('Admin tự đổi email mà submit đúp: chỉ đăng xuất và báo một lần', async () => {
    vi.mocked(updateUser).mockResolvedValue({ ...self, email: 'admin2@example.com' });
    await openSelfEditModal();

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'admin2@example.com' } });
    // Validate form bất đồng bộ nên nút chưa kịp disabled giữa hai lần submit liên tiếp.
    const form = screen.getByRole('button', { name: 'Lưu thay đổi' }).closest('form')!;
    fireEvent.submit(form);
    fireEvent.submit(form);

    await waitFor(() => expect(updateUser).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(clearAuth).toHaveBeenCalledTimes(1));
    expect(logout).toHaveBeenCalledTimes(1);
    expect(toast.success).toHaveBeenCalledTimes(1);
  });

  it('Admin tự đặt lại mật khẩu: vẫn clearAuth dù logout lỗi (phiên đã bị thu hồi)', async () => {
    vi.mocked(resetUserPassword).mockResolvedValue(undefined);
    vi.mocked(logout).mockRejectedValue({ response: { status: 401 } });
    await openSelfEditModal();

    fireEvent.change(screen.getByLabelText('Mật khẩu mới'), { target: { value: 'NewPass@123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'Đặt lại mật khẩu' }));

    await waitFor(() => expect(resetUserPassword).toHaveBeenCalledWith('u-admin', 'NewPass@123456'));
    await waitFor(() => expect(clearAuth).toHaveBeenCalledTimes(1));
    expect(toast.success).toHaveBeenCalledWith('Đã đổi mật khẩu, vui lòng đăng nhập lại.', expect.anything());
  });

  it('hiển thị lỗi 409 trùng email trong popup và giữ popup mở', async () => {
    vi.mocked(updateUser).mockRejectedValue({ response: { status: 409, data: { message: 'Conflict' } } });
    await openEditModal();

    fireEvent.change(screen.getByLabelText('Tên hiển thị'), { target: { value: 'Editor Two' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu thay đổi' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Email đã tồn tại');
    expect(updateUser).toHaveBeenCalledWith('u-editor', { displayName: 'Editor Two' });
    expect(screen.getByRole('heading', { name: 'Sửa tài khoản' })).toBeInTheDocument();
  });

  it('đặt lại mật khẩu: validate độ dài, ẩn/hiện, gửi mật khẩu mới', async () => {
    vi.mocked(resetUserPassword).mockResolvedValue(undefined);
    await openEditModal();

    const input = screen.getByLabelText('Mật khẩu mới');
    expect(screen.getByText(/phiên đăng nhập hiện tại .* sẽ bị đăng xuất/)).toBeInTheDocument();

    fireEvent.change(input, { target: { value: 'short' } });
    fireEvent.click(screen.getByRole('button', { name: 'Đặt lại mật khẩu' }));
    expect(await screen.findByText('Mật khẩu tối thiểu 8 ký tự')).toBeInTheDocument();
    expect(resetUserPassword).not.toHaveBeenCalled();

    expect(input).toHaveAttribute('type', 'password');
    fireEvent.click(screen.getByRole('button', { name: 'Hiện mật khẩu' }));
    expect(input).toHaveAttribute('type', 'text');

    fireEvent.change(input, { target: { value: 'NewPass@123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'Đặt lại mật khẩu' }));
    await waitFor(() => expect(resetUserPassword).toHaveBeenCalledWith('u-editor', 'NewPass@123456'));
    // Đặt lại mật khẩu người khác không đụng tới phiên của mình.
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Sửa tài khoản' })).not.toBeInTheDocument());
    expect(clearAuth).not.toHaveBeenCalled();
    expect(logout).not.toHaveBeenCalled();
  });
});
