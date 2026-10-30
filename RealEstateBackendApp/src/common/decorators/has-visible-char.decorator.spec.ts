import { VISIBLE_CHAR_PATTERN } from './has-visible-char.decorator';

// Mọi ký tự vô hình viết bằng mã \u để không bị mất khi sao chép/định dạng file.
describe('VISIBLE_CHAR_PATTERN', () => {
  it.each([
    ['chữ thường', 'Khách bỏ'],
    ['chữ có dấu tiếng Việt', 'Đổi ý, không mua'],
    ['một ký tự', 'x'],
    ['chữ số', '123'],
    ['dấu câu', '...'],
    ['emoji', '\u{1F44D}'],
    ['ký hiệu', '$'],
    ['chữ lẫn ký tự vô hình', '\u200Bx\u200B'],
    ['hai chữ cách nhau bởi zero-width', 'a\u200Bb'],
  ])('hợp lệ: %s', (_name, value) => {
    expect(VISIBLE_CHAR_PATTERN.test(value)).toBe(true);
  });

  it.each([
    ['rỗng', ''],
    ['khoảng trắng', ' \t\n'],
    ['zero-width space', '\u200B'],
    [
      'ký tự định dạng (ZWJ, word joiner, BOM, dấu bidi)',
      '\u200D\u2060\uFEFF\u200E',
    ],
    ['trộn khoảng trắng và vô hình', ' \u200B \u2060'],
    ['Hangul filler', '\u3164\u115F\u1160\uFFA0'],
    ['Braille blank', '\u2800'],
    ['dấu kết hợp đứng một mình', '\u034F\u17B4\u17B5\uFE0F'],
    ['ký tự điều khiển', '\u0007\u0000'],
    ['trộn các loại trống', ' \u3164\u2800\u200B\u0007\uFE0F'],
  ])('không hợp lệ: %s', (_name, value) => {
    expect(VISIBLE_CHAR_PATTERN.test(value)).toBe(false);
  });
});
