import { Transform } from 'class-transformer';

/** Cắt khoảng trắng đầu/cuối của chuỗi trước khi validate (giá trị không phải chuỗi giữ nguyên để validator báo lỗi). */
export const Trim = (): PropertyDecorator =>
  Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  );
