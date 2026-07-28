import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'async_hooks';

interface RequestContext {
  requestId: string;
}

/**
 * Singleton ALS instance — dùng chung giữa middleware và service.
 * Export trực tiếp để middleware có thể dùng mà không cần DI (tránh circular dependency).
 */
export const requestContextStorage = new AsyncLocalStorage<RequestContext>();

@Injectable()
export class RequestContextService {
  /**
   * Lấy Request ID từ AsyncLocalStorage context của request đang chạy.
   * Trả về 'unknown' nếu được gọi ngoài ngữ cảnh HTTP request (ví dụ: cron job, script).
   */
  getRequestId(): string {
    return requestContextStorage.getStore()?.requestId ?? 'unknown';
  }
}
