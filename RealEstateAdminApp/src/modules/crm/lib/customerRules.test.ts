import { describe, expect, it } from 'vitest';
import type { PersonaFieldDefinition } from '@crm/types/crm';
import {
  applyPersonaUpdates,
  buildCareTeam,
  computeOccasions,
  computePersonaCompleteness,
  createEmptyCriteria,
  formatBudgetRange,
  formatMoneyVnd,
  getMissingPersonaFields,
  getPrimaryUserId,
  getProgressPercent,
  isCareTeamValid,
  isValidNationalId,
  maskNationalId,
} from './customerRules';

const field = (key: string, overrides: Partial<PersonaFieldDefinition> = {}): PersonaFieldDefinition => ({
  key,
  label: key,
  groupCode: 'PERSONAL',
  type: 'TEXT',
  weight: 1,
  suggestPriority: 50,
  isFilterable: false,
  isOccasion: false,
  linkedCriterion: null,
  isActive: true,
  ...overrides,
});

describe('tiến độ = số tiêu chí đạt / 4 (QT1)', () => {
  it('khách mới 0/4 = 0%', () => {
    expect(getProgressPercent(createEmptyCriteria())).toBe(0);
  });
  it('mô tả không ảnh hưởng tiến độ, chỉ dấu hoàn thành', () => {
    const criteria = createEmptyCriteria();
    criteria.demand = { ...criteria.demand, description: 'Có mô tả' };
    criteria.finance = { ...criteria.finance, isDone: true };
    criteria.timing = { ...criteria.timing, isDone: true };
    expect(getProgressPercent(criteria)).toBe(50);
  });
});

describe('nhóm chăm sóc (QT7)', () => {
  it('buildCareTeam tạo đúng 1 PRIMARY, bỏ trùng và bỏ người trùng PRIMARY', () => {
    const team = buildCareTeam('hanh', ['thao', 'hanh', 'thao'], 'admin', 'now');
    expect(team.map((member) => [member.userId, member.role])).toEqual([
      ['hanh', 'PRIMARY'],
      ['thao', 'MEMBER'],
    ]);
    expect(getPrimaryUserId(team)).toBe('hanh');
  });
  it('không có phụ trách chính -> nhóm rỗng', () => {
    expect(buildCareTeam(null, ['thao'], 'admin', 'now')).toEqual([]);
  });
  it('isCareTeamValid: rỗng hợp lệ; 0 hoặc 2 PRIMARY, trùng người thì không', () => {
    expect(isCareTeamValid([])).toBe(true);
    expect(isCareTeamValid([{ userId: 'a', role: 'MEMBER', addedBy: 'x', addedAt: 'n' }])).toBe(false);
    expect(
      isCareTeamValid([
        { userId: 'a', role: 'PRIMARY', addedBy: 'x', addedAt: 'n' },
        { userId: 'b', role: 'PRIMARY', addedBy: 'x', addedAt: 'n' },
      ]),
    ).toBe(false);
    expect(
      isCareTeamValid([
        { userId: 'a', role: 'PRIMARY', addedBy: 'x', addedAt: 'n' },
        { userId: 'a', role: 'MEMBER', addedBy: 'x', addedAt: 'n' },
      ]),
    ).toBe(false);
  });
});

describe('chân dung (QT9, C12, C13)', () => {
  const fields = [field('occupation', { weight: 2, suggestPriority: 1 }), field('hometown', { suggestPriority: 3 }), field('birthday', { type: 'DATE', isOccasion: true, suggestPriority: 2 }), field('old', { isActive: false })];

  it('applyPersonaUpdates chỉ ghi metadata cho trường thật sự đổi, giá trị rỗng = xoá', () => {
    const initial = [{ fieldKey: 'hometown', valueText: 'Hà Nội', source: 'CUSTOMER_SHARED' as const, updatedBy: 'thao', updatedAt: 't0' }];
    const { persona, changedKeys } = applyPersonaUpdates(
      initial,
      [
        { fieldKey: 'hometown', value: { fieldKey: 'hometown', valueText: 'Hà Nội' }, source: 'STAFF_OBSERVED' },
        { fieldKey: 'occupation', value: { fieldKey: 'occupation', valueText: 'Kế toán' }, source: 'CUSTOMER_SHARED' },
      ],
      'hanh',
      't1',
    );
    expect(changedKeys).toEqual(['occupation']);
    expect(persona.find((value) => value.fieldKey === 'hometown')?.updatedBy).toBe('thao');
    expect(persona.find((value) => value.fieldKey === 'occupation')).toMatchObject({ updatedBy: 'hanh', updatedAt: 't1', source: 'CUSTOMER_SHARED' });

    const cleared = applyPersonaUpdates(persona, [{ fieldKey: 'hometown', value: { fieldKey: 'hometown', valueText: '  ' }, source: 'STAFF_OBSERVED' }], 'hanh', 't2');
    expect(cleared.changedKeys).toEqual(['hometown']);
    expect(cleared.persona.some((value) => value.fieldKey === 'hometown')).toBe(false);
  });

  it('độ đầy đủ theo trọng số, bỏ qua trường đã tắt', () => {
    const persona = [{ fieldKey: 'occupation', valueText: 'Kế toán', source: 'CUSTOMER_SHARED' as const, updatedBy: 'a', updatedAt: 't' }];
    // occupation (2) / tổng active 2 + 1 + 1 = 4 -> 50%
    expect(computePersonaCompleteness(persona, fields)).toBe(50);
    expect(computePersonaCompleteness([], [])).toBe(0);
  });

  it('gợi ý còn thiếu theo suggestPriority, giới hạn số lượng', () => {
    expect(getMissingPersonaFields([], fields, 2).map((item) => item.key)).toEqual(['occupation', 'birthday']);
  });

  it('dịp đặc biệt sinh từ trường DATE isOccasion có giá trị', () => {
    const persona = [{ fieldKey: 'birthday', valueDate: '1984-11-15', source: 'CUSTOMER_SHARED' as const, updatedBy: 'a', updatedAt: 't' }];
    expect(computeOccasions(persona, fields)).toEqual([{ fieldKey: 'birthday', month: 11, day: 15, year: 1984 }]);
    expect(computeOccasions([], fields)).toEqual([]);
  });
});

describe('CCCD + tiền', () => {
  it('maskNationalId chỉ hiện 4 số cuối', () => {
    expect(maskNationalId('1234')).toBe('••••1234');
    expect(maskNationalId(null)).toBe('');
  });
  it('isValidNationalId: rỗng, 9 hoặc 12 số', () => {
    expect(isValidNationalId('')).toBe(true);
    expect(isValidNationalId('0790 9200 1234')).toBe(true);
    expect(isValidNationalId('123456789')).toBe(true);
    expect(isValidNationalId('12345')).toBe(false);
  });
  it('tiền theo cách nói quen thuộc', () => {
    expect(formatMoneyVnd(2_500_000_000)).toBe('2,5 tỷ');
    expect(formatMoneyVnd(800_000_000)).toBe('800 triệu');
    expect(formatBudgetRange(5e9, 7e9)).toBe('5 tỷ – 7 tỷ');
    expect(formatBudgetRange(0, 0)).toBe('');
  });
});
