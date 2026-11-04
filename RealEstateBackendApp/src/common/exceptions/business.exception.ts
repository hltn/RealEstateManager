import { HttpException, HttpStatus } from '@nestjs/common';
import { ErrorCode } from './error-codes';

/**
 * Exception nghiệp vụ dùng chung: mang theo `errorCode` (máy đọc) + `message`
 * tiếng Việt (người đọc) + `details` tùy chọn (dữ liệu để FE hiển thị/rẽ nhánh).
 *
 * `GlobalExceptionFilter` nhận ra class này và đưa `errorCode`/`details` vào JSON lỗi.
 * `details` chỉ chứa dữ liệu an toàn cho client — TUYỆT ĐỐI không nhét stack,
 * câu truy vấn, đường dẫn nội bộ hay PII không cần thiết.
 *
 * Ví dụ:
 *   throw new BusinessException(
 *     ErrorCode.PROJECT_IN_USE,
 *     'Dự án đang có khách hàng tham chiếu, không thể xóa',
 *     HttpStatus.CONFLICT,
 *     { customerCount: 12 },
 *   );
 */
export class BusinessException extends HttpException {
  readonly errorCode: ErrorCode | string;
  readonly details?: Record<string, unknown>;

  constructor(
    errorCode: ErrorCode | string,
    message: string,
    status: HttpStatus = HttpStatus.BAD_REQUEST,
    details?: Record<string, unknown>,
  ) {
    super({ statusCode: status, message, errorCode, details }, status);
    this.errorCode = errorCode;
    this.details = details;
  }
}
