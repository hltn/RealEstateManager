import { describe, expect, it } from 'vitest';
import { PERSONA_FIELDS } from '@crm/data/personaFields';
import { fieldsOfGroups, toPersonaDraft, toPersonaInputs, validateBasicInfo, validatePersonaDraft } from './personaForm';

const REAL_ESTATE = fieldsOfGroups(PERSONA_FIELDS, ['REAL_ESTATE']);
const PERSONAL = fieldsOfGroups(PERSONA_FIELDS, ['PERSONAL', 'OCCUPATION']);

const base = { fullName: 'An', phone: '0912345678', email: '', nationalId: '', areaId: '', sourceId: '', interestedProjectIds: [], tagIds: [], notes: '' };

describe('validateBasicInfo (QT3/QT9)', () => {
  it('chỉ họ tên + SĐT bắt buộc; ngày sinh, nghề nghiệp, kênh liên hệ không bắt buộc', () => {
    expect(validateBasicInfo(base)).toEqual({});
    expect(Object.keys(validateBasicInfo({ ...base, fullName: '', phone: '' })).sort()).toEqual(['fullName', 'phone']);
  });
  it('CCCD và email chỉ kiểm định dạng khi có nhập', () => {
    expect(validateBasicInfo({ ...base, nationalId: '123' }).nationalId).toBeDefined();
    expect(validateBasicInfo({ ...base, email: 'x' }).email).toBeDefined();
  });
});

describe('bản nháp chân dung', () => {
  it('ngân sách: form theo tỷ, lưu VNĐ (khứ hồi)', () => {
    const persona = [{ fieldKey: 'budget', valueNumber: 5e9, valueNumberTo: 7.5e9, source: 'CUSTOMER_SHARED' as const, updatedBy: 'a', updatedAt: 't' }];
    const draft = toPersonaDraft(persona, REAL_ESTATE);
    expect(draft.budget).toMatchObject({ from: 5, to: 7.5 });
    const inputs = toPersonaInputs(draft, REAL_ESTATE, 'STAFF_OBSERVED');
    expect(inputs.find((input) => input.fieldKey === 'budget')).toEqual({
      fieldKey: 'budget',
      source: 'STAFF_OBSERVED',
      value: { valueNumber: 5e9, valueNumberTo: 7.5e9 },
    });
  });

  it('trường trống -> value null (xoá), không bắt buộc trường nào', () => {
    const inputs = toPersonaInputs(toPersonaDraft([], PERSONAL), PERSONAL, 'CUSTOMER_SHARED');
    expect(inputs.every((input) => input.value === null)).toBe(true);
    expect(validatePersonaDraft(toPersonaDraft([], REAL_ESTATE), REAL_ESTATE)).toEqual({});
  });

  it('ngân sách tối thiểu > tối đa -> lỗi', () => {
    const draft = toPersonaDraft([], REAL_ESTATE);
    draft.budget = { ...draft.budget, from: 8, to: 5 };
    expect(validatePersonaDraft(draft, REAL_ESTATE).budget).toMatch(/lớn hơn/);
  });
});
