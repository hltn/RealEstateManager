import type { InternalAxiosRequestConfig } from 'axios';

/** Phương thức HTTP mà mock hỗ trợ. */
export type MockMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** Request đã được chuẩn hoá trước khi đưa vào handler. */
export interface MockRequest {
  method: MockMethod;
  /** Path tương đối KHÔNG gồm baseURL và query string, vd `/news-manager/raw-articles/abc`. */
  path: string;
  /** Query string (gộp cả `config.params` lẫn `?a=b` trong url). */
  query: URLSearchParams;
  /** Nhóm bắt được từ regex của route (`match[1]`, `match[2]`...). */
  params: string[];
  /** Body đã parse JSON (nếu có). */
  body: unknown;
  config: InternalAxiosRequestConfig;
}

/** Kết quả handler trả về. `status >= 400` sẽ được ném ra như lỗi Axios thật. */
export interface MockResponse {
  data: unknown;
  status?: number;
}

export type MockHandler = (request: MockRequest) => MockResponse | Promise<MockResponse>;

/** Một dòng trong bảng route: method + regex khớp TOÀN BỘ path (nên có `^...$`). */
export interface MockRoute {
  method: MockMethod;
  pattern: RegExp;
  handler: MockHandler;
}
