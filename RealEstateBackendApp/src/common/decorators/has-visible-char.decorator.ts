import { applyDecorators } from '@nestjs/common';
import { Matches } from 'class-validator';

/**
 * Ký tự "trống nhìn như trống" nhưng thuộc nhóm chữ/ký hiệu nên `\p{L}`/`\p{S}` vẫn khớp: Hangul filler
 * (U+115F, U+1160, U+3164, U+FFA0) và Braille blank (U+2800).
 */
const BLANK_LOOKALIKES = '\u115F\u1160\u3164\uFFA0\u2800';

/**
 * Có ít nhất một ký tự NHÌN THẤY ĐƯỢC: chữ, số, dấu câu hoặc ký hiệu/emoji (`\p{L}\p{N}\p{P}\p{S}`), trừ các ký tự trống
 * giả dạng (`BLANK_LOOKALIKES`). Khoảng trắng, ký tự điều khiển (`\p{Cc}`), ký tự định dạng vô hình (`\p{Cf}`: zero-width...)
 * và dấu kết hợp đứng một mình (`\p{M}`: U+034F, U+17B4, FE0F...) không tính.
 */
export const VISIBLE_CHAR_PATTERN = new RegExp(
  String.raw`(?![${BLANK_LOOKALIKES}])[\p{L}\p{N}\p{P}\p{S}]`,
  'u',
);

/**
 * Chuỗi bắt buộc có chữ nhìn thấy được. `trim()` không bỏ được ký tự vô hình (U+200B, U+3164...) nên lý do chỉ gồm các
 * ký tự đó vẫn lọt qua `@MinLength(1)`; decorator này chặn trường hợp đó (400). Giá trị không phải chuỗi để các
 * validator khác (`@IsString()`) báo lỗi.
 */
export const HasVisibleChar = (): PropertyDecorator =>
  applyDecorators(
    Matches(VISIBLE_CHAR_PATTERN, {
      message: '$property phải có ít nhất một ký tự nhìn thấy được',
    }),
  );
