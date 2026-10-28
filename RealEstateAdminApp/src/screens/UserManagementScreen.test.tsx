import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import UserManagementScreen from './UserManagementScreen';
import { fetchUsers, resetUserPassword, updateUser } from '../api/users.api';
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
const currentUser = { _id: 'u-admin', email: 'admin@example.com', displayName: 'Admin', role: 'ADMIN' as const };
vi.mock('../hooks/useAuth', () => ({
  useAuth: () => ({ user: currentUser, clearAuth: vi.fn(), setUser }),
}));

const editor: UserListItem = {
  _id: 'u-editor',
  email: 'editor@example.com',
  displayName: 'Editor One',
  role: 'EDITOR',
  status: 'ACTIVE',
};

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
  });

  it('Admin tự sửa mình: đồng bộ tên/email mới vào store (header), giữ nguyên các field còn lại', async () => {
    const self: UserListItem = { _id: 'u-admin', email: 'admin@example.com', displayName: 'Admin', role: 'ADMIN', status: 'ACTIVE' };
    vi.mocked(fetchUsers).mockResolvedValue({ data: [self], meta: { total: 1, page: 1, limit: 20, totalPages: 1 } });
    vi.mocked(updateUser).mockResolvedValue({ ...self, displayName: 'Admin Mới' });
    renderScreen();
    fireEvent.click(await screen.findByRole('button', { name: 'Sửa tài khoản Admin' }));
    expect(await screen.findByRole('heading', { name: 'Sửa tài khoản của bạn' })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Tên hiển thị'), { target: { value: 'Admin Mới' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu thay đổi' }));

    await waitFor(() => expect(updateUser).toHaveBeenCalledWith('u-admin', { displayName: 'Admin Mới' }));
    await waitFor(() =>
      expect(setUser).toHaveBeenCalledWith({ ...currentUser, displayName: 'Admin Mới', email: 'admin@example.com' }),
    );
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
  });
});
