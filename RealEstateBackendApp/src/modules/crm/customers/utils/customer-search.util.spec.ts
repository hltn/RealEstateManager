import {
  buildKeywordCondition,
  buildSearchText,
  parseKeyword,
} from './customer-search.util';

const searchText = buildSearchText({
  fullName: 'Nguyễn Đức Anh',
  email: 'Duc.Anh@Example.com',
  phone: '+84912345678',
});

/** Chạy điều kiện regex của `searchText` trên chuỗi mẫu, giống cách Mongo (PCRE) sẽ chạy. */
const matches = (keyword: string, text = searchText): boolean => {
  const condition = buildKeywordCondition(parseKeyword(keyword)) as {
    searchText?: { $regex: string };
  };
  if (!condition.searchText) return false; // MATCH_NOTHING
  return new RegExp(condition.searchText.$regex).test(text);
};

describe('buildSearchText', () => {
  it('bỏ dấu (đ -> d), chữ thường, có email và các dạng số; 3 phần ngăn bằng xuống dòng', () => {
    expect(searchText).toBe(
      'nguyen duc anh\nduc.anh@example.com\n0912345678 84912345678',
    );
  });
});

describe('tìm kiếm khách (chống dò SĐT, tài liệu 04 mục 3.2.3)', () => {
  it('tên: không phân biệt dấu/hoa thường', () => {
    expect(matches('NGUYỄN đức')).toBe(true);
    expect(matches('duc anh')).toBe(true);
    expect(matches('tran')).toBe(false);
  });

  it('email: từ khóa có @', () => {
    expect(matches('anh@example')).toBe(true);
  });

  it('toàn số dưới 4 chữ số: không khớp bất kỳ ai (kể cả số có trong SĐT)', () => {
    expect(matches('912')).toBe(false);
    expect(matches('09')).toBe(false);
  });

  it('4-5 chữ số: chỉ khớp ĐUÔI số, không khớp giữa số', () => {
    expect(matches('5678')).toBe(true);
    expect(matches('45678')).toBe(true);
    expect(matches('1234')).toBe(false);
    expect(matches('2345')).toBe(false);
  });

  it('từ 6 chữ số: khớp chuỗi con; chấp nhận khoảng trắng/dấu chấm/+', () => {
    expect(matches('234567')).toBe(true);
    expect(matches('091 234 567')).toBe(true);
    expect(matches('+84912345678')).toBe(true);
    expect(matches('999999')).toBe(false);
  });

  it('từ khóa không bao giờ khớp vắt ngang tên và số (tên kết thúc bằng chữ + số đầu)', () => {
    expect(matches('anh 0912')).toBe(false);
    expect(matches('anh\n0912')).toBe(false);
  });

  it('ký tự đặc biệt regex được escape (không ReDoS/injection)', () => {
    expect(() => matches('(a+)+$')).not.toThrow();
    expect(matches('.*')).toBe(false);
  });
});
