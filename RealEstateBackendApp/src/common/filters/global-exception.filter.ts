import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { FastifyReply, FastifyRequest } from 'fastify';
import { BusinessException } from '../exceptions/business.exception';
import { ErrorCode } from '../exceptions/error-codes';
import { requestContextStorage } from '../services/request-context.service';

// Ép về `number` để so sánh với status dạng số mà không vướng rule so sánh enum.
const STATUS_BAD_REQUEST: number = HttpStatus.BAD_REQUEST;
const STATUS_PAYLOAD_TOO_LARGE: number = HttpStatus.PAYLOAD_TOO_LARGE;
const STATUS_UNSUPPORTED_MEDIA_TYPE: number = HttpStatus.UNSUPPORTED_MEDIA_TYPE;
const STATUS_SERVICE_UNAVAILABLE: number = HttpStatus.SERVICE_UNAVAILABLE;
const STATUS_INTERNAL_SERVER_ERROR: number = HttpStatus.INTERNAL_SERVER_ERROR;

const INTERNAL_ERROR_MESSAGE_VI =
  'Hệ thống đang gặp sự cố, vui lòng thử lại sau';

/**
 * Thông báo mặc định (tiếng Anh) do NestJS/guard sinh ra → tiếng Việt.
 * Chỉ dịch khi message KHỚP CHÍNH XÁC; message tự viết (đã có nghĩa) giữ nguyên.
 */
const DEFAULT_MESSAGE_VI: Record<string, string> = {
  'Bad Request': 'Yêu cầu không hợp lệ',
  Unauthorized: 'Bạn chưa đăng nhập hoặc phiên đăng nhập đã hết hạn',
  Forbidden: 'Bạn không có quyền thực hiện thao tác này',
  'Insufficient role': 'Bạn không có quyền thực hiện thao tác này',
  'Not Found': 'Không tìm thấy dữ liệu yêu cầu',
  Conflict: 'Dữ liệu xung đột, vui lòng tải lại và thử lại',
  'Payload Too Large': 'Dữ liệu gửi lên quá lớn',
  'Unsupported Media Type': 'Định dạng dữ liệu không được hỗ trợ',
  'Too Many Requests': 'Bạn thao tác quá nhanh, vui lòng thử lại sau',
  'ThrottlerException: Too Many Requests':
    'Bạn thao tác quá nhanh, vui lòng thử lại sau',
  'Internal Server Error': INTERNAL_ERROR_MESSAGE_VI,
  'Service Unavailable Exception':
    'Dịch vụ tạm thời không khả dụng, vui lòng thử lại sau',
  'Service Unavailable':
    'Dịch vụ tạm thời không khả dụng, vui lòng thử lại sau',
};

/** errorCode mặc định theo status cho exception thường (không phải BusinessException). */
const DEFAULT_ERROR_CODE_BY_STATUS: Partial<Record<number, ErrorCode>> = {
  [HttpStatus.UNAUTHORIZED]: ErrorCode.UNAUTHORIZED,
  [HttpStatus.FORBIDDEN]: ErrorCode.INSUFFICIENT_ROLE,
  [HttpStatus.NOT_FOUND]: ErrorCode.RESOURCE_NOT_FOUND,
  [HttpStatus.TOO_MANY_REQUESTS]: ErrorCode.RATE_LIMITED,
};

/** `/a/b?phone=09...` thành `/a/b` — không trả/ghi log query string. */
function stripQueryString(url: string): string {
  return url.split('?')[0];
}

interface ErrorPayload {
  statusCode: number;
  message: string | string[];
  timestamp: string;
  path: string;
  errorCode?: string;
  details?: Record<string, unknown>;
}

/**
 * Bộ lọc lỗi toàn cục — mọi response lỗi có dạng chuẩn
 * `{ statusCode, message, timestamp, path }` + tùy chọn `errorCode`, `details`
 * (tài liệu 05 mục 1.3; hai trường mở rộng chỉ xuất hiện khi có).
 *
 * Quy tắc an toàn:
 * - Lỗi không lường trước (không phải HttpException) → 500 + thông báo chung tiếng Việt.
 *   Stack/message gốc CHỈ ghi vào log máy chủ, KHÔNG trả ra response (mọi môi trường).
 * - HttpException 5xx (trừ BusinessException) cũng nhận thông báo chung; message gốc chỉ vào log.
 * - Không trả và không ghi log query string của URL (có thể chứa PII).
 * - `details` chỉ lấy từ BusinessException (do dev chủ động đặt).
 */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<FastifyReply>();
    const request = ctx.getRequest<FastifyRequest>();

    const payload = this.buildPayload(exception, request);

    if (payload.statusCode >= STATUS_INTERNAL_SERVER_ERROR) {
      this.logUnexpected(exception, request, payload.statusCode);
    }

    response.status(payload.statusCode).send(payload);
  }

  /** Dựng body lỗi từ exception: ưu tiên BusinessException → HttpException → lỗi 4xx của Fastify → 500. */
  private buildPayload(
    exception: unknown,
    request: FastifyRequest,
  ): ErrorPayload {
    // Bỏ query string: có thể chứa PII (SĐT, email) do client gửi lên.
    const base = {
      timestamp: new Date().toISOString(),
      path: stripQueryString(request.url),
    };

    if (exception instanceof BusinessException) {
      const payload: ErrorPayload = {
        statusCode: exception.getStatus(),
        message: this.translateMessage(this.extractMessage(exception)),
        ...base,
        errorCode: exception.errorCode,
      };
      if (exception.details) payload.details = exception.details;
      return payload;
    }

    if (exception instanceof HttpException) {
      const statusCode = exception.getStatus();
      const rawMessage = this.extractMessage(exception);
      const payload: ErrorPayload = {
        statusCode,
        // 5xx: luôn thông báo chung, message gốc (có thể chứa lỗi upstream/khóa API) chỉ vào log.
        message:
          statusCode >= STATUS_INTERNAL_SERVER_ERROR
            ? this.serverErrorMessage(statusCode)
            : this.translateMessage(rawMessage),
        ...base,
      };
      const errorCode = this.resolveDefaultErrorCode(statusCode, rawMessage);
      if (errorCode) payload.errorCode = errorCode;
      const componentStatuses = this.extractHealthComponents(exception);
      if (componentStatuses) payload.details = componentStatuses;
      return payload;
    }

    // Lỗi 4xx do chính Fastify ném (JSON hỏng, body quá lớn...): có statusCode nhưng
    // không phải HttpException. Trả đúng mã 4xx thay vì nuốt thành 500.
    const fastifyStatus = this.getFastifyClientErrorStatus(exception);
    if (fastifyStatus) {
      return {
        statusCode: fastifyStatus,
        message: this.fastifyClientErrorMessage(fastifyStatus),
        ...base,
      };
    }

    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: INTERNAL_ERROR_MESSAGE_VI,
      ...base,
      errorCode: ErrorCode.INTERNAL_ERROR,
    };
  }

  /**
   * Health check của Terminus ném 503 kèm trạng thái từng thành phần (`error`).
   * Đưa vào `details` để vận hành biết thành phần nào lỗi; message của indicator đã được
   * viết sẵn cho client nên an toàn (không chứa chi tiết nội bộ).
   */
  private extractHealthComponents(
    exception: HttpException,
  ): Record<string, unknown> | undefined {
    const res = exception.getResponse();
    if (
      exception.getStatus() === STATUS_SERVICE_UNAVAILABLE &&
      typeof res === 'object' &&
      (res as { status?: unknown }).status === 'error'
    ) {
      return (res as { error?: Record<string, unknown> }).error;
    }
    return undefined;
  }

  /** Lấy `message` từ response của HttpException (string | { message } | { message: string[] }). */
  private extractMessage(exception: HttpException): string | string[] {
    const res = exception.getResponse();
    if (typeof res === 'string') return res;
    if (res && typeof res === 'object' && 'message' in res) {
      return (res as { message: string | string[] }).message;
    }
    return exception.message;
  }

  private translateMessage(message: string | string[]): string | string[] {
    if (Array.isArray(message)) return message;
    return DEFAULT_MESSAGE_VI[message] ?? message;
  }

  private resolveDefaultErrorCode(
    status: number,
    message: string | string[],
  ): ErrorCode | undefined {
    // ValidationPipe trả message là mảng → coi là lỗi validate DTO.
    if (status === STATUS_BAD_REQUEST && Array.isArray(message)) {
      return ErrorCode.VALIDATION_FAILED;
    }
    if (status === STATUS_SERVICE_UNAVAILABLE) {
      return ErrorCode.SERVICE_UNAVAILABLE;
    }
    if (status >= STATUS_INTERNAL_SERVER_ERROR) {
      return ErrorCode.INTERNAL_ERROR;
    }
    return DEFAULT_ERROR_CODE_BY_STATUS[status];
  }

  private serverErrorMessage(status: number): string {
    return status === STATUS_SERVICE_UNAVAILABLE
      ? DEFAULT_MESSAGE_VI['Service Unavailable']
      : INTERNAL_ERROR_MESSAGE_VI;
  }

  private fastifyClientErrorMessage(status: number): string {
    if (status === STATUS_PAYLOAD_TOO_LARGE) {
      return DEFAULT_MESSAGE_VI['Payload Too Large'];
    }
    if (status === STATUS_UNSUPPORTED_MEDIA_TYPE) {
      return DEFAULT_MESSAGE_VI['Unsupported Media Type'];
    }
    return DEFAULT_MESSAGE_VI['Bad Request'];
  }

  private getFastifyClientErrorStatus(exception: unknown): number | null {
    if (typeof exception !== 'object' || exception === null) return null;
    const { statusCode, code } = exception as {
      statusCode?: unknown;
      code?: unknown;
    };
    const isFastifyError = typeof code === 'string' && code.startsWith('FST_');
    if (
      isFastifyError &&
      typeof statusCode === 'number' &&
      statusCode >= 400 &&
      statusCode < 500
    ) {
      return statusCode;
    }
    return null;
  }

  /** Ghi stack vào log máy chủ kèm requestId để truy vết (không gửi cho client). */
  private logUnexpected(
    exception: unknown,
    request: FastifyRequest,
    statusCode: number,
  ): void {
    const requestId = requestContextStorage.getStore()?.requestId ?? 'unknown';
    const stack =
      exception instanceof Error ? exception.stack : String(exception);
    // HttpException 5xx: message gốc không có trong response nên ghi vào log để truy vết.
    const detail =
      exception instanceof HttpException
        ? ` ${JSON.stringify(exception.getResponse()).slice(0, 500)}`
        : '';
    this.logger.error(
      `[${requestId}] ${request.method} ${stripQueryString(request.url)} -> ${statusCode}${detail}`,
      stack,
    );
  }
}
