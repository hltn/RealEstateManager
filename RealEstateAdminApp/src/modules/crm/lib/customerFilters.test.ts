import { describe, expect, it } from 'vitest';
import { DEFAULT_FILTERS } from '@crm/store/crmReducer';
import { countActiveAdvancedFilters, PROGRESS_FILTER_OPTIONS, toggleValue } from './customerFilters';

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
