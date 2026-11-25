import {
  buildKeywordCondition,
  buildSearchText,
  parseKeyword,
} from './customer-search.util';

const searchText = buildSearchText({
  fullName: 'Khải Nguyễn',
  email: 'kh12@example.com',
  phone: '+84912345678',
});

type CodeCond = {
  $or: Array<{
    customerCode: { $type: string; $eq?: string; $regex?: string };
  }>;
};
const cond = (raw: string): CodeCond =>
  buildKeywordCondition(parseKeyword(raw)) as unknown as CodeCond;

describe('FR-09: parseKeyword nhận diện mã khách', () => {
  it.each([
    ['kh-12', '12'],
    ['KH000123', '000123'],
    ['kh123', '123'],
    ['KH-000123', '000123'],
    ['Kh-7', '7'],
    ['  kh 12 ', '12'],
  ])('"%s" là mã khách với phần số %s', (raw, digits) => {
    expect(parseKeyword(raw)).toEqual({ kind: 'code', digits });
  });

  it.each(['kh', 'kh-', 'KH-', 'khanh', 'kh-12a', 'kh--12', 'xkh-12'])(
    'FR-09: "%s" KHÔNG phải mã khách (rơi về tên)',
    (raw) => {
      expect(parseKeyword(raw).kind).toBe('name');
    },
  );

  it('FR-09: từ khóa toàn số vẫn là SĐT, không bao giờ là mã (giữ chặn dò số #37)', () => {
    expect(parseKeyword('000123')).toEqual({ kind: 'phone', digits: '000123' });
    expect(parseKeyword('0912345678')).toEqual({
      kind: 'phone',
      digits: '0912345678',
    });
    expect(parseKeyword('+84 912 345 678').kind).toBe('phone');
  });

  it('FR-09: email và tên có chữ "kh" vẫn đúng loại cũ', () => {
    expect(parseKeyword('kh12@x.com').kind).toBe('email');
    expect(parseKeyword('Khánh').kind).toBe('name');
    expect(parseKeyword('Khải 12')).toEqual({ kind: 'name', text: 'khai 12' });
  });

  it('FR-09: từ khóa rỗng/khoảng trắng vẫn là tên rỗng (không khớp ai)', () => {
    expect(parseKeyword('')).toEqual({ kind: 'name', text: '' });
    expect(buildKeywordCondition(parseKeyword('   '))).toEqual({
      _id: { $in: [] },
    });
  });

  it('FR-09: tên có chữ "kh" tìm theo searchText như cũ, không dựng điều kiện mã', () => {
    const condition = buildKeywordCondition(parseKeyword('khai')) as {
      searchText: { $regex: string };
    };
    expect(condition.searchText.$regex).toBe('khai');
    expect(new RegExp(condition.searchText.$regex).test(searchText)).toBe(true);
  });
});

describe('FR-09: buildKeywordCondition cho mã khách', () => {
  it('mọi nhánh đều có $type string (dùng được index partial customerCode_1, loại khách chưa có mã)', () => {
    for (const raw of ['kh-12', 'KH000123', 'kh123']) {
      const branches = cond(raw).$or;
      expect(branches).toHaveLength(2);
      for (const branch of branches) {
        expect(branch.customerCode.$type).toBe('string');
      }
    }
  });

  it('khớp đúng mã đệm 6 số và tiền tố đã gõ; không đụng searchText', () => {
    const [exact, prefix] = cond('kh-12').$or;
    expect(exact.customerCode.$eq).toBe('KH-000012');
    expect(prefix.customerCode.$regex).toBe('^KH-12');
    expect(JSON.stringify(cond('kh-12'))).not.toContain('searchText');
  });

  it('regex tiền tố chạy đúng: kh-12 khớp KH-120000, không khớp KH-000123 hay XKH-120000', () => {
    const re = new RegExp(cond('kh-12').$or[1].customerCode.$regex!);
    expect(re.test('KH-120000')).toBe(true);
    expect(re.test('KH-000123')).toBe(false);
    expect(re.test('XKH-120000')).toBe(false);
  });

  it('số 0 đứng đầu được chuẩn hóa: KH-000123 và kh123 cùng mã đệm', () => {
    expect(cond('KH-000123').$or[0].customerCode.$eq).toBe('KH-000123');
    expect(cond('kh123').$or[0].customerCode.$eq).toBe('KH-000123');
  });

  it('mã vượt 999.999 vẫn dựng đúng, không cắt', () => {
    expect(cond('kh1000000').$or[0].customerCode.$eq).toBe('KH-1000000');
  });

  it('số thuần dưới 4 chữ số vẫn không khớp gì (không bị coi là mã)', () => {
    expect(buildKeywordCondition(parseKeyword('123'))).toEqual({
      _id: { $in: [] },
    });
  });
});
