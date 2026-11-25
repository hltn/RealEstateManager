import { describe, expect, it } from 'vitest';
import { formatCustomerCode, getNextCustomerCode, parseCustomerCodeSequence } from './customerCode';

describe('mã khách KH-######', () => {
  it('formatCustomerCode: đệm tối thiểu 6 chữ số, quá 999.999 thì dài ra', () => {
    expect(formatCustomerCode(1)).toBe('KH-000001');
    expect(formatCustomerCode(999_999)).toBe('KH-999999');
    expect(formatCustomerCode(1_000_000)).toBe('KH-1000000');
  });

  it('parseCustomerCodeSequence: đọc số thứ tự; sai định dạng/null -> null', () => {
    expect(parseCustomerCodeSequence('KH-000012')).toBe(12);
    expect(parseCustomerCodeSequence('KH-1000000')).toBe(1_000_000);
    for (const bad of ['KH-12', 'kh-000012', 'KH-00001a', '', null, undefined]) expect(parseCustomerCodeSequence(bad)).toBeNull();
  });

  it('getNextCustomerCode: lớn nhất + 1, bỏ qua mã null/sai; tập rỗng -> KH-000001', () => {
    expect(getNextCustomerCode([])).toBe('KH-000001');
    expect(getNextCustomerCode([{ customerCode: 'KH-000003' }, { customerCode: null }, { customerCode: 'KH-000010' }, { customerCode: 'rác' }])).toBe('KH-000011');
  });
});
