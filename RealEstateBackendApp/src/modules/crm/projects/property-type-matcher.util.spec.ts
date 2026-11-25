import {
  deriveLabels,
  mapPropertyTypeTexts,
  type PropertyTypeOption,
} from './property-type-matcher.util';

const OPTIONS: PropertyTypeOption[] = [
  { value: 'APARTMENT', label: 'Căn hộ chung cư', isActive: true },
  { value: 'TOWNHOUSE', label: 'Nhà phố / Shophouse', isActive: true },
  { value: 'VILLA', label: 'Biệt thự / Villa', isActive: true },
  { value: 'LAND', label: 'Đất nền', isActive: false },
  { value: 'CONDOTEL', label: 'Condotel / Nghỉ dưỡng', isActive: true },
];

describe('mapPropertyTypeTexts (FR-46)', () => {
  it('khớp theo nhãn đầy đủ, từng phần nhãn tách "/", và theo value (không phân biệt hoa thường/dấu)', () => {
    const result = mapPropertyTypeTexts(
      ['Căn hộ chung cư', 'shophouse', 'BIET THU / VILLA', 'land', 'Officetel'],
      OPTIONS,
    );
    expect(result.codes).toEqual(['APARTMENT', 'TOWNHOUSE', 'VILLA', 'LAND']);
    expect(result.unmapped).toEqual(['Officetel']);
  });

  it('khớp qua bảng từ đồng nghĩa ("căn hộ", "nghỉ dưỡng", "nhà phố", "biệt thự")', () => {
    const result = mapPropertyTypeTexts(
      ['Căn hộ', 'nghỉ dưỡng', 'Nhà phố', 'Biệt thự'],
      OPTIONS,
    );
    expect(result).toEqual({
      codes: ['APARTMENT', 'CONDOTEL', 'TOWNHOUSE', 'VILLA'],
      unmapped: [],
    });
  });

  it('chữ không khớp vào unmapped nguyên văn; bỏ trùng; bỏ chữ rỗng/khoảng trắng', () => {
    const result = mapPropertyTypeTexts(
      ['Officetel', 'Officetel', '   ', 'Căn hộ', 'can ho'],
      OPTIONS,
    );
    expect(result).toEqual({ codes: ['APARTMENT'], unmapped: ['Officetel'] });
  });

  it('từ đồng nghĩa trỏ tới lựa chọn không có trong cấu hình => unmapped (không bịa mã)', () => {
    const result = mapPropertyTypeTexts(
      ['Căn hộ'],
      OPTIONS.filter((option) => option.value !== 'APARTMENT'),
    );
    expect(result).toEqual({ codes: [], unmapped: ['Căn hộ'] });
  });

  it('không có lựa chọn nào hoặc danh sách chữ rỗng', () => {
    expect(mapPropertyTypeTexts(['Căn hộ'], [])).toEqual({
      codes: [],
      unmapped: ['Căn hộ'],
    });
    expect(mapPropertyTypeTexts([], OPTIONS)).toEqual({
      codes: [],
      unmapped: [],
    });
  });
});

describe('deriveLabels (FR-46)', () => {
  it('suy nhãn theo thứ tự; value không còn trong cấu hình lấy nguyên văn; bỏ trùng', () => {
    expect(deriveLabels(['VILLA', 'GONE', 'VILLA', 'LAND'], OPTIONS)).toEqual([
      'Biệt thự / Villa',
      'GONE',
      'Đất nền',
    ]);
  });
});
