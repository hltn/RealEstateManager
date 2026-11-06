import {
  CallHandler,
  ExecutionContext,
  HttpStatus,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { Observable } from 'rxjs';
import { BusinessException } from '../exceptions/business.exception';
import { ErrorCode } from '../exceptions/error-codes';

/** Độ sâu tối đa của body/query/params (số cấp object/mảng lồng nhau, gốc là cấp 1); sâu hơn bị từ chối (chống object lồng sâu). */
export const NOSQL_MAX_DEPTH = 10;

export const NOSQL_REJECT_MESSAGE =
  'Dữ liệu chứa ký tự/toán tử không được phép';

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor']);
/** Dạng `a[$ne]`, `a[__proto__]`: Fastify không parse lồng nên khóa nguyên văn còn nằm trong query. */
const BRACKET_OPERATOR = /\[\s*(\$|__proto__|constructor)/;

type Source = 'body' | 'query' | 'params';

function isForbiddenKey(key: string, strict: boolean): boolean {
  if (key.startsWith('$') || FORBIDDEN_KEYS.has(key)) return true;
  if (!strict) return false;
  return key.includes('.') || BRACKET_OPERATOR.test(key);
}

/**
 * Duyệt lặp (không đệ quy → không tràn stack) toàn bộ giá trị; trả `true` nếu có khóa bị cấm
 * hoặc vượt `NOSQL_MAX_DEPTH`. `strict` (query/params) chặn thêm khóa chứa `.` và dạng `a[$...]`.
 */
export function containsForbiddenKey(root: unknown, strict: boolean): boolean {
  if (root === null || typeof root !== 'object') return false;
  const stack: Array<{ value: object; depth: number }> = [
    { value: root, depth: 0 },
  ];
  while (stack.length > 0) {
    const { value, depth } = stack.pop()!;
    if (depth >= NOSQL_MAX_DEPTH) return true;
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item !== null && typeof item === 'object') {
          stack.push({ value: item, depth: depth + 1 });
        }
      }
      continue;
    }
    for (const key of Object.keys(value)) {
      if (isForbiddenKey(key, strict)) return true;
      const child = (value as Record<string, unknown>)[key];
      if (child !== null && typeof child === 'object') {
        stack.push({ value: child, depth: depth + 1 });
      }
    }
  }
  return false;
}

function isMultipart(request: FastifyRequest): boolean {
  const contentType = request.headers?.['content-type'];
  return (
    typeof contentType === 'string' &&
    contentType.toLowerCase().startsWith('multipart/')
  );
}

/**
 * Lớp chặn NoSQL operator injection ở tầng chung (FR-14, PT-037), đăng ký `APP_INTERCEPTOR`.
 * Thứ tự NestJS: middleware → guard → INTERCEPTOR → pipe (ValidationPipe) → handler, nên chạy sau
 * guard (request chưa đăng nhập vẫn nhận 401) và trước ValidationPipe/transform của DTO.
 *
 * - Từ chối khóa bắt đầu `$`, `__proto__`, `constructor` ở mọi cấp của body/query/params.
 * - Riêng query/params: từ chối thêm khóa chứa `.` và dạng `a[$...]`. Body KHÔNG chặn khóa chứa `.`
 *   (tránh vỡ `crawlConfig`).
 * - Bỏ qua body của multipart (stream/file do @fastify/multipart xử lý); query/params vẫn được kiểm.
 * - KHÔNG dùng `mongoose.set('sanitizeFilter')` toàn cục (sẽ phá truy vấn nội bộ dùng `$in`/`$ne`).
 */
@Injectable()
export class NoSqlOperatorInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();

    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const checks: Array<[Source, boolean]> = [
      ['query', true],
      ['params', true],
    ];
    if (!isMultipart(request)) checks.push(['body', false]);

    for (const [source, strict] of checks) {
      if (containsForbiddenKey(request[source], strict)) {
        throw new BusinessException(
          ErrorCode.VALIDATION_FAILED,
          NOSQL_REJECT_MESSAGE,
          HttpStatus.BAD_REQUEST,
        );
      }
    }
    return next.handle();
  }
}
