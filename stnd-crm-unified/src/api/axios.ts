import axios, {
  type AxiosError,
  type AxiosRequestConfig,
  type InternalAxiosRequestConfig,
} from 'axios';
import { useAuthStore } from '../stores/auth.store';

/**
 * Base URL của backend. Lấy từ `VITE_API_URL` (mặc định `http://localhost:3000/api/v1`).
 * `withCredentials: true` để browser tự gửi refresh token cookie (httpOnly) cho mọi request.
 */
const apiAxios = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? 'http://localhost:3000/api/v1',
  withCredentials: true,
  timeout: 30_000,
});

/** Các endpoint public (KHÔNG đính token, KHÔNG retry khi 401). */
const PUBLIC_ENDPOINTS = ['/auth/login', '/auth/refresh'];

/** Kiểm tra request có phải endpoint public không (dựa trên url đã ghi config). */
const isPublicRequest = (config: AxiosRequestConfig | undefined): boolean => {
  const url = config?.url ?? '';
  return PUBLIC_ENDPOINTS.some((ep) => url.endsWith(ep));
};

/**
 * Request interceptor: đính `Authorization: Bearer <accessToken>` từ Zustand store
 * vào mọi request không phải public. Token chỉ nằm trong RAM, không bao giờ chạm localStorage.
 */
apiAxios.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  if (isPublicRequest(config)) return config;

  const token = useAuthStore.getState().accessToken;
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

/**
 * Response interceptor: khi gặp 401 (access token hết hạn / thiếu) và request chưa retry,
 * gọi `/auth/refresh` để lấy token mới rồi retry request gốc đúng 1 lần.
 * Nếu refresh thất bại → clearAuth + redirect `/login` (tránh loop vô hạn).
 */
let isRefreshing = false;

apiAxios.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as
      | (InternalAxiosRequestConfig & { _retried?: boolean })
      | undefined;

    // Chỉ xử lý 401, có config, chưa retry, và KHÔNG phải endpoint public (login/refresh).
    const shouldHandle401 =
      error.response?.status === 401 &&
      !!originalRequest &&
      !originalRequest._retried &&
      !isPublicRequest(originalRequest);

    if (!shouldHandle401) {
      return Promise.reject(error);
    }

    // Đánh dấu đã retry để tránh loop nếu retry tiếp tục nhận 401.
    originalRequest!._retried = true;

    // Tránh nhiều request concurrent cùng gọi refresh cùng lúc.
    if (isRefreshing) {
      try {
        await waitForRefresh();
        return retryOriginal(originalRequest!);
      } catch {
        handleRefreshFailure();
        return Promise.reject(error);
      }
    }

    isRefreshing = true;
    try {
      const { data } = await apiAxios.post<{ accessToken: string }>('/auth/refresh');
      // Lấy token mới, giữ nguyên user hiện tại trong store.
      const currentUser = useAuthStore.getState().user;
      if (currentUser) {
        useAuthStore.getState().setAuth(data.accessToken, currentUser);
      } else {
        // Trường hợp hiếm: chưa có user (refresh ngay sau F5) — chỉ lưu token, getMe sẽ đổ user.
        useAuthStore.setState({ accessToken: data.accessToken });
      }
      return retryOriginal(originalRequest!);
    } catch {
      handleRefreshFailure();
      return Promise.reject(error);
    } finally {
      isRefreshing = false;
    }
  },
);

/** Retry request gốc với token mới (đã được request interceptor gắn lại). */
function retryOriginal(originalRequest: InternalAxiosRequestConfig) {
  return apiAxios(originalRequest);
}

/** Đợi khi đang refresh để các request concurrent không bị mất token. */
function waitForRefresh(): Promise<void> {
  return new Promise((resolve, reject) => {
    const check = () => {
      if (!isRefreshing) {
        if (useAuthStore.getState().accessToken) resolve();
        else reject(new Error('refresh failed'));
        return;
      }
      setTimeout(check, 200);
    };
    check();
  });
}

/**
 * Xoá auth khi refresh thất bại. KHÔNG hard-redirect ở đây để tránh reload loop
 * (AuthInitializer cũng gọi getMe trên /login). Việc điều hướng về `/login` do
 * ProtectedRoute phản ứng theo store state — đảm bảo soft redirect, không loop.
 */
function handleRefreshFailure(): void {
  useAuthStore.getState().clearAuth();
}

export default apiAxios;
