import { Types } from 'mongoose';
import { PersonaFieldType, PersonaSource } from './persona.constants';
import {
  buildPersonaFilterConditions,
  derivePersona,
  findFieldShapeError,
  isSamePersonaValue,
  mergeOptions,
  parseIsoDate,
  parsePersonaValue,
  PersonaFieldDef,
  pickMissingFields,
  StoredPersonaValue,
  toFilterSlug,
} from './persona.rules';

const field = (overrides: Partial<PersonaFieldDef> = {}): PersonaFieldDef => ({
  key: 'occupation',
  label: 'Nghề nghiệp',
  groupCode: 'OCCUPATION',
  type: PersonaFieldType.TEXT,
  order: 1,
  weight: 1,
  suggestPriority: 50,
  isFilterable: false,
  isOccasion: false,
  isSensitive: false,
  isActive: true,
  ...overrides,
});

const stored = (
  fieldKey: string,
  parts: Partial<StoredPersonaValue>,
): StoredPersonaValue => ({
  fieldKey,
  source: PersonaSource.STAFF_OBSERVED,
  updatedBy: new Types.ObjectId(),
  updatedAt: new Date('2026-10-01T00:00:00Z'),
  ...parts,
});

const options = [
  { value: 'APARTMENT', label: 'Căn hộ', isActive: true },
  { value: 'VILLA', label: 'Biệt thự', isActive: true },
  { value: 'OLD_TYPE', label: 'Loại cũ', isActive: false },
];

describe('parsePersonaValue (kiểm giá trị theo kiểu trường)', () => {
  const parse = (type: PersonaFieldType, input: object, keep: string[] = []) =>
    parsePersonaValue({ type, options }, input, keep);

  it('TEXT: cắt khoảng trắng, từ chối chuỗi rỗng và vượt độ dài', () => {
    expect(parse(PersonaFieldType.TEXT, { valueText: '  Kế toán ' })).toEqual({
      ok: true,
      value: { valueText: 'Kế toán' },
    });
    expect(parse(PersonaFieldType.TEXT, { valueText: '   ' }).ok).toBe(false);
    expect(
      parse(PersonaFieldType.TEXT, { valueText: 'a'.repeat(501) }).ok,
    ).toBe(false);
    expect(
      parse(PersonaFieldType.TEXTAREA, { valueText: 'a'.repeat(2000) }).ok,
    ).toBe(true);
  });

  it('từ chối khóa không thuộc kiểu (gửi valueText cho trường NUMBER)', () => {
    const result = parse(PersonaFieldType.NUMBER, {
      valueNumber: 3,
      valueText: 'x',
    });
    expect(result).toEqual({
      ok: false,
      message: expect.stringContaining('valueText'),
    });
  });

  it('NUMBER_RANGE: cho phép chỉ một đầu, chặn đầu dưới > đầu trên, chặn số âm/vô cực', () => {
    expect(parse(PersonaFieldType.NUMBER_RANGE, { valueNumber: 5e9 }).ok).toBe(
      true,
    );
    expect(
      parse(PersonaFieldType.NUMBER_RANGE, { valueNumberTo: 7e9 }).ok,
    ).toBe(true);
    expect(
      parse(PersonaFieldType.NUMBER_RANGE, {
        valueNumber: 8e9,
        valueNumberTo: 7e9,
      }).ok,
    ).toBe(false);
    expect(parse(PersonaFieldType.NUMBER_RANGE, {}).ok).toBe(false);
    expect(parse(PersonaFieldType.NUMBER, { valueNumber: -1 }).ok).toBe(false);
    expect(parse(PersonaFieldType.NUMBER, { valueNumber: Infinity }).ok).toBe(
      false,
    );
    expect(parse(PersonaFieldType.NUMBER, { valueNumber: 0 }).ok).toBe(true);
  });

  it('DATE: chỉ nhận ngày lịch có thật', () => {
    expect(parse(PersonaFieldType.DATE, { valueDate: '1990-02-28' }).ok).toBe(
      true,
    );
    expect(parse(PersonaFieldType.DATE, { valueDate: '2024-02-29' }).ok).toBe(
      true,
    );
    for (const bad of ['2026-02-30', '2026-13-01', '1899-12-31', '1/2/1990']) {
      expect([
        bad,
        parse(PersonaFieldType.DATE, { valueDate: bad }).ok,
      ]).toEqual([bad, false]);
    }
  });

  it('BOOLEAN: false là giá trị hợp lệ', () => {
    expect(parse(PersonaFieldType.BOOLEAN, { valueBoolean: false })).toEqual({
      ok: true,
      value: { valueBoolean: false },
    });
    expect(
      parse(PersonaFieldType.BOOLEAN, { valueBoolean: 'no' as never }).ok,
    ).toBe(false);
  });

  it('SELECT: đúng một lựa chọn đang hoạt động; lựa chọn đã tắt chỉ hợp lệ khi khách đang giữ nó', () => {
    expect(parse(PersonaFieldType.SELECT, { valueOptions: ['VILLA'] }).ok).toBe(
      true,
    );
    expect(
      parse(PersonaFieldType.SELECT, { valueOptions: ['VILLA', 'APARTMENT'] })
        .ok,
    ).toBe(false);
    expect(parse(PersonaFieldType.SELECT, { valueOptions: ['NOPE'] }).ok).toBe(
      false,
    );
    expect(
      parse(PersonaFieldType.SELECT, { valueOptions: ['OLD_TYPE'] }).ok,
    ).toBe(false);
    expect(
      parse(PersonaFieldType.SELECT, { valueOptions: ['OLD_TYPE'] }, [
        'OLD_TYPE',
      ]).ok,
    ).toBe(true);
  });

  it('MULTI_SELECT: 1-20 lựa chọn, không trùng', () => {
    expect(
      parse(PersonaFieldType.MULTI_SELECT, {
        valueOptions: ['VILLA', 'APARTMENT'],
      }).ok,
    ).toBe(true);
    expect(
      parse(PersonaFieldType.MULTI_SELECT, { valueOptions: ['VILLA', 'VILLA'] })
        .ok,
    ).toBe(false);
    expect(parse(PersonaFieldType.MULTI_SELECT, { valueOptions: [] }).ok).toBe(
      false,
    );
  });
});

describe('isSamePersonaValue', () => {
  it('MULTI_SELECT không phân biệt thứ tự; khác giá trị thì khác', () => {
    expect(
      isSamePersonaValue(
        { valueOptions: ['A', 'B'] },
        { valueOptions: ['B', 'A'] },
      ),
    ).toBe(true);
    expect(
      isSamePersonaValue(
        { valueNumber: 1 },
        { valueNumber: 1, valueNumberTo: 2 },
      ),
    ).toBe(false);
  });
});

describe('parseIsoDate', () => {
  it('tách năm/tháng/ngày', () => {
    expect(parseIsoDate('1990-05-17')).toEqual({
      year: 1990,
      month: 5,
      day: 17,
    });
    expect(parseIsoDate('2026-04-31')).toBeNull();
  });
});

describe('toFilterSlug', () => {
  it('bỏ dấu, đ -> d, ký tự lạ thành _, không còn _ ở hai đầu', () => {
    expect(toFilterSlug('  Kế toán / Đầu tư! ')).toBe('ke_toan_dau_tu');
    expect(toFilterSlug('!!!')).toBe('');
    expect(toFilterSlug('a'.repeat(100))).toHaveLength(60);
  });
});

describe('derivePersona (độ đầy đủ, token lọc, dịp đặc biệt)', () => {
  const fields = [
    field({ key: 'occupation', weight: 2, isFilterable: true }),
    field({
      key: 'birthday',
      type: PersonaFieldType.DATE,
      weight: 1,
      isOccasion: true,
    }),
    field({
      key: 'loan_support',
      type: PersonaFieldType.BOOLEAN,
      weight: 1,
      isFilterable: true,
    }),
    field({
      key: 'property_type',
      type: PersonaFieldType.MULTI_SELECT,
      options,
      weight: 1,
      isFilterable: true,
    }),
  ];

  it('completeness = Σ weight có giá trị / Σ weight hoạt động; làm tròn', () => {
    const result = derivePersona(fields, [
      stored('occupation', { valueText: 'Kế toán' }),
      stored('loan_support', { valueBoolean: false }),
    ]);
    // (2 + 1) / 5 = 60%; `false` vẫn là đã có giá trị
    expect(result.personaCompleteness).toBe(60);
    expect(
      derivePersona(fields, [stored('occupation', { valueText: 'x' })])
        .personaCompleteness,
    ).toBe(40);
    expect(derivePersona(fields, []).personaCompleteness).toBe(0);
  });

  it('sinh token lọc cho trường lọc được (TEXT/SELECT/BOOLEAN) và dịp đặc biệt cho DATE isOccasion', () => {
    const result = derivePersona(fields, [
      stored('occupation', { valueText: 'Kế toán trưởng' }),
      stored('birthday', { valueDate: '1990-05-17' }),
      stored('loan_support', { valueBoolean: true }),
      stored('property_type', { valueOptions: ['VILLA', 'APARTMENT'] }),
    ]);
    expect(result.personaFilterKeys.sort()).toEqual([
      'loan_support=true',
      'occupation=ke_toan_truong',
      'property_type=apartment',
      'property_type=villa',
    ]);
    expect(result.occasions).toEqual([
      { fieldKey: 'birthday', year: 1990, month: 5, day: 17 },
    ]);
  });

  it('trường bị tắt không góp vào kết quả, nhưng bật lại thì dữ liệu cũ hiện lại nguyên vẹn', () => {
    const persona = [
      stored('occupation', { valueText: 'Kế toán' }),
      stored('birthday', { valueDate: '1990-05-17' }),
    ];
    const before = derivePersona(fields, persona);

    const disabled = fields.map((item) =>
      item.key === 'occupation' ? { ...item, isActive: false } : item,
    );
    const during = derivePersona(disabled, persona);
    expect(during.personaFilterKeys).toEqual([]);
    // còn 3 trường hoạt động (weight 1+1+1), có giá trị: birthday => 1/3
    expect(during.personaCompleteness).toBe(33);

    expect(derivePersona(fields, persona)).toEqual(before);
  });

  it('không có trường hoạt động: 0%, không chia cho 0', () => {
    expect(
      derivePersona([field({ isActive: false })], [stored('occupation', {})])
        .personaCompleteness,
    ).toBe(0);
  });
});

describe('pickMissingFields', () => {
  it('chỉ lấy trường hoạt động chưa có giá trị, ưu tiên suggestPriority nhỏ, tối đa 5', () => {
    const many = Array.from({ length: 8 }, (_, index) =>
      field({
        key: `f${index}`,
        order: index,
        suggestPriority: 80 - index * 10,
      }),
    );
    many.push(field({ key: 'off', isActive: false, suggestPriority: 0 }));
    const missing = pickMissingFields(many, [stored('f7', { valueText: 'x' })]);
    expect(missing.map((item) => item.key)).toEqual([
      'f6',
      'f5',
      'f4',
      'f3',
      'f2',
    ]);
  });
});

describe('mergeOptions', () => {
  it('lựa chọn vắng mặt trong danh sách mới bị tắt chứ không xóa', () => {
    const merged = mergeOptions(options, [
      { value: 'VILLA', label: 'Biệt thự cao cấp' },
      { value: 'LAND', label: 'Đất nền' },
    ]);
    expect(merged).toEqual([
      { value: 'VILLA', label: 'Biệt thự cao cấp', isActive: true },
      { value: 'LAND', label: 'Đất nền', isActive: true },
      { value: 'APARTMENT', label: 'Căn hộ', isActive: false },
      { value: 'OLD_TYPE', label: 'Loại cũ', isActive: false },
    ]);
  });

  it('có thể bật lại lựa chọn đã tắt bằng isActive: true', () => {
    const merged = mergeOptions(options, [
      { value: 'OLD_TYPE', label: 'Loại cũ', isActive: true },
    ]);
    expect(merged.find((option) => option.value === 'OLD_TYPE')?.isActive).toBe(
      true,
    );
  });
});

describe('findFieldShapeError', () => {
  const shape = (
    overrides: Partial<Parameters<typeof findFieldShapeError>[0]> = {},
  ) =>
    findFieldShapeError({
      type: PersonaFieldType.TEXT,
      options: [],
      isFilterable: false,
      isOccasion: false,
      isSensitive: false,
      ...overrides,
    });

  it('trường chọn cần lựa chọn hoạt động; trường khác không được có lựa chọn', () => {
    expect(
      shape({ type: PersonaFieldType.SELECT, options: [] }),
    ).not.toBeNull();
    expect(shape({ type: PersonaFieldType.TEXT, options })).not.toBeNull();
    expect(
      shape({ type: PersonaFieldType.SELECT, options, isFilterable: true }),
    ).toBeNull();
  });

  it('lựa chọn có slug trùng nhau bị chặn ("A b" và "a_b" cùng token)', () => {
    expect(
      shape({
        type: PersonaFieldType.SELECT,
        options: [
          { value: 'A b', label: 'x', isActive: true },
          { value: 'a_b', label: 'y', isActive: true },
        ],
      }),
    ).toContain('trùng');
  });

  it('tổng số lựa chọn kể cả đã tắt có trần (lựa chọn không bao giờ bị xóa)', () => {
    const many = Array.from({ length: 101 }, (_, index) => ({
      value: `V${index}`,
      label: `V${index}`,
      isActive: index === 0,
    }));
    expect(shape({ type: PersonaFieldType.SELECT, options: many })).toContain(
      'tối đa',
    );
    expect(
      shape({ type: PersonaFieldType.SELECT, options: many.slice(0, 100) }),
    ).toBeNull();
  });

  it('dịp đặc biệt chỉ cho DATE; bộ lọc không áp cho NUMBER/DATE/TEXTAREA', () => {
    expect(
      shape({ type: PersonaFieldType.TEXT, isOccasion: true }),
    ).not.toBeNull();
    expect(shape({ type: PersonaFieldType.DATE, isOccasion: true })).toBeNull();
    for (const type of [
      PersonaFieldType.NUMBER,
      PersonaFieldType.NUMBER_RANGE,
      PersonaFieldType.DATE,
      PersonaFieldType.TEXTAREA,
    ]) {
      expect([type, shape({ type, isFilterable: true }) !== null]).toEqual([
        type,
        true,
      ]);
    }
  });

  it('trường nhạy cảm không được đồng thời lọc được (token lọc sẽ lộ giá trị)', () => {
    expect(shape({ isSensitive: true, isFilterable: true })).toContain(
      'nhạy cảm',
    );
    expect(shape({ isSensitive: true })).toBeNull();
    expect(shape({ isFilterable: true })).toBeNull();
  });
});

describe('buildPersonaFilterConditions', () => {
  it('occupation là tiền tố token đã chuẩn hóa (không dấu, chữ thường), chỉ trên token occupation', () => {
    const [condition] = buildPersonaFilterConditions({ occupation: 'Kế toán' });
    const regex = (condition.personaFilterKeys as { $regex: RegExp }).$regex;
    expect(regex.test('occupation=ke_toan')).toBe(true);
    expect(regex.test('occupation=ke_toan_truong')).toBe(true);
    expect(regex.test('occupation=giao_vien')).toBe(false);
    expect(regex.test('business_field=ke_toan')).toBe(false);
  });

  it('occupation toàn ký tự đặc biệt (".*") không thành regex "khớp tất cả" mà không khớp ai', () => {
    expect(buildPersonaFilterConditions({ occupation: '.*' })).toEqual([
      { _id: { $in: [] } },
    ]);
  });

  it('personaFilters: cùng fieldKey là HOẶC, khác fieldKey là VÀ; giá trị được chuẩn hóa', () => {
    expect(
      buildPersonaFilterConditions({
        personaFilters: [
          'property_type:APARTMENT',
          'property_type:Biệt thự',
          'loan_support:true',
        ],
      }),
    ).toEqual([
      {
        personaFilterKeys: {
          $in: ['property_type=apartment', 'property_type=biet_thu'],
        },
      },
      { personaFilterKeys: { $in: ['loan_support=true'] } },
    ]);
  });

  it('bộ lọc sai định dạng hoặc giá trị rỗng không trả về mọi khách mà không khớp ai', () => {
    for (const bad of ['khong_co_dau_hai_cham', 'key:', ':value', 'key:!!!']) {
      const [condition] = buildPersonaFilterConditions({
        personaFilters: [bad],
      });
      expect([bad, condition]).toEqual([bad, { _id: { $in: [] } }]);
    }
    expect(buildPersonaFilterConditions({})).toEqual([]);
  });
});

describe('trường nhạy cảm trong derivePersona / pickMissingFields', () => {
  const sensitive = field({
    key: 'health_note',
    weight: 5,
    isSensitive: true,
    // dữ liệu cũ còn cờ lọc từ trước khi có ràng buộc
    isFilterable: true,
    suggestPriority: 0,
  });
  const normal = field({ key: 'occupation', weight: 1, isFilterable: true });

  it('không tính vào mẫu số độ đầy đủ, dù khách đã có giá trị', () => {
    const withValue = derivePersona(
      [sensitive, normal],
      [
        stored('occupation', { valueText: 'x' }),
        stored('health_note', { valueText: 'y' }),
      ],
    );
    expect(withValue.personaCompleteness).toBe(100);
    expect(
      derivePersona(
        [sensitive, normal],
        [stored('health_note', { valueText: 'y' })],
      ).personaCompleteness,
    ).toBe(0);
  });

  it('không sinh token lọc của trường nhạy cảm (kể cả dữ liệu cũ còn cờ lọc)', () => {
    const result = derivePersona(
      [sensitive, normal],
      [
        stored('occupation', { valueText: 'Kế toán' }),
        stored('health_note', { valueText: 'Bí mật' }),
      ],
    );
    expect(result.personaFilterKeys).toEqual(['occupation=ke_toan']);
  });

  it('không gợi ý hỏi trường nhạy cảm dù ưu tiên cao nhất', () => {
    expect(
      pickMissingFields([sensitive, normal], []).map((item) => item.key),
    ).toEqual(['occupation']);
  });
});
