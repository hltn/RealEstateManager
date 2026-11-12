import { applyDecorators } from '@nestjs/common';
import { IsString, MaxLength, MinLength } from 'class-validator';

/** Độ dài tối đa của mã danh mục (`code`) nhận từ request (FR-40); mã thật ngắn hơn nhiều, đây chỉ là chặn trên. */
export const CATALOG_CODE_MAX_LENGTH = 60;

/**
 * Mã danh mục (`statusCode`, `sourceCode`, `areaCode`, `projectCodes`...) gửi từ request (FR-40): chuỗi không rỗng,
 * tối đa `CATALOG_CODE_MAX_LENGTH` ký tự. Việc mã có tồn tại/còn hoạt động hay không do `CustomerRefsService` kiểm.
 * `each: true` cho mảng mã.
 */
export const CatalogCode = (
  options: { each?: boolean } = {},
): PropertyDecorator =>
  applyDecorators(
    IsString(options),
    MinLength(1, options),
    MaxLength(CATALOG_CODE_MAX_LENGTH, options),
  );
