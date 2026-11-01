import { HttpStatus } from '@nestjs/common';
// Khai báo kiểu `request.file()` / `isMultipart()` của plugin.
import type {} from '@fastify/multipart';
import type { FastifyRequest } from 'fastify';
import { BusinessException } from '../../../../common/exceptions/business.exception';
import { ErrorCode } from '../../../../common/exceptions/error-codes';

/** Một file đã đọc hết vào bộ nhớ từ request `multipart/form-data`. */
export interface UploadedFile {
  buffer: Buffer;
  mimeType: string;
  originalName: string;
}

const FILE_FIELD_NAME = 'file';
/** Mã lỗi `@fastify/multipart` khi file vượt `limits.fileSize`. */
const FILE_TOO_LARGE_CODE = 'FST_REQ_FILE_TOO_LARGE';

const badRequest = (message: string): BusinessException =>
  new BusinessException(
    ErrorCode.VALIDATION_FAILED,
    message,
    HttpStatus.BAD_REQUEST,
  );

const tooLarge = (maxBytes: number): BusinessException =>
  new BusinessException(
    ErrorCode.FILE_TOO_LARGE,
    'File vượt quá dung lượng cho phép',
    HttpStatus.PAYLOAD_TOO_LARGE,
    { maxBytes },
  );

/**
 * Đọc đúng MỘT file (field `file`) từ request multipart, giới hạn `maxBytes` ngay khi đang stream (không buffer
 * quá giới hạn). Vượt giới hạn => 413 `FILE_TOO_LARGE`; không phải multipart/thiếu file => 400.
 * Kiểm loại file/magic bytes là việc của tầng nghiệp vụ (`assertFileAllowed`).
 */
export const readSingleFile = async (
  request: FastifyRequest,
  maxBytes: number,
): Promise<UploadedFile> => {
  if (!request.isMultipart()) {
    throw badRequest('Yêu cầu phải là multipart/form-data');
  }
  try {
    const part = await request.file({
      limits: { fileSize: maxBytes, files: 1, fields: 5 },
    });
    if (!part || part.fieldname !== FILE_FIELD_NAME) {
      throw badRequest(`Thiếu file trong trường "${FILE_FIELD_NAME}"`);
    }
    const buffer = await part.toBuffer();
    return {
      buffer,
      mimeType: part.mimetype,
      originalName: part.filename ?? '',
    };
  } catch (error) {
    if ((error as { code?: string }).code === FILE_TOO_LARGE_CODE) {
      throw tooLarge(maxBytes);
    }
    throw error;
  }
};
