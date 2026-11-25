import { provinceCode, SEED_PROVINCES } from './crm-seed.data';

describe('provinceCode: mã tham chiếu 34 tỉnh (FR-40)', () => {
  const AREA_CODE = /^[A-Z][A-Z0-9_]{0,29}$/;

  it('FR-40: 34 mã đúng mẫu và không trùng nhau', () => {
    const codes = SEED_PROVINCES.map(provinceCode);
    expect(codes.every((code) => AREA_CODE.test(code))).toBe(true);
    expect(new Set(codes).size).toBe(34);
  });

  it('FR-40: mã ổn định bất kể thứ tự đầu vào (chỉ phụ thuộc tên)', () => {
    const forward = new Map(SEED_PROVINCES.map((n) => [n, provinceCode(n)]));
    const reversed = new Map(
      [...SEED_PROVINCES].reverse().map((n) => [n, provinceCode(n)]),
    );
    expect(reversed).toEqual(forward);
  });

  it('FR-40: ví dụ chuẩn Hà Nội -> HA_NOI', () => {
    expect(provinceCode('Hà Nội')).toBe('HA_NOI');
  });
});
