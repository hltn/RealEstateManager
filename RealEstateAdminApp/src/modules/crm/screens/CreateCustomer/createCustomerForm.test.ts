import { describe, expect, it } from 'vitest';
import { createDefaultFormValues, toCreateCustomerInput, validateCreateCustomer, type CreateCustomerFormValues } from './createCustomerForm';

const valid = (overrides: Partial<CreateCustomerFormValues> = {}): CreateCustomerFormValues => ({
  ...createDefaultFormValues({ statusId: 'NOT_CONTACTED' }),
  fullName: 'Nguyễn Văn An',
  ...overrides,
});

describe('validateCreateCustomer (FR-02: chỉ họ tên bắt buộc)', () => {
  it('chỉ có họ tên -> hợp lệ (SĐT trống không báo lỗi)', () => {
    expect(validateCreateCustomer(valid())).toEqual({});
    expect(validateCreateCustomer(valid({ phone: '   ' }))).toEqual({});
  });

  it('thiếu họ tên -> lỗi họ tên, không lỗi SĐT', () => {
    const errors = validateCreateCustomer(valid({ fullName: '  ' }));
    expect(Object.keys(errors)).toEqual(['fullName']);
  });

  it('có nhập SĐT thì vẫn kiểm định dạng; số hợp lệ qua', () => {
    expect(validateCreateCustomer(valid({ phone: '123' })).phone).toMatch(/không hợp lệ/);
    expect(validateCreateCustomer(valid({ phone: '0912 345 678' }))).toEqual({});
  });
});

describe('toCreateCustomerInput', () => {
  it('SĐT rỗng/toàn khoảng trắng -> phone: null (khách chưa có SĐT)', () => {
    expect(toCreateCustomerInput(valid()).phone).toBeNull();
    expect(toCreateCustomerInput(valid({ phone: '  ' })).phone).toBeNull();
  });

  it('có SĐT -> giữ nguyên để backend chuẩn hóa', () => {
    expect(toCreateCustomerInput(valid({ phone: '0912 345 678' })).phone).toBe('0912 345 678');
  });

  it('KHÔNG có khóa careTeam trong payload (backend tự đặt người tạo làm PRIMARY)', () => {
    const input = toCreateCustomerInput(valid({ phone: '0912345678' }));
    expect(Object.keys(input)).not.toContain('careTeam');
    expect(input.fullName).toBe('Nguyễn Văn An');
  });
});
