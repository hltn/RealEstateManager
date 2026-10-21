import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import toast from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';
import Logo from '../images/logo/logo.png';
import { AxiosError } from 'axios';
import { login } from '../api/auth.api';
import { useAuth } from '../hooks/useAuth';
import { EnvelopeIcon as EnvelopeIconRaw, LockIcon as LockIconRaw, EyeIcon as EyeIconRaw, EyeCloseIcon as EyeCloseIconRaw } from '../icons';

// Cast icon svgr sang typed FC để truyền className (type gốc của svgr client
// không expose props className trong setup này — pattern giống AppSidebar nhưng
// dùng typed cast thay vì `any` để giữ type-safe).
type SvgIcon = React.FC<React.SVGProps<SVGSVGElement>>;
const EnvelopeIcon = EnvelopeIconRaw as unknown as SvgIcon;
const LockIcon = LockIconRaw as unknown as SvgIcon;
const EyeIcon = EyeIconRaw as unknown as SvgIcon;
const EyeCloseIcon = EyeCloseIconRaw as unknown as SvgIcon;

/** Schema validate form login — email hợp lệ, password tối thiểu 8 ký tự. */
const loginSchema = z.object({
  email: z
    .string()
    .min(1, 'Vui lòng nhập email')
    .email('Email không đúng định dạng'),
  password: z.string().min(8, 'Mật khẩu tối thiểu 8 ký tự'),
});

type LoginFormData = z.infer<typeof loginSchema>;

/** Body lỗi chuẩn backend: { statusCode, message, timestamp, path }. */
interface ApiErrorBody {
  statusCode?: number;
  message?: string | string[];
}

/** Rút message dễ đọc từ body lỗi backend (message có thể là mảng khi validate DTO). */
const extractApiMessage = (body: ApiErrorBody | undefined, fallback: string): string => {
  if (!body?.message) return fallback;
  return Array.isArray(body.message) ? body.message.join(', ') : body.message;
};

/**
 * Hiển thị toast thân thiện theo mã lỗi backend (mục 6.3 arch doc):
 * - 401: sai email/password → "Invalid email or password"
 * - 403: tài khoản bị khóa → "Account is blocked"
 * - 429: brute-force / quá rate limit
 */
const handleLoginError = (error: unknown): void => {
  const axiosError = error as AxiosError<ApiErrorBody>;
  const status = axiosError.response?.status;
  const body = axiosError.response?.data;
  const message = extractApiMessage(body, 'Đăng nhập thất bại, vui lòng thử lại');

  if (status === 401) {
    toast.error('Email hoặc mật khẩu không đúng.');
  } else if (status === 403) {
    toast.error('Tài khoản của bạn đã bị khóa. Vui lòng liên hệ quản trị viên.');
  } else if (status === 429) {
    toast.error('Bạn đã thử đăng nhập quá nhiều lần. Vui lòng thử lại sau ít phút.');
  } else if (status === 400) {
    toast.error(message);
  } else {
    toast.error(message);
  }
};

const LoginScreen: React.FC = () => {
  const navigate = useNavigate();
  const { setAuth } = useAuth();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });

  const onSubmit = async (data: LoginFormData) => {
    setIsSubmitting(true);
    try {
      const { accessToken, user } = await login(data.email, data.password);
      setAuth(accessToken, user);
      toast.success(`Xin chào, ${user.displayName}!`);
      navigate('/', { replace: true });
    } catch (error) {
      handleLoginError(error);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4 dark:bg-gray-900">
      <div className="w-full max-w-md rounded-3xl border border-gray-200 bg-white p-8 shadow-theme-lg dark:border-gray-800 dark:bg-gray-dark">
        <div className="mb-8 text-center">
          <img
            src={Logo}
            alt="Logo"
            className="mx-auto mb-4 dark:hidden"
            width={60}
          />
          <img
            src={Logo}
            alt="Logo"
            className="mx-auto mb-4 hidden dark:block"
            width={60}
          />
          <h1 className="text-2xl font-bold text-gray-800 dark:text-white">
            Đăng nhập
          </h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Đăng nhập để truy cập trang quản trị
          </p>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-5" noValidate>
          {/* Email */}
          <div>
            <label
              htmlFor="email"
              className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400"
            >
              Email
            </label>
            <div className="relative">
              <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-gray-400">
                <EnvelopeIcon className="size-5" />
              </span>
              <input
                id="email"
                type="email"
                autoComplete="email"
                placeholder="admin@example.com"
                {...register('email')}
                className="w-full rounded-lg border border-gray-200 bg-transparent py-3 pl-12 pr-4 text-sm text-gray-800 outline-none transition-colors focus:border-brand-500 focus:ring-1 focus:ring-brand-500 dark:border-gray-700 dark:text-white"
              />
            </div>
            {errors.email && (
              <p className="mt-1 text-xs text-error-500">{errors.email.message}</p>
            )}
          </div>

          {/* Password */}
          <div>
            <label
              htmlFor="password"
              className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400"
            >
              Mật khẩu
            </label>
            <div className="relative">
              <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-gray-400">
                <LockIcon className="size-5" />
              </span>
              <input
                id="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                placeholder="••••••••"
                {...register('password')}
                className="w-full rounded-lg border border-gray-200 bg-transparent py-3 pl-12 pr-12 text-sm text-gray-800 outline-none transition-colors focus:border-brand-500 focus:ring-1 focus:ring-brand-500 dark:border-gray-700 dark:text-white"
              />
              <button
                type="button"
                onClick={() => setShowPassword((prev) => !prev)}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                aria-label={showPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
              >
                {showPassword ? <EyeCloseIcon className="size-5" /> : <EyeIcon className="size-5" />}
              </button>
            </div>
            {errors.password && (
              <p className="mt-1 text-xs text-error-500">{errors.password.message}</p>
            )}
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-brand-500 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSubmitting && (
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
            )}
            {isSubmitting ? 'Đang đăng nhập...' : 'Đăng nhập'}
          </button>
        </form>
      </div>
    </div>
  );
};

export default LoginScreen;
