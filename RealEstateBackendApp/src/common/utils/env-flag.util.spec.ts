import { parseBooleanFlag } from './env-flag.util';

describe('parseBooleanFlag', () => {
  it.each(['true', 'TRUE', 'True', ' true ', '1', 'yes', 'YES', 'on', 'On'])(
    'chuỗi %p là bật (không phân biệt hoa thường, bỏ khoảng trắng)',
    (raw) => {
      expect(parseBooleanFlag(raw)).toBe(true);
    },
  );

  it.each(['true\r', 'true\r\n', '\ttrue\n', ' on\r'])(
    'chịu được CR/LF của file .env CRLF: %j là bật',
    (raw) => {
      expect(parseBooleanFlag(raw)).toBe(true);
    },
  );

  it.each([
    'false',
    'FALSE',
    '0',
    'no',
    'off',
    '',
    '   ',
    'abc',
    'tru',
    'truee',
    '2',
    'enabled',
    'true false',
  ])('chuỗi %p (sai/lạ/rỗng) là tắt, không đoán bật', (raw) => {
    expect(parseBooleanFlag(raw)).toBe(false);
  });

  it('nhận boolean thật: true bật, false tắt', () => {
    expect(parseBooleanFlag(true)).toBe(true);
    expect(parseBooleanFlag(false)).toBe(false);
  });

  it.each([[undefined], [null], [1], [0], [{}], [['true']]])(
    'kiểu khác chuỗi/boolean (%p) là tắt',
    (raw) => {
      expect(parseBooleanFlag(raw)).toBe(false);
    },
  );
});
