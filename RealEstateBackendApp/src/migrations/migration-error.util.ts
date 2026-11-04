/** Độ dài tối đa của `message` ghi vào `migration-last-error` (và in ra màn hình). */
export const MAX_ERROR_MESSAGE_LENGTH = 500;

/** Chuỗi kết nối MongoDB (có thể chứa mật khẩu), bắt cả `mongodb://` lẫn `mongodb+srv://`. */
const MONGO_URI_PATTERN = /mongodb(?:\+srv)?:\/\/\S+/gi;

/** Phần `user:password@` của bất kỳ URL nào (phòng khi URI bị cắt/ghi lại không còn tiền tố `mongodb://`). */
const URL_USERINFO_PATTERN = /[^\s/@:'"]+:[^\s/@'"]+@/g;

/**
 * Chuẩn hóa thông điệp lỗi trước khi lưu/in: lọc mọi chuỗi kết nối Mongo (che cả user:password) rồi cắt còn tối đa
 * 500 ký tự. Lọc TRƯỚC khi cắt để không để lộ nửa mật khẩu ở phần bị cắt.
 */
export const sanitizeErrorMessage = (error: unknown): string => {
  const raw =
    error instanceof Error
      ? error.message || error.name
      : typeof error === 'string'
        ? error
        : 'Lỗi không xác định';
  return raw
    .replace(MONGO_URI_PATTERN, '[URI đã lọc]')
    .replace(URL_USERINFO_PATTERN, '[thông tin đăng nhập đã lọc]@')
    .slice(0, MAX_ERROR_MESSAGE_LENGTH);
};
