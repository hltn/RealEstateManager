import { describe, expect, it } from 'vitest';
import { displayCustomerCode, formatCustomerCode, nextCustomerCode, parseCustomerCode } from './customerCode';

describe('lib/customerCode', () => {
  it('formatCustomerCode đệm 6 chữ số và không cắt số lớn', () => {
    expect(formatCustomerCode(1)).toBe('KH-000001');
    expect(formatCustomerCode(123)).toBe('KH-000123');
    expect(formatCustomerCode(1_000_000)).toBe('KH-1000000');
  });

  it.each([0, -1, 1.5, Number.NaN])('formatCustomerCode(%s) = null', (value) => {
    expect(formatCustomerCode(value)).toBeNull();
  });

  it('parseCustomerCode đọc mã hợp lệ (không phân biệt hoa thường) và loại mã sai', () => {
    expect(parseCustomerCode('KH-000123')).toBe(123);
    expect(parseCustomerCode(' kh-000007 ')).toBe(7);
    expect(parseCustomerCode('KH-12')).toBeNull();
    expect(parseCustomerCode('AB-000123')).toBeNull();
    expect(parseCustomerCode(null)).toBeNull();
    expect(parseCustomerCode(undefined)).toBeNull();
  });

  it('nextCustomerCode nối tiếp mã lớn nhất, bỏ qua null/sai mẫu', () => {
    expect(nextCustomerCode([])).toBe('KH-000001');
    expect(nextCustomerCode([null, undefined, 'xx'])).toBe('KH-000001');
    expect(nextCustomerCode(['KH-000002', null, 'KH-000010', 'KH-000003'])).toBe('KH-000011');
  });

  it('displayCustomerCode: khách chưa có mã -> rỗng', () => {
    expect(displayCustomerCode(null)).toBe('');
    expect(displayCustomerCode('KH-000001')).toBe('KH-000001');
  });
});
