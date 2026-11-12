import '@testing-library/jest-dom/vitest';

/**
 * Node mới có `localStorage` thử nghiệm (cần `--localstorage-file`) che mất bản của jsdom nên `localStorage` có thể `undefined`.
 * Chỉ khi thiếu mới gắn bản trong bộ nhớ để test lớp lưu trữ chạy giống trình duyệt.
 */
const createMemoryStorage = (): Storage => {
  const entries = new Map<string, string>();
  return {
    get length() {
      return entries.size;
    },
    clear: () => entries.clear(),
    getItem: (key) => entries.get(key) ?? null,
    key: (index) => [...entries.keys()][index] ?? null,
    removeItem: (key) => {
      entries.delete(key);
    },
    setItem: (key, value) => {
      entries.set(key, String(value));
    },
  };
};

if (typeof window.localStorage === 'undefined' || typeof window.localStorage.clear !== 'function') {
  Object.defineProperty(window, 'localStorage', { value: createMemoryStorage(), configurable: true });
  Object.defineProperty(globalThis, 'localStorage', { value: window.localStorage, configurable: true });
}
