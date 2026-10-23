import {
  maskPhone,
  normalizePhone,
  phoneSearchVariants,
} from './phone-normalizer.util';

describe('normalizePhone (tài liệu 04 mục 3.2.1)', () => {
  it.each([
    ['0912345678', '+84912345678'],
    ['0912 345 678', '+84912345678'],
    ['(091) 234-5678', '+84912345678'],
    ['0912.345.678', '+84912345678'],
    ['84912345678', '+84912345678'],
    ['+84 912 345 678', '+84912345678'],
    ['0084912345678', '+84912345678'],
  ])('%s => %s', (input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
  });

  it('đổi đầu số 11 số cũ sang 10 số mới (0162 -> 032, 0120 -> 070, 0199 -> 059)', () => {
    expect(normalizePhone('01621234567')).toBe('+84321234567');
    expect(normalizePhone('+841621234567')).toBe('+84321234567');
    expect(normalizePhone('01201234567')).toBe('+84701234567');
    expect(normalizePhone('01991234567')).toBe('+84591234567');
  });

  it('số nước ngoài phải có dấu +', () => {
    expect(normalizePhone('+1 415 555 2671')).toBe('+14155552671');
    expect(normalizePhone('4155552671')).toBeNull();
  });

  it.each(['', 'abc', '12345', '091234567', '0912345678901234567890123', '+'])(
    'không hợp lệ: "%s"',
    (input) => {
      expect(normalizePhone(input)).toBeNull();
    },
  );

  it('hai cách viết cùng số cho cùng kết quả (cơ sở của unique phone)', () => {
    expect(normalizePhone('0912345678')).toBe(
      normalizePhone('+84-912-345-678'),
    );
  });
});

describe('phoneSearchVariants / maskPhone', () => {
  it('số VN có dạng 0xxx và 84xxx; số ngoài chỉ có dạng toàn chữ số', () => {
    expect(phoneSearchVariants('+84912345678')).toEqual([
      '0912345678',
      '84912345678',
    ]);
    expect(phoneSearchVariants('+14155552671')).toEqual(['14155552671']);
  });

  it('che số: chỉ lộ 4 ký tự đầu và 3 số cuối, không lộ số đầy đủ', () => {
    const masked = maskPhone('+84912345678');
    expect(masked).toBe('0912 ••• 678');
    expect(masked).not.toContain('345');
    expect(maskPhone('+14155552671')).toBe('+141 ••• 671');
  });
});
