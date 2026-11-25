import { describe, expect, it } from 'vitest';
import { formatPurchasePurposes } from './customerAdapters';

const FIELD = {
  optionItems: [
    { value: 'LIVING', label: 'Để ở (đã đổi tên)', isActive: true },
    { value: 'INVEST_RENT', label: 'Đầu tư cho thuê', isActive: true },
    { value: 'OLD', label: 'Lựa chọn đã tắt', isActive: false },
  ],
};

describe('formatPurchasePurposes', () => {
  it('ưu tiên nhãn theo cấu hình hiện hành, nối bằng dấu phẩy + khoảng trắng', () => {
    expect(formatPurchasePurposes(['LIVING', 'INVEST_RENT'], FIELD)).toBe('Để ở (đã đổi tên), Đầu tư cho thuê');
  });

  it('lựa chọn đã tắt trong cấu hình vẫn hiện đúng nhãn', () => {
    expect(formatPurchasePurposes(['OLD'], FIELD)).toBe('Lựa chọn đã tắt');
  });

  it('chưa có cấu hình trường -> dùng nhãn mặc định theo mã', () => {
    expect(formatPurchasePurposes(['LIVING', 'FOR_CHILD'])).toBe('Ở thực, Mua cho con');
    expect(formatPurchasePurposes(['RESORT'], {})).toBe('Nghỉ dưỡng');
  });

  it('mã lạ (không có trong cấu hình lẫn bảng mặc định) -> hiện nguyên mã', () => {
    expect(formatPurchasePurposes(['LIVING', 'UNKNOWN_CODE'], FIELD)).toBe('Để ở (đã đổi tên), UNKNOWN_CODE');
  });

  it('rỗng -> chuỗi rỗng', () => {
    expect(formatPurchasePurposes([], FIELD)).toBe('');
  });
});
