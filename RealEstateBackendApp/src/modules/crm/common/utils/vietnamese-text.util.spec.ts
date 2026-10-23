import { normalizeVietnamese } from './vietnamese-text.util';

describe('normalizeVietnamese', () => {
  it('bỏ dấu, đổi đ/Đ thành d, về chữ thường', () => {
    expect(normalizeVietnamese('Đường Nguyễn Huệ, Quận Bình Thạnh')).toBe(
      'duong nguyen hue, quan binh thanh',
    );
  });

  it('chuẩn hóa cả chuỗi ở dạng tổ hợp (NFD) lẫn dựng sẵn (NFC) về cùng kết quả', () => {
    expect(normalizeVietnamese('Thủ Đức'.normalize('NFC'))).toBe('thu duc');
    expect(normalizeVietnamese('Thủ Đức'.normalize('NFD'))).toBe('thu duc');
  });

  it('cắt và gom khoảng trắng thừa để "  TP.   HCM " khớp "tp. hcm"', () => {
    expect(normalizeVietnamese('  TP.   HCM ')).toBe('tp. hcm');
  });
});
