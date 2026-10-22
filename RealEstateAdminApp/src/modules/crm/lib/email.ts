/** Email là trường tùy chọn: rỗng = hợp lệ; có nhập thì phải đúng định dạng `ten@mien.tld` (không khoảng trắng, tối đa 254 ký tự). */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;
export const EMAIL_MAX_LENGTH = 254;
export const INVALID_EMAIL_MESSAGE = 'Email không đúng định dạng (vd ten@congty.vn).';

export const isValidEmail = (value: string): boolean => {
  const email = value.trim();
  return email === '' || (email.length <= EMAIL_MAX_LENGTH && EMAIL_PATTERN.test(email));
};
