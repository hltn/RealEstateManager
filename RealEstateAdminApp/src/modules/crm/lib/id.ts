/**
 * Sinh id duy nhất phía client cho dữ liệu prototype, vd "LOG-lx3k9a-4f2c".
 * Khi nối backend, id do server cấp - helper này chỉ dùng cho dữ liệu tạm.
 */
export const createId = (prefix: string): string => {
  const timePart = Date.now().toString(36);
  const randomPart = Math.random().toString(36).slice(2, 6);
  return `${prefix}-${timePart}-${randomPart}`;
};
