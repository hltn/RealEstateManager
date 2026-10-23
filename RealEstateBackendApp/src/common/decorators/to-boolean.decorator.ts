import { Transform } from 'class-transformer';

/**
 * Chuyển query string `"true"`/`"false"` thành boolean thật trước khi `@IsBoolean()` kiểm tra.
 * (Mặc định class-transformer ép chuỗi "false" thành `true` nếu dùng `enableImplicitConversion`.)
 * Giá trị lạ được giữ nguyên để `@IsBoolean()` báo 400.
 */
export const ToBoolean = (): PropertyDecorator =>
  Transform(({ value }: { value: unknown }) => {
    if (value === 'true' || value === true) return true;
    if (value === 'false' || value === false) return false;
    return value;
  });
