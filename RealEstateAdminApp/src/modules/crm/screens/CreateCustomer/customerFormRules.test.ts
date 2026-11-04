import { describe, expect, it } from 'vitest';
import {
  addUniqueItem,
  getFirstError,
  getFullNameError,
  getPhoneFormatError,
  isValidOptionalEmail,
  toggleItem,
} from './customerFormRules';

describe('trường bắt buộc (QT3): chỉ họ tên + SĐT', () => {
  it('họ tên trống hoặc quá 150 ký tự -> lỗi', () => {
    expect(getFullNameError('  ')).toMatch(/Vui lòng nhập/);
    expect(getFullNameError('a'.repeat(151))).toMatch(/tối đa 150/);
    expect(getFullNameError('Nguyễn Văn An')).toBeUndefined();
  });

  it('SĐT trống / sai định dạng -> lỗi; số VN hoặc quốc tế có + -> hợp lệ', () => {
    expect(getPhoneFormatError('')).toMatch(/Vui lòng nhập/);
    expect(getPhoneFormatError('123')).toMatch(/không hợp lệ/);
    expect(getPhoneFormatError('0912 345 678')).toBeUndefined();
    expect(getPhoneFormatError('+1 415 555 2671')).toBeUndefined();
  });

  it('email tuỳ chọn: rỗng hợp lệ, sai định dạng thì không', () => {
    expect(isValidOptionalEmail('')).toBe(true);
    expect(isValidOptionalEmail('a@b.vn')).toBe(true);
    expect(isValidOptionalEmail('a@b')).toBe(false);
  });
});

describe('tiện ích mảng', () => {
  it('addUniqueItem trim và bỏ trùng/rỗng', () => {
    expect(addUniqueItem(['a'], ' b ')).toEqual(['a', 'b']);
    expect(addUniqueItem(['a'], 'a')).toEqual(['a']);
    expect(addUniqueItem(['a'], '  ')).toEqual(['a']);
  });
  it('toggleItem bật/tắt phần tử', () => {
    expect(toggleItem(['a', 'b'], 'a')).toEqual(['b']);
    expect(toggleItem(['b'], 'a')).toEqual(['b', 'a']);
  });
  it('getFirstError lấy lỗi theo thứ tự trường', () => {
    expect(getFirstError({ phone: 'P', name: 'N' }, ['name', 'phone'])).toBe('N');
    expect(getFirstError({}, ['name'])).toBeUndefined();
  });
});
