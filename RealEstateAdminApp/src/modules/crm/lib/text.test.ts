import { describe, expect, it } from 'vitest';
import { includesVietnamese, normalizeVietnamese, toSlug } from './text';

describe('normalizeVietnamese', () => {
  it('bỏ dấu, đ -> d, chữ thường, gộp khoảng trắng', () => {
    expect(normalizeVietnamese('  Nguyễn   Văn ĐỨC ')).toBe('nguyen van duc');
    expect(normalizeVietnamese('Phạm Quỳnh Trang')).toBe('pham quynh trang');
  });

  it('chuỗi NFC và NFD cho cùng kết quả', () => {
    expect(normalizeVietnamese('Hồ'.normalize('NFD'))).toBe(normalizeVietnamese('Hồ'.normalize('NFC')));
  });
});

describe('includesVietnamese', () => {
  it('"nguyen" khớp "Nguyễn", không phân biệt hoa thường', () => {
    expect(includesVietnamese('Nguyễn Văn An', 'NGUYEN')).toBe(true);
    expect(includesVietnamese('Đặng Quốc Huy', 'dang quoc')).toBe(true);
  });
  it('từ khoá rỗng luôn khớp, từ khoá khác thì không', () => {
    expect(includesVietnamese('An', '   ')).toBe(true);
    expect(includesVietnamese('An', 'Bình')).toBe(false);
  });
});

describe('toSlug', () => {
  it('chuyển thành mã ASCII', () => {
    expect(toSlug('Khu Đông TP.HCM')).toBe('khu_dong_tp_hcm');
  });
});
