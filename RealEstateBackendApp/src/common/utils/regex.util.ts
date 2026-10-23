/**
 * Escape ký tự đặc biệt của RegExp để đưa chuỗi người dùng nhập vào `$regex` an toàn
 * (chống regex injection / ReDoS do người dùng tự chèn `.*`, `(a+)+`...).
 */
export const escapeRegex = (text: string): string =>
  text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
