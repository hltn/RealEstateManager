import { describe, expect, it } from 'vitest';
import { formatPhoneDisplay, getPhoneSearchVariants, isValidPhone, maskPhoneDisplay, normalizePhone, toLocalDigits } from './phone';

describe('normalizePhone (04 §3.2.1)', () => {
  it.each([
    ['0912 345 678', '+84912345678'],
    ['+84 912-345-678', '+84912345678'],
    ['84912345678', '+84912345678'],
    ['(0912).345.678', '+84912345678'],
    ['02838221234', '+842838221234'],
  ])('%s -> %s', (input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
  });

  it('đổi đầu số 11 số cũ sang 10 số', () => {
    expect(normalizePhone('0162 123 4567')).toBe('+84321234567');
    expect(normalizePhone('01993456789')).toBe('+84593456789');
  });

  it('số nước ngoài phải có dấu +', () => {
    expect(normalizePhone('+1 415 555 2671')).toBe('+14155552671');
    expect(normalizePhone('14155552671')).toBeNull();
  });

  it.each(['', '123', '0112345678', '091234567', '+84 12'])('không hợp lệ: %s', (input) => {
    expect(normalizePhone(input)).toBeNull();
    expect(isValidPhone(input)).toBe(false);
  });
});

describe('hiển thị SĐT', () => {
  it('formatPhoneDisplay định dạng 4-3-3 nội địa, nước ngoài giữ E.164', () => {
    expect(formatPhoneDisplay('+84912345678')).toBe('0912 345 678');
    expect(formatPhoneDisplay('+14155552671')).toBe('+14155552671');
  });
  it('maskPhoneDisplay che 3 số cuối', () => {
    expect(maskPhoneDisplay('+84912345678')).toBe('0912 345 •••');
  });
  it('toLocalDigits cho tel:/Zalo', () => {
    expect(toLocalDigits('+84912345678')).toBe('0912345678');
  });
  it('biến thể tìm kiếm gồm 0..., 84..., số không đầu', () => {
    expect(getPhoneSearchVariants('+84912345678')).toEqual(['0912345678', '84912345678', '912345678']);
  });
});

describe('N1 hồi quy: số 0 thừa sau mã quốc gia không được tạo SĐT "khác"', () => {
  it.each([
    ['+84 0912 345 678'],
    ['+84-(0)912-345-678'],
    ['0084912345678'],
    ['0084 0912 345 678'],
    ['840912345678'],
    ['\t0912 345 678\n'],
    ['\n+84 912 345 678\t'],
  ])('%j -> +84912345678', (input) => {
    expect(normalizePhone(input)).toBe('+84912345678');
  });

  it.each([['+84 12345'], ['+84 0012 345 678'], ['+8412345678901'], ['0084 999']])('chặn số +84/0084 sai mẫu VN: %j', (input) => {
    expect(normalizePhone(input)).toBeNull();
  });

  it('0084 + mã nước ngoài -> E.164 nước ngoài', () => {
    expect(normalizePhone('0065 6123 4567')).toBe('+6561234567');
  });
});

describe('toZaloHref dùng chung toLocalDigits', () => {
  it('số VN -> 0xxxxxxxxx; số nước ngoài giữ chữ số', async () => {
    const { toZaloHref } = await import('./contact');
    expect(toZaloHref('+84 912 345 678')).toBe('https://zalo.me/0912345678');
    expect(toZaloHref('0084 0912 345 678')).toBe('https://zalo.me/0912345678');
    expect(toZaloHref('+65 6123 4567')).toBe('https://zalo.me/6561234567');
  });
});

describe('Th2 ký tự lạ bị từ chối; trunk 0 của số nước ngoài', () => {
  it.each([['0912abc345678'], ["'0912345678"], ['0912345678x'], ['09123#45678']])('từ chối %j (còn ký tự ngoài chữ số/phân cách)', (input) => {
    expect(normalizePhone(input)).toBeNull();
  });
  it.each([
    ['+44 07911 123456', '+447911123456'],
    ['+44 (0)7911 123456', '+447911123456'],
    ['0044 07911 123456', '+447911123456'],
    ['+33 (0)6 12 34 56 78', '+33612345678'],
    ['+1 415 555 2671', '+14155552671'],
  ])('%s -> %s', (input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
  });
});
