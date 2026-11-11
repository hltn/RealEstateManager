import { describe, expect, it } from 'vitest';
import { formatPhoneDisplay, getPhoneSearchVariants, isValidPhone, maskPhoneDisplay, normalizePhone, toLocalDigits } from './phone';

describe('lib/phone: null-safe (khách chưa có SĐT)', () => {
  it.each([null, undefined])('không ném lỗi với %s', (value) => {
    expect(() => normalizePhone(value)).not.toThrow();
    expect(normalizePhone(value)).toBeNull();
    expect(isValidPhone(value)).toBe(false);
    expect(formatPhoneDisplay(value)).toBe('');
    expect(toLocalDigits(value)).toBe('');
    expect(getPhoneSearchVariants(value)).toEqual([]);
    expect(maskPhoneDisplay(value)).toBe('');
  });

  it('vẫn chuẩn hoá đúng số hợp lệ', () => {
    expect(normalizePhone('0912 345 678')).toBe('+84912345678');
    expect(formatPhoneDisplay('+84912345678')).toBe('0912 345 678');
    expect(toLocalDigits('+84912345678')).toBe('0912345678');
    expect(maskPhoneDisplay('+84912345678')).toBe('0912 345 •••');
    expect(getPhoneSearchVariants('+84912345678')).toEqual(['0912345678', '84912345678', '912345678']);
  });

  it('chuỗi rỗng không hợp lệ nhưng không ném lỗi', () => {
    expect(normalizePhone('')).toBeNull();
    expect(isValidPhone('')).toBe(false);
  });

  it('số sai mẫu: hiển thị giữ chuỗi người nhập đã cắt khoảng trắng', () => {
    expect(formatPhoneDisplay(' abc ')).toBe('abc');
  });
});
