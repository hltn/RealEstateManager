import { useEffect, useState } from 'react';

/** Giá trị chỉ cập nhật sau `delayMs` kể từ lần đổi cuối (dùng cho ô tìm kiếm gọi lớp dữ liệu). */
export const useDebouncedValue = <T,>(value: T, delayMs = 250): T => {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
};
