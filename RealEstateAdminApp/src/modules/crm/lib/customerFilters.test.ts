import { describe, expect, it } from 'vitest';
import { DEFAULT_FILTERS } from '@crm/store/crmReducer';
import type { PersonaFieldDefinition } from '@crm/types/crm';
import {
  buildPersonaFilterFields,
  countActiveAdvancedFilters,
  getPersonaFilterValues,
  PERSONA_FILTER_MAX_VALUES,
  PROGRESS_FILTER_OPTIONS,
  pruneOrphanPersonaFilters,
  pruneStaleTagFilters,
  replaceTagInFilter,
  togglePersonaFilter,
  toggleValue,
} from './customerFilters';

describe('customerFilters', () => {
  it('bộ lọc mặc định không có nhóm nâng cao nào đang bật', () => {
    expect(countActiveAdvancedFilters(DEFAULT_FILTERS)).toBe(0);
  });

  it('đếm nhóm bộ lọc nâng cao đang bật (khoảng ngày tính 1; ô tìm, tab, nghề nghiệp trống không tính)', () => {
    expect(
      countActiveAdvancedFilters({
        ...DEFAULT_FILTERS,
        q: 'an',
        listGroup: 'NET',
        projectIds: ['p1', 'p2'],
        progress: [50],
        updatedFrom: '2026-10-01',
        updatedTo: '2026-10-20',
        occupation: '  ',
      }),
    ).toBe(3);
  });

  it('chỉ có ngày kết thúc cũng tính là 1 nhóm; nghề nghiệp có chữ tính thêm 1', () => {
    expect(countActiveAdvancedFilters({ ...DEFAULT_FILTERS, updatedTo: '2026-10-20', occupation: 'kỹ sư' })).toBe(2);
  });

  it('toggleValue thêm/bỏ giá trị và không đổi mảng gốc', () => {
    const original = ['a'];
    expect(toggleValue(original, 'b')).toEqual(['a', 'b']);
    expect(toggleValue(['a', 'b'], 'a')).toEqual(['b']);
    expect(original).toEqual(['a']);
  });

  it('nhãn mức tiến độ cho biết số tiêu chí đạt trên 4', () => {
    expect(PROGRESS_FILTER_OPTIONS.find((option) => option.value === 50)?.label).toBe('50% (2/4)');
    expect(PROGRESS_FILTER_OPTIONS.find((option) => option.value === 100)?.label).toBe('100% (4/4)');
  });
});

const makeField = (overrides: Partial<PersonaFieldDefinition> & Pick<PersonaFieldDefinition, 'key' | 'type'>): PersonaFieldDefinition => ({
  label: overrides.key,
  groupCode: 'REAL_ESTATE',
  weight: 1,
  suggestPriority: 1,
  isFilterable: true,
  isOccasion: false,
  linkedCriterion: null,
  isActive: true,
  ...overrides,
});

const propertyType = makeField({
  key: 'property_type',
  label: 'Loại hình',
  type: 'MULTI_SELECT',
  optionItems: [
    { value: 'APT', label: 'Căn hộ', isActive: true },
    { value: 'VILLA', label: 'Biệt thự', isActive: true },
    { value: 'OLD', label: 'Loại cũ', isActive: false },
    { value: 'A,B', label: 'Có dấu phẩy', isActive: true },
  ],
});

describe('buildPersonaFilterFields (FR-49)', () => {
  it('chỉ lấy trường lọc được, đang hoạt động, không nhạy cảm, kiểu chọn được; mã lựa chọn từ API', () => {
    const fields = [
      propertyType,
      makeField({ key: 'budget', type: 'NUMBER_RANGE' }),
      makeField({ key: 'occupation', type: 'TEXT' }),
      makeField({ key: 'hobby', type: 'SELECT', isFilterable: false, optionItems: [{ value: 'GOLF', label: 'Golf', isActive: true }] }),
      makeField({ key: 'secret', type: 'SELECT', isSensitive: true, optionItems: [{ value: 'X', label: 'X', isActive: true }] }),
      makeField({ key: 'off', type: 'SELECT', isActive: false, optionItems: [{ value: 'X', label: 'X', isActive: true }] }),
      makeField({ key: 'Bad-Key', type: 'SELECT', optionItems: [{ value: 'X', label: 'X', isActive: true }] }),
      makeField({ key: 'empty', type: 'SELECT', optionItems: [] }),
    ];
    const result = buildPersonaFilterFields(fields, []);
    expect(result.map((field) => field.key)).toEqual(['property_type']);
    // Lựa chọn đã tắt và lựa chọn chứa dấu phẩy không hiện.
    expect(result[0].options).toEqual([
      { value: 'APT', label: 'Căn hộ' },
      { value: 'VILLA', label: 'Biệt thự' },
    ]);
  });

  it('BOOLEAN có hai lựa chọn Có/Không với mã true/false', () => {
    const [field] = buildPersonaFilterFields([makeField({ key: 'loan_support', label: 'Cần vay', type: 'BOOLEAN' })], []);
    expect(field.options).toEqual([
      { value: 'true', label: 'Có' },
      { value: 'false', label: 'Không' },
    ]);
  });

  it('lựa chọn đã tắt vẫn hiện khi đang được chọn (để bỏ chọn được)', () => {
    const [field] = buildPersonaFilterFields([propertyType], ['property_type:OLD']);
    expect(field.options.map((option) => option.value)).toEqual(['APT', 'VILLA', 'OLD']);
  });

  it('không có optionItems thì dùng nhãn làm giá trị (dữ liệu mẫu)', () => {
    const [field] = buildPersonaFilterFields([makeField({ key: 'marital', type: 'SELECT', options: ['Độc thân'] })], []);
    expect(field.options).toEqual([{ value: 'Độc thân', label: 'Độc thân' }]);
  });
});

describe('personaFilters: chọn, đếm, gỡ (FR-49)', () => {
  it('togglePersonaFilter thêm/bỏ `fieldKey:value`, không đổi mảng gốc', () => {
    const original = ['property_type:APT'];
    expect(togglePersonaFilter(original, 'property_type', 'VILLA')).toEqual(['property_type:APT', 'property_type:VILLA']);
    expect(togglePersonaFilter(original, 'property_type', 'APT')).toEqual([]);
    expect(original).toEqual(['property_type:APT']);
  });

  it('đủ PERSONA_FILTER_MAX_VALUES thì không thêm nữa nhưng vẫn bỏ chọn được', () => {
    const full = Array.from({ length: PERSONA_FILTER_MAX_VALUES }, (_, index) => `f:v${index}`);
    expect(togglePersonaFilter(full, 'f', 'extra')).toEqual(full);
    expect(togglePersonaFilter(full, 'f', 'v0')).toHaveLength(PERSONA_FILTER_MAX_VALUES - 1);
  });

  it('getPersonaFilterValues chỉ lấy đúng trường (không nhầm tiền tố giống nhau)', () => {
    const selected = ['property_type:APT', 'property_type_ext:X', 'loan_support:true'];
    expect(getPersonaFilterValues(selected, 'property_type')).toEqual(['APT']);
    expect(getPersonaFilterValues(selected, 'loan_support')).toEqual(['true']);
  });

  it('countActiveAdvancedFilters tính mỗi trường chân dung 1 nhóm dù chọn nhiều giá trị', () => {
    expect(countActiveAdvancedFilters({ ...DEFAULT_FILTERS, personaFilters: ['a:1', 'a:2', 'b:true'] })).toBe(2);
    expect(countActiveAdvancedFilters({ ...DEFAULT_FILTERS, personaFilters: ['a:1'], tagIds: ['t'] })).toBe(2);
  });

  it('pruneOrphanPersonaFilters gỡ giá trị của trường không còn hiện, giữ trường còn hiện', () => {
    const visible = buildPersonaFilterFields([propertyType], []);
    expect(pruneOrphanPersonaFilters(['property_type:APT', 'hobby:GOLF'], visible)).toEqual(['property_type:APT']);
  });

  it('replaceTagInFilter thay A bằng B, khử trùng, và giữ nguyên tham chiếu khi không có A', () => {
    expect(replaceTagInFilter(['a', 'b', 'c'], 'a', 'x')).toEqual(['x', 'b', 'c']);
    expect(replaceTagInFilter(['a', 'b'], 'a', 'b')).toEqual(['b']);
    const untouched = ['b'];
    expect(replaceTagInFilter(untouched, 'a', 'x')).toBe(untouched);
  });

  it('pruneStaleTagFilters gỡ id không tồn tại, giữ nguyên tham chiếu khi không có id mồ côi', () => {
    expect(pruneStaleTagFilters(['a', 'gone', 'b'], ['a', 'b'])).toEqual(['a', 'b']);
    const clean = ['a'];
    expect(pruneStaleTagFilters(clean, ['a', 'b'])).toBe(clean);
  });
});
