import {
  AREA_CODE_PATTERN,
  areaCodeSearchPrefix,
  generateAreaCode,
  pickUniqueAreaCode,
} from './area-code.util';

describe('generateAreaCode (FR-40)', () => {
  it('FR-40: bỏ dấu, chữ HOA, khoảng trắng thành "_": "Hà Nội" -> HA_NOI', () => {
    expect(generateAreaCode('Hà Nội')).toBe('HA_NOI');
    expect(generateAreaCode('Đà Nẵng')).toBe('DA_NANG');
  });

  it('FR-40: ký tự đặc biệt gộp thành một "_" và bỏ "_" đầu/cuối', () => {
    expect(generateAreaCode('TP. Hồ Chí Minh')).toBe('TP_HO_CHI_MINH');
    expect(generateAreaCode('  --Quận   7!! ')).toBe('QUAN_7');
  });

  it('FR-40: bắt đầu bằng số/ký tự lạ thì thêm tiền tố "A_"; tên rỗng ra "A"', () => {
    expect(generateAreaCode('12 Nguyễn Huệ')).toBe('A_12_NGUYEN_HUE');
    expect(generateAreaCode('!!!')).toBe('A');
  });

  it('FR-40: cắt tối đa 30 ký tự, không để "_" thừa ở cuối, luôn khớp mẫu', () => {
    const code = generateAreaCode(
      'Khu đô thị mới Thủ Thiêm phường An Khánh quận Hai',
    );
    expect(code.length).toBeLessThanOrEqual(30);
    expect(code.endsWith('_')).toBe(false);
    expect(code).toMatch(AREA_CODE_PATTERN);
  });
});

describe('pickUniqueAreaCode (FR-40)', () => {
  it('FR-40: chưa trùng thì giữ nguyên', () => {
    expect(pickUniqueAreaCode('HA_NOI', new Set())).toBe('HA_NOI');
  });

  it('FR-40: trùng thì thêm _2, rồi _3', () => {
    expect(pickUniqueAreaCode('HA_NOI', new Set(['HA_NOI']))).toBe('HA_NOI_2');
    expect(pickUniqueAreaCode('HA_NOI', new Set(['HA_NOI', 'HA_NOI_2']))).toBe(
      'HA_NOI_3',
    );
  });

  it('FR-40: hậu tố không làm vượt 30 ký tự', () => {
    const base = 'A'.repeat(30);
    const code = pickUniqueAreaCode(base, new Set([base]));
    expect(code).toHaveLength(30);
    expect(code.endsWith('_2')).toBe(true);
    expect(code).toMatch(AREA_CODE_PATTERN);
  });
});

describe('mã bị cắt vì hậu tố dài (FR-40)', () => {
  const base = 'A'.repeat(30);

  it('FR-40: lần 3 ra _3 khi mã _2 đã bị cắt', () => {
    const taken = new Set([base, `${'A'.repeat(28)}_2`]);
    expect(pickUniqueAreaCode(base, taken)).toBe(`${'A'.repeat(28)}_3`);
  });

  it('FR-40: tiền tố tìm kiếm bắt được mọi mã đã cắt', () => {
    const re = new RegExp(`^${areaCodeSearchPrefix(base)}`);
    expect(re.test(base)).toBe(true);
    expect(re.test(`${'A'.repeat(28)}_2`)).toBe(true);
  });

  it('FR-40: vòng thử hậu tố có giới hạn an toàn, không lặp vô hạn', () => {
    const taken = { has: () => true } as unknown as ReadonlySet<string>;
    expect(() => pickUniqueAreaCode('HA_NOI', taken)).toThrow();
  });
});
