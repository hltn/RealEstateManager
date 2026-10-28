import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import toast from 'react-hot-toast';
import { AxiosError } from 'axios';
import { Modal } from '../components/ui/modal';
import { Pagination } from '../components/common/Pagination';
import { EditUserModal } from '../components/users/EditUserModal';
import {
  displayNameSchema,
  emailSchema,
  passwordSchema,
} from '../components/users/userFormSchemas';
import { TableSkeletonRows } from '../components/common/TableSkeletonRows';
import { PlusIcon as PlusIconRaw, CloseIcon as CloseIconRaw } from '../icons';

// Cast icon svgr sang typed FC để truyền className (xem giải thích ở LoginScreen).
type SvgIcon = React.FC<React.SVGProps<SVGSVGElement>>;
const PlusIcon = PlusIconRaw as unknown as SvgIcon;
const CloseIcon = CloseIconRaw as unknown as SvgIcon;
import {
  fetchUsers,
  createUser,
  updateUserStatus,
  updateUserRole,
  updateUser,
  resetUserPassword,
} from '../api/users.api';
import { logout } from '../api/auth.api';
import { useAuth } from '../hooks/useAuth';
import { UserRole, UserStatus } from '../types/user';
import type { UserListItem, CreateUserPayload, UpdateUserPayload } from '../types/user';
import { DEFAULT_PAGE_SIZE } from '../types/pagination';

/** Schema validate form tạo user — đồng bộ với CreateUserDto backend (mục 16.4). */
const createUserSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  displayName: displayNameSchema,
  role: z.nativeEnum(UserRole),
});
type CreateUserFormData = z.infer<typeof createUserSchema>;

interface ApiErrorBody {
  statusCode?: number;
  message?: string | string[];
}

/** Rút message dễ đọc từ body lỗi backend (message có thể là mảng khi validate DTO). */
const extractApiMessage = (error: unknown, fallback: string): string => {
  const axiosError = error as AxiosError<ApiErrorBody>;
  const body = axiosError.response?.data;
  if (!body?.message) return fallback;
  return Array.isArray(body.message) ? body.message.join(', ') : body.message;
};

/** Message lỗi tiếng Việt cho thao tác user management — phân theo mã lỗi (mục 6.3). */
const getMutationErrorMessage = (error: unknown, fallback: string): string => {
  const axiosError = error as AxiosError<ApiErrorBody>;
  const status = axiosError.response?.status;
  const message = extractApiMessage(error, fallback);

  if (status === 401) return 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.';
  // Phân biệt "Insufficient role" vs "Cannot block your own account".
  if (status === 403) return message || 'Bạn không có quyền thực hiện thao tác này.';
  if (status === 404) return 'Tài khoản không còn tồn tại. Vui lòng tải lại danh sách.';
  if (status === 409) return 'Email đã tồn tại. Vui lòng dùng email khác.';
  return message;
};

/** Toast lỗi cho thao tác user management. */
const handleMutationError = (error: unknown, fallback: string): void => {
  toast.error(getMutationErrorMessage(error, fallback));
};

const UserManagementScreen: React.FC = () => {
  const queryClient = useQueryClient();
  const { user: currentUser, clearAuth, setUser } = useAuth();

  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(DEFAULT_PAGE_SIZE);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<UserListItem | null>(null);

  const queryKey = ['users', page, limit] as const;

  const { data, isLoading, isFetching, isError, refetch } = useQuery({
    queryKey,
    queryFn: ({ signal }) => fetchUsers(page, limit, signal ?? undefined),
    placeholderData: (prev) => prev,
  });

  const users = data?.data ?? [];
  const meta = data?.meta ?? { total: 0, page, limit, totalPages: 0 };

  /** Invalidate danh sách user để refetch sau mỗi mutation. */
  const invalidateUsers = () => {
    void queryClient.invalidateQueries({ queryKey: ['users'] });
  };

  // --- Mutation: đổi trạng thái Active/Block (Optimistic UI) ---
  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: UserStatus }) =>
      updateUserStatus(id, status),
    onMutate: async ({ id, status }) => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData(queryKey);
      queryClient.setQueryData(queryKey, (old: typeof data | undefined) => {
        if (!old) return old;
        return {
          ...old,
          data: old.data.map((u) => (u._id === id ? { ...u, status } : u)),
        };
      });
      return { previous };
    },
    onError: (error, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(queryKey, context.previous);
      handleMutationError(error, 'Không thể đổi trạng thái tài khoản.');
    },
    onSuccess: (updated) => {
      toast.success(
        updated.status === UserStatus.ACTIVE
          ? 'Đã mở khóa tài khoản.'
          : 'Đã khóa tài khoản.',
      );
      invalidateUsers();
    },
  });

  // --- Mutation: đổi role ---
  const roleMutation = useMutation({
    mutationFn: ({ id, role }: { id: string; role: UserRole }) =>
      updateUserRole(id, role),
    onError: (error) => handleMutationError(error, 'Không thể đổi vai trò.'),
    onSuccess: (updated) => {
      toast.success(`Đã đổi vai trò thành ${updated.role}.`);
      invalidateUsers();
    },
  });

  // --- Mutation: tạo user ---
  const createMutation = useMutation({
    mutationFn: (payload: CreateUserPayload) => createUser(payload),
    onError: (error) => handleMutationError(error, 'Không thể tạo tài khoản.'),
    onSuccess: (created) => {
      toast.success(`Đã tạo tài khoản ${created.email}.`);
      setIsCreateOpen(false);
      invalidateUsers();
    },
  });

  // --- Mutation: sửa tên hiển thị / email ---
  // Giữ nguyên page/limit (state của màn) nên sau khi lưu vẫn ở đúng trang danh sách.
  const updateMutation = useMutation({
    mutationFn: ({ id, changes }: { id: string; changes: UpdateUserPayload }) =>
      updateUser(id, changes),
    onError: (error) => handleMutationError(error, 'Không thể cập nhật tài khoản.'),
    onSuccess: (updated) => {
      toast.success('Đã cập nhật tài khoản.');
      setEditingUser(null);
      // Cập nhật ngay dòng trong cache rồi mới refetch nền → bảng không nhấp nháy.
      queryClient.setQueryData(queryKey, (old: typeof data | undefined) =>
        old ? { ...old, data: old.data.map((u) => (u._id === updated._id ? updated : u)) } : old,
      );
      // Admin tự sửa mình: đồng bộ tên/email hiển thị ở header.
      if (currentUser?._id === updated._id) {
        setUser({ ...currentUser, displayName: updated.displayName, email: updated.email });
      }
      invalidateUsers();
    },
  });

  // --- Mutation: đặt lại mật khẩu (backend thu hồi phiên của tài khoản đó) ---
  const resetPasswordMutation = useMutation({
    mutationFn: ({ id, newPassword }: { id: string; newPassword: string }) =>
      resetUserPassword(id, newPassword),
    onError: (error) => handleMutationError(error, 'Không thể đặt lại mật khẩu.'),
    onSuccess: () => {
      toast.success('Đã đặt lại mật khẩu. Các phiên đăng nhập của tài khoản đó đã bị đăng xuất.');
      setEditingUser(null);
    },
  });

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<CreateUserFormData>({
    resolver: zodResolver(createUserSchema),
    defaultValues: {
      email: '',
      password: '',
      displayName: '',
      role: UserRole.EDITOR,
    },
  });

  const onCreateSubmit = (formData: CreateUserFormData) => {
    createMutation.mutate(formData);
  };

  const handleLogout = async () => {
    try {
      await logout();
    } catch {
      // Logout endpoint idempotent — bỏ qua lỗi network.
    } finally {
      clearAuth();
      window.location.href = '/login';
    }
  };

  const handleOpenEdit = (user: UserListItem) => {
    // Xóa lỗi của lần mở trước để popup không hiện lại lỗi cũ.
    updateMutation.reset();
    resetPasswordMutation.reset();
    setEditingUser(user);
  };

  const handleToggleStatus = (user: UserListItem) => {
    const next =
      user.status === UserStatus.ACTIVE ? UserStatus.BLOCKED : UserStatus.ACTIVE;
    statusMutation.mutate({ id: user._id, status: next });
  };

  const handleRoleChange = (user: UserListItem, role: UserRole) => {
    if (user.role === role) return;
    roleMutation.mutate({ id: user._id, role });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-800 dark:text-white">
            Quản lý tài khoản
          </h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Tạo, sửa thông tin, đặt lại mật khẩu, khóa/mở và phân quyền tài khoản.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => refetch()}
            className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/5"
          >
            Tải lại
          </button>
          <button
            type="button"
            onClick={() => {
              reset();
              setIsCreateOpen(true);
            }}
            className="flex items-center gap-2 rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-600"
          >
            <PlusIcon className="size-4" />
            Tạo tài khoản
          </button>
        </div>
      </div>

      {/* Bảng users */}
      <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-dark">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px]">
            <thead>
              <tr className="border-b border-gray-100 text-left dark:border-gray-800">
                <th className="px-5 py-3 text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">
                  Tên hiển thị
                </th>
                <th className="px-5 py-3 text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">
                  Email
                </th>
                <th className="px-5 py-3 text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">
                  Vai trò
                </th>
                <th className="px-5 py-3 text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">
                  Trạng thái
                </th>
                <th className="px-5 py-3 text-right text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">
                  Hành động
                </th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <TableSkeletonRows columnCount={5} />
              ) : isError ? (
                <tr>
                  <td colSpan={5} className="px-5 py-10 text-center text-sm text-gray-500">
                    Không thể tải danh sách tài khoản.{' '}
                    <button onClick={() => refetch()} className="text-brand-500 underline">
                      Thử lại
                    </button>
                  </td>
                </tr>
              ) : users.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-5 py-10 text-center text-sm text-gray-500">
                    Chưa có tài khoản nào.
                  </td>
                </tr>
              ) : (
                users.map((user) => {
                  const isSelf = currentUser?._id === user._id;
                  const isBlocked = user.status === UserStatus.BLOCKED;
                  return (
                    <tr
                      key={user._id}
                      className="border-b border-gray-100 last:border-0 dark:border-gray-800"
                    >
                      <td className="px-5 py-4 text-sm font-medium text-gray-800 dark:text-white">
                        {user.displayName}
                        {isSelf && (
                          <span className="ml-2 rounded bg-brand-50 px-1.5 py-0.5 text-xs text-brand-600 dark:bg-brand-500/10 dark:text-brand-400">
                            Bạn
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-4 text-sm text-gray-600 dark:text-gray-300">
                        {user.email}
                      </td>
                      <td className="px-5 py-4">
                        <select
                          value={user.role}
                          onChange={(e) => handleRoleChange(user, e.target.value as UserRole)}
                          disabled={roleMutation.isPending}
                          className="rounded-lg border border-gray-200 bg-white px-2 py-1 text-sm text-gray-700 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300"
                        >
                          <option value={UserRole.EDITOR}>EDITOR</option>
                          <option value={UserRole.ADMIN}>ADMIN</option>
                          <option value={UserRole.MANAGER}>MANAGER</option>
                          <option value={UserRole.STAFF}>STAFF</option>
                        </select>
                      </td>
                      <td className="px-5 py-4">
                        <span
                          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${
                            isBlocked
                              ? 'bg-error-50 text-error-600 dark:bg-error-500/10 dark:text-error-500'
                              : 'bg-success-50 text-success-600 dark:bg-success-500/10 dark:text-success-500'
                          }`}
                        >
                          <span
                            className={`h-1.5 w-1.5 rounded-full ${
                              isBlocked ? 'bg-error-500' : 'bg-success-500'
                            }`}
                          />
                          {isBlocked ? 'Bị khóa' : 'Hoạt động'}
                        </span>
                      </td>
                      <td className="px-5 py-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => handleOpenEdit(user)}
                            aria-label={`Sửa tài khoản ${user.displayName}`}
                            className="rounded-lg bg-brand-500/10 px-3 py-1.5 text-xs font-medium text-brand-600 transition-colors hover:bg-brand-500/20 dark:text-brand-400"
                          >
                            Sửa
                          </button>
                          <button
                            type="button"
                            onClick={() => handleToggleStatus(user)}
                            disabled={isSelf || statusMutation.isPending}
                            title={
                              isSelf
                                ? 'Không thể khóa chính tài khoản của bạn'
                                : isBlocked
                                  ? 'Mở khóa tài khoản'
                                  : 'Khóa tài khoản'
                            }
                            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                              isBlocked
                                ? 'bg-success-500/10 text-success-600 hover:bg-success-500/20 dark:text-success-500'
                                : 'bg-error-500/10 text-error-600 hover:bg-error-500/20 dark:text-error-500'
                            }`}
                          >
                            {isBlocked ? 'Mở khóa' : 'Khóa'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {!isLoading && !isError && users.length > 0 && (
          <div className="border-t border-gray-100 dark:border-gray-800">
            <Pagination
              meta={meta}
              onPageChange={setPage}
              onLimitChange={(next) => {
                setLimit(next);
                setPage(1);
              }}
              isDisabled={isFetching}
              itemLabel="tài khoản"
            />
          </div>
        )}
      </div>

      {/* Modal tạo user */}
      <Modal isOpen={isCreateOpen} onClose={() => setIsCreateOpen(false)} className="max-w-lg p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-gray-800 dark:text-white">Tạo tài khoản mới</h2>
          <button
            type="button"
            onClick={() => setIsCreateOpen(false)}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
            aria-label="Đóng"
          >
            <CloseIcon className="size-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit(onCreateSubmit)} className="space-y-4" noValidate>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400">
              Tên hiển thị
            </label>
            <input
              {...register('displayName')}
              className="w-full rounded-lg border border-gray-200 bg-transparent px-4 py-2.5 text-sm text-gray-800 outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500 dark:border-gray-700 dark:text-white"
              placeholder="Nguyễn Văn A"
            />
            {errors.displayName && (
              <p className="mt-1 text-xs text-error-500">{errors.displayName.message}</p>
            )}
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400">
              Email
            </label>
            <input
              type="email"
              {...register('email')}
              className="w-full rounded-lg border border-gray-200 bg-transparent px-4 py-2.5 text-sm text-gray-800 outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500 dark:border-gray-700 dark:text-white"
              placeholder="editor@example.com"
            />
            {errors.email && (
              <p className="mt-1 text-xs text-error-500">{errors.email.message}</p>
            )}
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400">
              Mật khẩu
            </label>
            <input
              type="password"
              {...register('password')}
              className="w-full rounded-lg border border-gray-200 bg-transparent px-4 py-2.5 text-sm text-gray-800 outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500 dark:border-gray-700 dark:text-white"
              placeholder="Tối thiểu 8 ký tự"
            />
            {errors.password && (
              <p className="mt-1 text-xs text-error-500">{errors.password.message}</p>
            )}
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400">
              Vai trò
            </label>
            <select
              {...register('role')}
              className="w-full rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-sm text-gray-800 outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
            >
              <option value={UserRole.EDITOR}>EDITOR</option>
              <option value={UserRole.ADMIN}>ADMIN</option>
              <option value={UserRole.MANAGER}>MANAGER</option>
              <option value={UserRole.STAFF}>STAFF</option>
            </select>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setIsCreateOpen(false)}
              className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/5"
            >
              Hủy
            </button>
            <button
              type="submit"
              disabled={createMutation.isPending}
              className="flex items-center gap-2 rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-600 disabled:opacity-60"
            >
              {createMutation.isPending && (
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
              )}
              {createMutation.isPending ? 'Đang tạo...' : 'Tạo tài khoản'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Modal sửa user */}
      <EditUserModal
        user={editingUser}
        isSelf={currentUser?._id === editingUser?._id}
        onClose={() => setEditingUser(null)}
        onSaveProfile={(changes) => {
          if (editingUser) updateMutation.mutate({ id: editingUser._id, changes });
        }}
        isSavingProfile={updateMutation.isPending}
        profileErrorMessage={
          updateMutation.isError
            ? getMutationErrorMessage(updateMutation.error, 'Không thể cập nhật tài khoản.')
            : null
        }
        onResetPassword={(newPassword) => {
          if (editingUser) resetPasswordMutation.mutate({ id: editingUser._id, newPassword });
        }}
        isResettingPassword={resetPasswordMutation.isPending}
        passwordErrorMessage={
          resetPasswordMutation.isError
            ? getMutationErrorMessage(resetPasswordMutation.error, 'Không thể đặt lại mật khẩu.')
            : null
        }
      />

      {/* Nút đăng xuất (gọn cho UX ADMIN) */}
      <div className="flex justify-end pt-2">
        <button
          type="button"
          onClick={handleLogout}
          className="rounded-lg border border-error-200 px-4 py-2 text-sm font-medium text-error-600 hover:bg-error-50 dark:border-error-500/30 dark:text-error-500 dark:hover:bg-error-500/10"
        >
          Đăng xuất
        </button>
      </div>
    </div>
  );
};

export default UserManagementScreen;
