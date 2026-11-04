import { Transform } from 'class-transformer';

/**
 * Query dạng "lọc nhiều giá trị" (tài liệu 05 mục 1.4): `statusIds=a,b` hoặc lặp tham số `statusIds=a&statusIds=b`
 * thành mảng chuỗi đã cắt khoảng trắng, bỏ phần tử rỗng. Giá trị không phải chuỗi/mảng giữ nguyên để validator báo 400.
 * Kết hợp với `@ArrayMaxSize(50)` để giới hạn số giá trị.
 */
export const CsvList = (): PropertyDecorator =>
  Transform(({ value }: { value: unknown }) => {
    const parts = Array.isArray(value) ? value : [value];
    if (!parts.every((part) => typeof part === 'string')) return value;
    return parts
      .flatMap((part) => part.split(','))
      .map((part) => part.trim())
      .filter((part) => part.length > 0);
  });
