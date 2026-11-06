/**
 * Che PII (FR-15) trong chuỗi log. Hàm thuần, không phụ thuộc Nest/Winston.
 *
 * Thứ tự áp dụng quan trọng: khối `dup key` (E11000) trước, rồi email, rồi SĐT,
 * cuối cùng CCCD/CMND. Biên `(?<![A-Za-z0-9])…(?![A-Za-z0-9])` để KHÔNG che
 * nhầm ObjectId 24 hex, timestamp 13 số hay mã dài hơn.
 */

const DUP_KEY_BLOCK = /dup key:\s{0,20}\{[^}]{0,500}\}/gi; // giới hạn độ dài để tránh O(n^2) khi lặp "dup key: {"
/**
 * Email: local-part tối đa 64 ký tự, nhãn domain tối đa 63; lookbehind buộc khớp
 * bắt đầu ở đầu dãy ký tự hợp lệ, tránh O(n^2) (ReDoS) với chuỗi dài không có `@`.
 */
const EMAIL =
  /(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]{1,63}(?:\.[A-Za-z0-9-]{1,63})+/g;
/** SĐT VN: `0xxxxxxxxx`, `84xxxxxxxxx`, `+84…`, `0084…`; cho phép dấu cách, chấm, gạch giữa các chữ số. */
const VN_PHONE =
  /(?<![A-Za-z0-9])(?:\+84|0084|84|0)(?:[\s.()-]{0,2}\d){9}(?![A-Za-z0-9])/g;
/**
 * CCCD (12 số) và CMND (9 số) đứng riêng. Chủ ý chấp nhận false positive: mọi dãy
 * đúng 9 hoặc 12 chữ số đứng riêng đều bị che thành [NATIONAL_ID], kể cả khi là
 * mã khác (ưu tiên không lộ PII hơn log gỡ lỗi).
 */
const NATIONAL_ID = /(?<![A-Za-z0-9])(?:\d{12}|\d{9})(?![A-Za-z0-9])/g;

/**
 * Ngưỡng an toàn: chuỗi dài hơn mức này bị cắt (kèm dấu `[TRUNCATED n]`) trước khi
 * chạy regex, để thời gian xử lý luôn bị chặn trên (redactPii chạy đồng bộ ở mọi log).
 * Chọn cắt thay vì xử lý từng đoạn để không bỏ sót PII nằm ở ranh giới đoạn.
 */
export const MAX_REDACT_LENGTH = 100_000;

export function redactPii(text: string): string {
  if (typeof text !== 'string' || text.length === 0) return text;
  let input = text;
  if (input.length > MAX_REDACT_LENGTH) {
    input = `${input.slice(0, MAX_REDACT_LENGTH)}[TRUNCATED ${text.length - MAX_REDACT_LENGTH}]`;
  }
  const withoutDupKey = input.replace(DUP_KEY_BLOCK, 'dup key: {[REDACTED]}');
  const withoutEmail = withoutDupKey.includes('@')
    ? withoutDupKey.replace(EMAIL, '[EMAIL]')
    : withoutDupKey;
  return withoutEmail
    .replace(VN_PHONE, '[PHONE]')
    .replace(NATIONAL_ID, '[NATIONAL_ID]');
}
