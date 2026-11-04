import { ValidateIf } from 'class-validator';

/**
 * Field tùy chọn trong PATCH nhưng KHÔNG được là `null`: vắng mặt (undefined) thì bỏ qua, có mặt thì phải qua
 * các validator còn lại — `null` sẽ trượt `@IsString()/@IsInt()/@IsBoolean()...` và trả 400.
 *
 * Khác `@IsOptional()` (bỏ qua validate cả khi `null`, khiến `null` lọt vào DB). Field cho phép `null` có chủ đích
 * (vd `parentId=null` = chuyển về gốc) vẫn dùng `@IsOptional()`.
 */
export const OptionalNotNull = (): PropertyDecorator =>
  ValidateIf((_object: unknown, value: unknown) => value !== undefined);
