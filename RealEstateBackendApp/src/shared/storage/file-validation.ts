import { HttpStatus } from '@nestjs/common';
import { BusinessException } from '../../common/exceptions/business.exception';
import { ErrorCode } from '../../common/exceptions/error-codes';

/** Chính sách kiểm tra file cho từng nghiệp vụ (loại cho phép + dung lượng tối đa). */
export interface FileValidationPolicy {
  /** MIME cho phép (chữ thường, không kèm `; charset=...`). */
  allowedMimeTypes: readonly string[];
  maxSizeBytes: number;
  /** errorCode trả về khi sai loại file (mỗi nghiệp vụ một mã, theo tài liệu 05 mục 5). */
  typeErrorCode: ErrorCode;
  /** Kiểm tra magic bytes (nội dung thật) khớp với MIME khai báo. */
  verifySignature: boolean;
}

const MB = 1024 * 1024;
const XLSX_MIME =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Ảnh đính kèm nhật ký: jpeg/png/webp, ≤ 5 MB (tài liệu 04 mục 7.4). */
export const ATTACHMENT_IMAGE_POLICY: FileValidationPolicy = {
  allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
  maxSizeBytes: 5 * MB,
  typeErrorCode: ErrorCode.ATTACHMENT_TYPE_INVALID,
  verifySignature: true,
};

/** File import khách hàng: csv/xlsx, ≤ 10 MB (tài liệu 05 mục 5). */
export const IMPORT_FILE_POLICY: FileValidationPolicy = {
  allowedMimeTypes: ['text/csv', XLSX_MIME],
  maxSizeBytes: 10 * MB,
  typeErrorCode: ErrorCode.IMPORT_FILE_TYPE_INVALID,
  verifySignature: true,
};

/** Phần mở rộng gắn vào tên file UUID (không bao giờ dùng tên gốc do client gửi). */
const EXTENSION_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'text/csv': 'csv',
  [XLSX_MIME]: 'xlsx',
};

export function extensionForMime(mimeType: string): string {
  return EXTENSION_BY_MIME[normalizeMime(mimeType)] ?? 'bin';
}

export function normalizeMime(mimeType: string): string {
  return mimeType.split(';')[0].trim().toLowerCase();
}

/** So khớp đầu file với chữ ký của MIME khai báo. CSV không có magic bytes: chỉ loại file nhị phân (có byte NUL). */
export function matchesSignature(mimeType: string, buffer: Buffer): boolean {
  switch (normalizeMime(mimeType)) {
    case 'image/jpeg':
      return (
        buffer.length >= 3 &&
        buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))
      );
    case 'image/png':
      return (
        buffer.length >= 8 &&
        buffer
          .subarray(0, 8)
          .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
      );
    case 'image/webp':
      return (
        buffer.length >= 12 &&
        buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
        buffer.subarray(8, 12).toString('ascii') === 'WEBP'
      );
    case XLSX_MIME:
      // xlsx là file ZIP: bắt đầu bằng "PK\x03\x04".
      return (
        buffer.length >= 4 &&
        buffer.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))
      );
    case 'text/csv':
      return !buffer.subarray(0, 8192).includes(0);
    default:
      return false;
  }
}

/**
 * Kiểm tra MIME + dung lượng (+ magic bytes nếu có buffer và policy yêu cầu).
 * Ném BusinessException 415 (sai loại) hoặc 413 (quá lớn). Gọi TRƯỚC khi chạm S3.
 */
export function assertFileAllowed(
  policy: FileValidationPolicy,
  file: { mimeType: string; size: number; buffer?: Buffer },
): void {
  const mime = normalizeMime(file.mimeType);

  if (!policy.allowedMimeTypes.includes(mime) || file.size <= 0) {
    throw new BusinessException(
      policy.typeErrorCode,
      'Loại file không được hỗ trợ hoặc file rỗng',
      HttpStatus.UNSUPPORTED_MEDIA_TYPE,
    );
  }
  if (file.size > policy.maxSizeBytes) {
    throw new BusinessException(
      ErrorCode.FILE_TOO_LARGE,
      'File vượt quá dung lượng cho phép',
      HttpStatus.PAYLOAD_TOO_LARGE,
      { maxBytes: policy.maxSizeBytes },
    );
  }
  if (
    policy.verifySignature &&
    file.buffer &&
    !matchesSignature(mime, file.buffer)
  ) {
    throw new BusinessException(
      policy.typeErrorCode,
      'Nội dung file không khớp với định dạng khai báo',
      HttpStatus.UNSUPPORTED_MEDIA_TYPE,
    );
  }
}

const SAFE_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9/_.-]*$/;
const MAX_KEY_LENGTH = 1024;

/**
 * Chặn khóa object nguy hiểm trước khi chạm S3 (path traversal, khóa rỗng/ẩn, ký tự lạ).
 * Chỉ cho `[A-Za-z0-9/_.-]`, ký tự đầu phải là chữ/số, không có segment rỗng (`//`, `/` cuối),
 * `.` hoặc `..`. Khóa hợp lệ do hệ thống sinh (`<prefix><uuid>.<ext>`); khóa lưu trong DB cũng
 * phải qua kiểm tra này trước khi download/delete/ký URL, phòng dữ liệu DB bị sửa.
 */
export function assertSafeKey(key: string): void {
  const isSafe =
    typeof key === 'string' &&
    key.length <= MAX_KEY_LENGTH &&
    SAFE_KEY_PATTERN.test(key) &&
    !key.split('/').some((segment) => ['', '.', '..'].includes(segment));
  if (!isSafe) {
    throw new Error('Khóa object lưu trữ không hợp lệ');
  }
}
