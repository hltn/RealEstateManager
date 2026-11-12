import { describe, expect, it } from 'vitest';
import type { TagCategory } from '@crm/types/crm';
import { groupTagsByCategory, isTagInCategory, TAG_CATEGORY_LABELS, TAG_CATEGORY_ORDER, TAG_GROUP_TITLES } from './tagCategories';

const tag = (id: string, category: string) => ({ id, category: category as TagCategory });

describe('tagCategories (FR-48)', () => {
  it('có đủ 3 nhóm, Khác luôn cuối, mỗi nhóm có nhãn và tiêu đề', () => {
    expect(TAG_CATEGORY_ORDER).toEqual(['INTEREST', 'OCCUPATION', 'OTHER']);
    expect(TAG_CATEGORY_LABELS.OTHER).toBe('Khác');
    expect(TAG_GROUP_TITLES.OTHER).toBe('Thẻ khác');
  });

  it('gom thẻ theo thứ tự nhóm, giữ thứ tự thẻ trong nhóm', () => {
    const groups = groupTagsByCategory([tag('o1', 'OTHER'), tag('i1', 'INTEREST'), tag('c1', 'OCCUPATION'), tag('i2', 'INTEREST')]);
    expect(groups.map((group) => [group.category, group.title, group.tags.map((item) => item.id)])).toEqual([
      ['INTEREST', 'Thẻ sở thích', ['i1', 'i2']],
      ['OCCUPATION', 'Thẻ nghề nghiệp', ['c1']],
      ['OTHER', 'Thẻ khác', ['o1']],
    ]);
  });

  it('bỏ nhóm rỗng; không có thẻ thì không có nhóm nào', () => {
    expect(groupTagsByCategory([tag('o1', 'OTHER')]).map((group) => group.category)).toEqual(['OTHER']);
    expect(groupTagsByCategory([])).toEqual([]);
  });

  it('thẻ có nhóm lạ được xếp vào Khác (không biến mất khỏi bộ lọc)', () => {
    const groups = groupTagsByCategory([tag('i1', 'INTEREST'), tag('x1', 'FUTURE_GROUP')]);
    expect(groups.map((group) => group.category)).toEqual(['INTEREST', 'OTHER']);
    expect(groups[1].tags.map((item) => item.id)).toEqual(['x1']);
  });

  it('isTagInCategory: nhóm biết thì khớp đúng nhóm; nhóm lạ chỉ thuộc Khác', () => {
    expect(isTagInCategory(tag('i1', 'INTEREST'), 'INTEREST')).toBe(true);
    expect(isTagInCategory(tag('i1', 'INTEREST'), 'OTHER')).toBe(false);
    expect(isTagInCategory(tag('x1', 'FUTURE_GROUP'), 'OTHER')).toBe(true);
    expect(isTagInCategory(tag('x1', 'FUTURE_GROUP'), 'INTEREST')).toBe(false);
    expect(isTagInCategory(tag('x1', 'FUTURE_GROUP'), 'OCCUPATION')).toBe(false);
  });
});
