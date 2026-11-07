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
 * Dãy 9-12 chữ số liền đứng riêng (CMND 9, CCCD 12, SĐT bàn/di động không khớp VN_PHONE,
 * Architecture 5.7). Chủ ý chấp nhận false positive: mọi dãy 9-12 chữ số đứng riêng đều bị
 * che thành [NATIONAL_ID], kể cả khi là mã khác (ưu tiên không lộ PII hơn log gỡ lỗi).
 * Dãy từ 13 chữ số trở lên (timestamp ms, mã dài) và ObjectId hex không bị ảnh hưởng nhờ biên.
 */
const NATIONAL_ID = /(?<![A-Za-z0-9])\d{9,12}(?![A-Za-z0-9])/g;
/** Chữ số fullwidth (U+FF10..U+FF19) — chuẩn hóa về ASCII trước khi quét để không qua mặt regex. */
const FULLWIDTH_DIGITS = /[\uFF10-\uFF19]/g;
const FULLWIDTH_ZERO = 0xff10;

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
  // Chỉ đổi chữ số fullwidth (không dùng NFKC để khỏi biến đổi các ký tự khác của log).
  input = input.replace(FULLWIDTH_DIGITS, (ch) =>
    String.fromCharCode(48 + ch.charCodeAt(0) - FULLWIDTH_ZERO),
  );
  const withoutDupKey = input.replace(DUP_KEY_BLOCK, 'dup key: {[REDACTED]}');
  const withoutEmail = withoutDupKey.includes('@')
    ? withoutDupKey.replace(EMAIL, '[EMAIL]')
    : withoutDupKey;
  return withoutEmail
    .replace(VN_PHONE, '[PHONE]')
    .replace(NATIONAL_ID, '[NATIONAL_ID]');
}
