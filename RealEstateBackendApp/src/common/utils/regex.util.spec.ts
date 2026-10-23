import { escapeRegex } from './regex.util';

describe('escapeRegex', () => {
  it('vô hiệu hóa mọi ký tự đặc biệt để chuỗi người dùng chỉ khớp theo nghĩa đen', () => {
    const hostile = '.*(a+)+[x]^$|\\?{1}';
    const regex = new RegExp(escapeRegex(hostile));
    expect(regex.test(hostile)).toBe(true);
    // Không còn là mẫu "bắt mọi thứ": chuỗi khác không được khớp.
    expect(regex.test('abc')).toBe(false);
  });

  it('giữ nguyên chữ có dấu và khoảng trắng', () => {
    expect(escapeRegex('Quận 7 - Nhà Bè')).toBe('Quận 7 - Nhà Bè');
  });
});
