import { useEffect, useState } from 'react';

/**
 * Trả về giá trị đã được debounce sau `delayMs` mili giây.
 * Dùng cho input tìm kiếm để tránh gọi API liên tục mỗi lần user gõ.
 */
export function useDebouncedValue<T>(value: T, delayMs = 400): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedValue(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debouncedValue;
}
