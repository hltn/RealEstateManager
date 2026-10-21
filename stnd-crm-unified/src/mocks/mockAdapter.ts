import { AxiosError, type AxiosAdapter, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios';
import { mockRoutes } from './handlers';
import type { MockMethod, MockRequest, MockResponse } from './types';

/** Độ trễ giả lập mạng (ms) để Skeleton/Loading của các màn có cơ hội hiển thị. */
const MOCK_LATENCY_MS = 250;

const wait = (ms: number, signal?: AbortSignal | { aborted?: boolean }): Promise<void> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    if (signal && 'addEventListener' in signal) {
      signal.addEventListener('abort', () => {
        clearTimeout(timer);
        reject(new AxiosError('canceled', AxiosError.ERR_CANCELED));
      });
    }
  });

/**
 * Tách path + query từ config axios.
 * - `url` có thể là tương đối (`/auth/me`) hoặc tuyệt đối (đã ghép baseURL) → bỏ origin + baseURL.
 * - Gộp query trong url với `config.params`.
 */
const parseUrl = (config: InternalAxiosRequestConfig): { path: string; query: URLSearchParams } => {
  const rawUrl = config.url ?? '';
  const base = config.baseURL ?? '';
  let relative = rawUrl;
  if (base && relative.startsWith(base)) relative = relative.slice(base.length);
  // Bỏ origin + tiền tố /api/v1 nếu url là tuyệt đối.
  relative = relative.replace(/^https?:\/\/[^/]+/, '').replace(/^\/api\/v1(?=\/)/, '');

  const [pathPart, queryPart = ''] = relative.split('?');
  const query = new URLSearchParams(queryPart);
  const params = (config.params ?? {}) as Record<string, unknown>;
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return;
    query.set(key, String(value));
  });

  const path = `/${pathPart.replace(/^\/+/, '')}`.replace(/\/+$/, '') || '/';
  return { path, query };
};

/** Body request: axios đã stringify JSON trước khi tới adapter → parse lại cho handler dễ dùng. */
const parseBody = (data: unknown): unknown => {
  if (typeof data !== 'string') return data;
  try {
    return JSON.parse(data);
  } catch {
    return data;
  }
};

/** Phản hồi mặc định khi chưa có handler: GET trả danh sách rỗng đúng contract, còn lại trả `{}`. */
const fallbackResponse = (request: MockRequest): MockResponse => {
  console.warn(`[mock] Chưa có handler cho ${request.method} ${request.path} — trả dữ liệu rỗng. Bổ sung ở src/mocks/handlers/.`);
  if (request.method === 'GET') {
    return { data: { data: [], meta: { total: 0, page: 1, limit: 20, totalPages: 0 } } };
  }
  return { data: {} };
};

/**
 * Axios adapter giả lập backend cho prototype thiết kế.
 * Luồng: chuẩn hoá request → tìm route đầu tiên khớp (method + regex) → gọi handler →
 * status < 400 trả AxiosResponse; status >= 400 ném AxiosError (để interceptor/màn xử lý lỗi như thật).
 */
export const mockAdapter: AxiosAdapter = async (config) => {
  const method = (config.method ?? 'get').toUpperCase() as MockMethod;
  const { path, query } = parseUrl(config);

  let request: MockRequest = { method, path, query, params: [], body: parseBody(config.data), config };
  let result: MockResponse | null = null;

  for (const route of mockRoutes) {
    if (route.method !== method) continue;
    const match = route.pattern.exec(path);
    if (!match) continue;
    request = { ...request, params: match.slice(1) };
    result = await route.handler(request);
    break;
  }
  if (!result) result = fallbackResponse(request);

  await wait(MOCK_LATENCY_MS, config.signal);

  const status = result.status ?? 200;
  const response: AxiosResponse = {
    data: result.data,
    status,
    statusText: status < 400 ? 'OK' : 'Mock Error',
    headers: {},
    config,
    request: {},
  };

  if (status >= 400) {
    throw new AxiosError(
      `Request failed with status code ${status}`,
      status >= 500 ? AxiosError.ERR_BAD_RESPONSE : AxiosError.ERR_BAD_REQUEST,
      config,
      response.request,
      response,
    );
  }
  return response;
};
