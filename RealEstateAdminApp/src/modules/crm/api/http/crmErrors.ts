/**
 * Chuẩn hóa lỗi của API CRM (05 §1.3, §5) thành `ApiError` với thông báo tiếng Việt thân thiện.
 * - KHÔNG ghi console/log nội dung lỗi (message/details có thể chứa PII như tên khách, SĐT).
 * - Backend là nguồn sự thật về quyền; ở đây chỉ dịch mã lỗi để người dùng hiểu việc gì đã xảy ra.
 */
import { isAxiosError } from 'axios';
import type { ApiError } from '../types';

interface RawErrorBody {
  statusCode?: number;
  message?: string | string[];
  errorCode?: string;
  details?: Record<string, unknown>;
}

export const NETWORK_ERROR_CODE = 'NETWORK_ERROR';
export const TIMEOUT_ERROR_CODE = 'TIMEOUT';

const DEFAULT_CODE_BY_STATUS: Record<number, string> = {
  400: 'VALIDATION_FAILED',
  401: 'UNAUTHORIZED',
  403: 'INSUFFICIENT_ROLE',
  404: 'RESOURCE_NOT_FOUND',
  409: 'CONFLICT',
  413: 'FILE_TOO_LARGE',
  415: 'UNSUPPORTED_MEDIA_TYPE',
  429: 'RATE_LIMITED',
  500: 'INTERNAL_ERROR',
  502: 'SERVICE_UNAVAILABLE',
  503: 'SERVICE_UNAVAILABLE',
  504: 'SERVICE_UNAVAILABLE',
};

/** Thông báo dùng khi máy chủ không có `message` tiếng Việt phù hợp (ưu tiên thông báo của server nếu có nghĩa). */
const MESSAGE_BY_CODE: Record<string, string> = {
  [NETWORK_ERROR_CODE]: 'Không kết nối được máy chủ. Vui lòng kiểm tra mạng và thử lại.',
  [TIMEOUT_ERROR_CODE]: 'Máy chủ phản hồi quá chậm. Vui lòng thử lại.',
  UNAUTHORIZED: 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.',
  INSUFFICIENT_ROLE: 'Bạn không có quyền thực hiện thao tác này.',
  SERVICE_UNAVAILABLE: 'Hệ thống đang bận hoặc đang bảo trì. Vui lòng thử lại sau ít phút.',
  INTERNAL_ERROR: 'Hệ thống đang gặp sự cố. Vui lòng thử lại sau.',
  IDEMPOTENCY_IN_PROGRESS: 'Yêu cầu đang được xử lý, vui lòng không gửi lại.',
  VERSION_CONFLICT: 'Hồ sơ vừa được người khác cập nhật. Vui lòng tải lại để xem thay đổi mới nhất.',
  CUSTOMER_NOT_FOUND: 'Không tìm thấy khách hàng hoặc bạn không có quyền xem khách này.',
  RESOURCE_NOT_FOUND: 'Không tìm thấy dữ liệu hoặc bạn không có quyền xem.',
  FILE_TOO_LARGE: 'Tệp quá lớn (tối đa 5 MB).',
  ATTACHMENT_TYPE_INVALID: 'Chỉ nhận ảnh JPEG, PNG hoặc WebP hợp lệ.',
  ATTACHMENT_LIMIT_EXCEEDED: 'Mỗi ghi chú tối đa 5 ảnh.',
};

const MAX_VALIDATION_LINES = 3;

/** Thông báo mặc định tiếng Anh của NestJS/guard (server thường đã dịch; phòng khi lọt ra) -> dùng thông báo theo mã lỗi. */
const ENGLISH_DEFAULT_MESSAGES = new Set(['Bad Request', 'Unauthorized', 'Forbidden', 'Insufficient role', 'Not Found', 'Conflict', 'Too Many Requests', 'Internal Server Error', 'Service Unavailable', 'Payload Too Large', 'Unsupported Media Type']);

/** Thông báo cho 429: có thời gian chờ thì nêu rõ. */
export const buildRateLimitMessage = (details?: Record<string, unknown>): string => {
  const seconds = Number(details?.retryAfterSeconds);
  if (Number.isFinite(seconds) && seconds > 0) return `Bạn thao tác quá nhanh. Vui lòng thử lại sau ${Math.ceil(seconds)} giây.`;
  return 'Bạn thao tác quá nhanh. Vui lòng thử lại sau ít phút.';
};

const pickMessage = (body: RawErrorBody, code: string, status: number): string => {
  if (code === 'RATE_LIMITED') return buildRateLimitMessage(body.details);
  if (Array.isArray(body.message)) {
    const lines = body.message.filter((line) => typeof line === 'string' && line.trim()).slice(0, MAX_VALIDATION_LINES);
    return lines.length > 0 ? lines.join('\n') : 'Dữ liệu chưa hợp lệ. Vui lòng kiểm tra lại.';
  }
  // 5xx: không hiển thị nguyên văn message của server.
  if (status >= 500) return MESSAGE_BY_CODE[code] ?? MESSAGE_BY_CODE.INTERNAL_ERROR;
  if (typeof body.message === 'string' && body.message.trim() && !ENGLISH_DEFAULT_MESSAGES.has(body.message)) return body.message;
  return MESSAGE_BY_CODE[code] ?? 'Không thực hiện được thao tác. Vui lòng thử lại.';
};

/** Biến lỗi bất kỳ (AxiosError, Error...) thành `ApiError`. */
export const normalizeApiError = (error: unknown): ApiError => {
  if (isAxiosError(error)) {
    if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
      return { statusCode: 0, errorCode: TIMEOUT_ERROR_CODE, message: MESSAGE_BY_CODE[TIMEOUT_ERROR_CODE] };
    }
    if (error.response) {
      const status = error.response.status;
      const body = (typeof error.response.data === 'object' && error.response.data !== null ? error.response.data : {}) as RawErrorBody;
      const errorCode = body.errorCode ?? DEFAULT_CODE_BY_STATUS[status] ?? 'UNKNOWN_ERROR';
      const apiError: ApiError = { statusCode: status, errorCode, message: pickMessage(body, errorCode, status) };
      if (body.details) apiError.details = body.details;
      return apiError;
    }
    return { statusCode: 0, errorCode: NETWORK_ERROR_CODE, message: MESSAGE_BY_CODE[NETWORK_ERROR_CODE] };
  }
  return { statusCode: 0, errorCode: 'UNKNOWN_ERROR', message: 'Không thực hiện được thao tác. Vui lòng thử lại.' };
};

/** Hướng dẫn khi 409 `VERSION_CONFLICT`: dữ liệu mới nhất đã được tải lại, người dùng kiểm tra rồi thử lại. */
export const VERSION_CONFLICT_GUIDE = 'Hồ sơ vừa được người khác cập nhật. Dữ liệu mới nhất đã được tải lại, vui lòng kiểm tra rồi thực hiện lại.';

/** Thông báo hiển thị cho lỗi ghi: riêng xung đột phiên bản có hướng dẫn rõ ràng. */
export const describeWriteError = (error: ApiError): string => (error.errorCode === 'VERSION_CONFLICT' ? VERSION_CONFLICT_GUIDE : error.message);

/** Lỗi có phải do ngoài phạm vi / không tồn tại (UI hiện màn "Không tìm thấy"). */
export const isNotFoundError = (error: ApiError): boolean => error.statusCode === 404;

export const isVersionConflict = (error: ApiError): boolean => error.errorCode === 'VERSION_CONFLICT';

/** Lỗi tạm thời đáng thử lại (mạng, 502/503/504); KHÔNG retry 4xx và 429. */
export const isRetryableError = (error: ApiError): boolean =>
  error.errorCode === NETWORK_ERROR_CODE || error.errorCode === TIMEOUT_ERROR_CODE || [502, 503, 504].includes(error.statusCode);

/** Lỗi dùng được cho `throw` trong `queryFn` để React Query giữ nguyên `ApiError`. */
export class CrmApiException extends Error {
  readonly apiError: ApiError;

  constructor(apiError: ApiError) {
    super(apiError.message);
    this.name = 'CrmApiException';
    this.apiError = apiError;
  }
}

/** Lấy `ApiError` từ giá trị bắt được ở `catch`/`error` của React Query. */
export const toApiError = (error: unknown): ApiError => (error instanceof CrmApiException ? error.apiError : normalizeApiError(error));
