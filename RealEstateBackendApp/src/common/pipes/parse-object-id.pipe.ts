import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';
import { isValidObjectId } from 'mongoose';

const OBJECT_ID_PATTERN = /^[a-f\d]{24}$/i;

/**
 * Kiểm `:id` trên URL là ObjectId hợp lệ (24 ký tự hex) và trả về CHÍNH chuỗi đó.
 * Không có pipe này, id sai định dạng làm `new Types.ObjectId(id)` ném lỗi => 500.
 * Trả chuỗi (không phải ObjectId) để không vướng ValidationPipe toàn cục khi khai báo kiểu tham số.
 */
@Injectable()
export class ParseObjectIdPipe implements PipeTransform<string, string> {
  transform(value: string): string {
    if (
      typeof value !== 'string' ||
      !OBJECT_ID_PATTERN.test(value) ||
      !isValidObjectId(value)
    ) {
      // message dạng mảng => GlobalExceptionFilter gán errorCode VALIDATION_FAILED.
      throw new BadRequestException(['id không hợp lệ']);
    }
    return value;
  }
}
