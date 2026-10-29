import { describe, expect, it } from 'vitest';
import { getAreaSearchTerms, toAreaKey } from './areaMatch';

describe('toAreaKey (chuẩn hoá tên khu vực)', () => {
  it('bỏ dấu, hoa thường, tiền tố TP./Thành phố/Tỉnh và hậu tố ", Việt Nam"', () => {
    expect(toAreaKey('TP. Hồ Chí Minh')).toBe('ho chi minh');
    expect(toAreaKey('Thành phố Hồ Chí Minh, Việt Nam')).toBe('ho chi minh');
    expect(toAreaKey('TP Hà Nội')).toBe('ha noi');
    expect(toAreaKey('Tỉnh Nghệ An - Vietnam')).toBe('nghe an');
    expect(toAreaKey('  Đà   Nẵng ')).toBe('da nang');
  });

  it('bí danh của TP. Hồ Chí Minh cùng về một khoá', () => {
    const variants = ['TP.HCM', 'TPHCM', 'TP HCM', 'HCM', 'Sài Gòn', 'Saigon', 'Hồ Chí Minh', 'Thành phố Hồ Chí Minh'];
    expect(new Set(variants.map(toAreaKey))).toEqual(new Set(['ho chi minh']));
  });

  it('tỉnh đã sáp nhập hoặc không có trong 34 tỉnh KHÔNG được gán bí danh', () => {
    expect(toAreaKey('Bình Dương')).toBe('binh duong');
    expect(toAreaKey('Bà Rịa - Vũng Tàu')).toBe('ba ria - vung tau');
  });
});

describe('getAreaSearchTerms', () => {
  it('kèm bí danh của tên khu vực', () => {
    expect(getAreaSearchTerms('TP. Hồ Chí Minh')).toEqual(expect.arrayContaining(['sai gon', 'hcm', 'ho chi minh']));
  });
});
