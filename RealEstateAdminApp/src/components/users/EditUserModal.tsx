import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Modal } from '../ui/modal';
import {
  EyeIcon as EyeIconRaw,
  EyeCloseIcon as EyeCloseIconRaw,
  CloseIcon as CloseIconRaw,
} from '../../icons';
import { displayNameSchema, emailSchema, passwordSchema } from './userFormSchemas';
import type { UpdateUserPayload, UserListItem } from '../../types/user';

// Cast icon svgr sang typed FC để truyền className (xem giải thích ở LoginScreen).
type SvgIcon = React.FC<React.SVGProps<SVGSVGElement>>;
const EyeIcon = EyeIconRaw as unknown as SvgIcon;
const EyeCloseIcon = EyeCloseIconRaw as unknown as SvgIcon;
const CloseIcon = CloseIconRaw as unknown as SvgIcon;

const profileSchema = z.object({ displayName: displayNameSchema, email: emailSchema });
type ProfileFormData = z.infer<typeof profileSchema>;

const passwordFormSchema = z.object({ newPassword: passwordSchema });
type PasswordFormData = z.infer<typeof passwordFormSchema>;

const INPUT_CLASS =
  'w-full rounded-lg border border-gray-200 bg-transparent px-4 py-2.5 text-sm text-gray-800 outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500 dark:border-gray-700 dark:text-white';
const LABEL_CLASS = 'mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400';
const WARNING_CLASS =
  'rounded-lg bg-warning-50 px-3 py-2 text-xs text-warning-700 dark:bg-warning-500/10 dark:text-warning-400';

/**
 * Chỉ giữ trường thực sự đổi so với dữ liệu hiện tại (email so sánh không phân biệt hoa/thường
 * vì backend lưu email dạng lowercase). Rỗng = không có gì để gửi.
 */
const buildProfileChanges = (
  user: Pick<UserListItem, 'displayName' | 'email'>,
  values: ProfileFormData,
): UpdateUserPayload => {
  const changes: UpdateUserPayload = {};
  const displayName = values.displayName.trim();
  const email = values.email.trim().toLowerCase();
  if (displayName !== user.displayName) changes.displayName = displayName;
  if (email !== user.email.trim().toLowerCase()) changes.email = email;
  return changes;
};

interface EditUserModalProps {
  /** User đang sửa; `null` = popup đóng. */
  user: UserListItem | null;
  isSelf: boolean;
  onClose: () => void;
  onSaveProfile: (changes: UpdateUserPayload) => void;
  isSavingProfile: boolean;
  profileErrorMessage: string | null;
  onResetPassword: (newPassword: string) => void;
  isResettingPassword: boolean;
  passwordErrorMessage: string | null;
}

type EditUserBodyProps = Omit<EditUserModalProps, 'user'> & { user: UserListItem };

const EditUserBody = ({
  user,
  isSelf,
  onClose,
  onSaveProfile,
  isSavingProfile,
  profileErrorMessage,
  onResetPassword,
  isResettingPassword,
  passwordErrorMessage,
}: EditUserBodyProps) => {
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);
  const subject = isSelf ? 'bạn' : 'tài khoản này';

  const profileForm = useForm<ProfileFormData>({
    resolver: zodResolver(profileSchema),
    defaultValues: { displayName: user.displayName, email: user.email },
  });
  const passwordForm = useForm<PasswordFormData>({
    resolver: zodResolver(passwordFormSchema),
    defaultValues: { newPassword: '' },
  });

  const watchedProfile = profileForm.watch();
  const liveChanges = buildProfileChanges(user, {
    displayName: watchedProfile.displayName ?? '',
    email: watchedProfile.email ?? '',
  });
  const hasProfileChanges = Object.keys(liveChanges).length > 0;
  const isEmailChanged = liveChanges.email !== undefined;

  const submitProfile = (values: ProfileFormData) => {
    const changes = buildProfileChanges(user, values);
    if (Object.keys(changes).length === 0) return;
    onSaveProfile(changes);
  };

  const submitPassword = ({ newPassword }: PasswordFormData) => onResetPassword(newPassword);

  const profileErrors = profileForm.formState.errors;
  const passwordErrors = passwordForm.formState.errors;

  return (
    <div className="p-6">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-bold text-gray-800 dark:text-white">
          Sửa tài khoản{isSelf ? ' của bạn' : ''}
        </h2>
        <button
          type="button"
          onClick={onClose}
          className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
          aria-label="Đóng"
        >
          <CloseIcon className="size-5" />
        </button>
      </div>

      {/* Phần 1: tên hiển thị + email */}
      <form onSubmit={profileForm.handleSubmit(submitProfile)} className="space-y-4" noValidate>
        <div>
          <label htmlFor="edit-user-display-name" className={LABEL_CLASS}>
            Tên hiển thị
          </label>
          <input
            id="edit-user-display-name"
            {...profileForm.register('displayName')}
            className={INPUT_CLASS}
            placeholder="Nguyễn Văn A"
          />
          {profileErrors.displayName && (
            <p className="mt-1 text-xs text-error-500">{profileErrors.displayName.message}</p>
          )}
        </div>

        <div>
          <label htmlFor="edit-user-email" className={LABEL_CLASS}>
            Email
          </label>
          <input
            id="edit-user-email"
            type="email"
            {...profileForm.register('email')}
            className={INPUT_CLASS}
            placeholder="editor@example.com"
          />
          {profileErrors.email && (
            <p className="mt-1 text-xs text-error-500">{profileErrors.email.message}</p>
          )}
        </div>

        {isEmailChanged && (
          <p role="note" className={WARNING_CLASS}>
            Sau khi đổi email, {subject} phải đăng nhập lại bằng email mới.
          </p>
        )}
        {profileErrorMessage && (
          <p role="alert" className="text-sm text-error-500">
            {profileErrorMessage}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/5"
          >
            Hủy
          </button>
          <button
            type="submit"
            disabled={isSavingProfile || !hasProfileChanges}
            className="flex items-center gap-2 rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSavingProfile && (
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
            )}
            {isSavingProfile ? 'Đang lưu...' : 'Lưu thay đổi'}
          </button>
        </div>
      </form>

      {/* Phần 2: đặt lại mật khẩu — form riêng, nút xác nhận riêng */}
      <form
        onSubmit={passwordForm.handleSubmit(submitPassword)}
        className="mt-6 space-y-4 border-t border-gray-100 pt-5 dark:border-gray-800"
        noValidate
      >
        <h3 className="text-sm font-semibold text-gray-800 dark:text-white">Đặt lại mật khẩu</h3>
        <div>
          <label htmlFor="edit-user-new-password" className={LABEL_CLASS}>
            Mật khẩu mới
          </label>
          <div className="relative">
            <input
              id="edit-user-new-password"
              type={isPasswordVisible ? 'text' : 'password'}
              autoComplete="new-password"
              {...passwordForm.register('newPassword')}
              className={`${INPUT_CLASS} pr-12`}
              placeholder="Tối thiểu 8 ký tự"
            />
            <button
              type="button"
              onClick={() => setIsPasswordVisible((prev) => !prev)}
              className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
              aria-label={isPasswordVisible ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
            >
              {isPasswordVisible ? (
                <EyeCloseIcon className="size-5" />
              ) : (
                <EyeIcon className="size-5" />
              )}
            </button>
          </div>
          {passwordErrors.newPassword && (
            <p className="mt-1 text-xs text-error-500">{passwordErrors.newPassword.message}</p>
          )}
        </div>

        <p role="note" className={WARNING_CLASS}>
          Các phiên đăng nhập hiện tại của {subject} sẽ bị đăng xuất.
        </p>
        {passwordErrorMessage && (
          <p role="alert" className="text-sm text-error-500">
            {passwordErrorMessage}
          </p>
        )}

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={isResettingPassword}
            className="flex items-center gap-2 rounded-lg border border-error-200 px-4 py-2 text-sm font-semibold text-error-600 hover:bg-error-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-error-500/30 dark:text-error-500 dark:hover:bg-error-500/10"
          >
            {isResettingPassword && (
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-error-500/40 border-t-error-500" />
            )}
            {isResettingPassword ? 'Đang đặt lại...' : 'Đặt lại mật khẩu'}
          </button>
        </div>
      </form>
    </div>
  );
};

/**
 * Popup sửa tài khoản: (1) tên hiển thị + email, (2) đặt lại mật khẩu.
 * Body chỉ mount khi có `user` → mỗi lần mở form được khởi tạo lại từ dữ liệu hiện tại.
 */
export const EditUserModal = ({ user, ...rest }: EditUserModalProps) => (
  <Modal
    isOpen={user !== null}
    onClose={rest.onClose}
    showCloseButton={false}
    className="mx-4 max-w-lg"
  >
    {user && <EditUserBody key={user._id} user={user} {...rest} />}
  </Modal>
);
