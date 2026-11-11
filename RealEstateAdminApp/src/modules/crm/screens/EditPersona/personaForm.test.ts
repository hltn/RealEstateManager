import { describe, expect, it } from 'vitest';
import { PERSONA_FIELDS } from '@crm/data/personaFields';
import { fieldsOfGroups, withCurrentOptions, getChangedBasicInput, getChangedPersonaInputs, toPersonaDraft, toPersonaInputs, validateBasicInfo, validatePersonaDraft } from './personaForm';

const REAL_ESTATE = fieldsOfGroups(PERSONA_FIELDS, ['REAL_ESTATE']);
const PERSONAL = fieldsOfGroups(PERSONA_FIELDS, ['PERSONAL', 'OCCUPATION']);

const base = { fullName: 'An', phone: '0912345678', email: '', nationalId: '', areaId: '', sourceId: '', interestedProjectIds: [], tagIds: [] };

describe('validateBasicInfo (FR-02, QT9)', () => {
  it('chỉ họ tên bắt buộc; SĐT trống hợp lệ; ngày sinh, nghề nghiệp, kênh liên hệ không bắt buộc', () => {
    expect(validateBasicInfo(base)).toEqual({});
    expect(Object.keys(validateBasicInfo({ ...base, fullName: '', phone: '' }))).toEqual(['fullName']);
    expect(validateBasicInfo({ ...base, phone: '  ' })).toEqual({});
  });
  it('SĐT có nhập nhưng sai định dạng vẫn bị chặn; đang khóa (chưa bấm "Sửa số") thì không kiểm', () => {
    expect(validateBasicInfo({ ...base, phone: '123' }).phone).toMatch(/không hợp lệ/);
    expect(validateBasicInfo({ ...base, phone: '123' }, true).phone).toBeUndefined();
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

describe('chỉ gửi phần thật sự đổi (tránh xóa nhầm/ghi đè dữ liệu người khác)', () => {
  it('hồ sơ: không đổi gì -> undefined; đổi tên + thêm dự án -> chỉ 2 trường đó; SĐT chỉ gửi khi đã mở khóa và đổi số', () => {
    expect(getChangedBasicInput(base, { ...base }, true, null)).toBeUndefined();
    expect(getChangedBasicInput(base, { ...base, fullName: ' An B ', interestedProjectIds: ['p1'] }, true, null)).toEqual({ fullName: 'An B', interestedProjectIds: ['p1'] });
    // Mở khóa nhưng giữ nguyên số -> không gửi SĐT (tránh ghi PHONE_UPDATED/đụng hạn mức 409).
    expect(getChangedBasicInput({ ...base, phone: '' }, { ...base, phone: '0912 345 678' }, false, '+84912345678')).toBeUndefined();
    expect(getChangedBasicInput({ ...base, phone: '' }, { ...base, phone: '0988111222' }, false, '+84912345678')).toEqual({ phone: '0988111222' });
  });

  it('hồ sơ: mở khóa rồi XÓA TRỐNG ô SĐT -> gửi phone: null (xóa SĐT, FR-02); toàn khoảng trắng cũng là null', () => {
    expect(getChangedBasicInput({ ...base, phone: '' }, { ...base, phone: '' }, false, '+84912345678')).toEqual({ phone: null });
    expect(getChangedBasicInput({ ...base, phone: '' }, { ...base, phone: '   ' }, false, '+84912345678')).toEqual({ phone: null });
  });

  it('hồ sơ: khách vốn chưa có SĐT (revealedPhone null, ô mở sẵn): bỏ trống -> không đổi; nhập số -> gửi số', () => {
    const noPhone = { ...base, phone: '' };
    expect(getChangedBasicInput(noPhone, { ...noPhone }, false, null)).toBeUndefined();
    expect(getChangedBasicInput(noPhone, { ...noPhone, phone: '  ' }, false, null)).toBeUndefined();
    expect(getChangedBasicInput(noPhone, { ...noPhone, phone: '0988 111 222' }, false, null)).toEqual({ phone: '0988 111 222' });
  });

  it('hồ sơ: xóa email/khu vực -> gửi chuỗi rỗng/null để backend xóa; thứ tự dự án/thẻ không tính là đổi', () => {
    const initial = { ...base, email: 'a@b.vn', areaId: 'a1', interestedProjectIds: ['p1', 'p2'] };
    expect(getChangedBasicInput(initial, { ...initial, email: '', areaId: '' }, true, null)).toEqual({ email: '', areaId: null });
    expect(getChangedBasicInput(initial, { ...initial, interestedProjectIds: ['p2', 'p1'] }, true, null)).toBeUndefined();
  });

  it('chân dung: chỉ trường đổi; xóa giá trị -> value null; SELECT lưu 1 mã trong valueOptions', () => {
    const select = fieldsOfGroups(PERSONA_FIELDS, ['FAMILY']).find((field) => field.type === 'SELECT');
    expect(select).toBeDefined();
    const fields = [...PERSONAL, ...(select ? [select] : [])];
    const initial = toPersonaDraft([{ fieldKey: 'occupation', valueText: 'Kế toán', source: 'CUSTOMER_SHARED', updatedBy: 'a', updatedAt: 't' }], fields);
    expect(getChangedPersonaInputs(initial, initial, fields, 'STAFF_OBSERVED')).toEqual([]);
    const changed = { ...initial, occupation: { ...initial.occupation, text: '' }, ...(select ? { [select.key]: { ...initial[select.key], text: 'Khách tự quyết' } } : {}) };
    expect(getChangedPersonaInputs(initial, changed, fields, 'STAFF_OBSERVED')).toEqual([
      { fieldKey: 'occupation', source: 'STAFF_OBSERVED', value: null },
      ...(select ? [{ fieldKey: select.key, source: 'STAFF_OBSERVED', value: { valueOptions: ['Khách tự quyết'] } }] : []),
    ]);
  });
});

describe('withCurrentOptions (FR-41: lựa chọn đã tắt vẫn hiện cho khách đang dùng)', () => {
  it('giữ lựa chọn đang dùng và thêm giá trị khách đang có mà đã bị tắt', () => {
    expect(withCurrentOptions(['Căn hộ', 'Biệt thự'], ['Loại cũ'])).toEqual(['Căn hộ', 'Biệt thự', 'Loại cũ']);
  });

  it('không nhân đôi giá trị đã có trong danh sách; bỏ giá trị rỗng; không có gì đang chọn thì không đổi', () => {
    expect(withCurrentOptions(['Căn hộ'], ['Căn hộ', '', 'Cũ'])).toEqual(['Căn hộ', 'Cũ']);
    expect(withCurrentOptions(['Căn hộ'], [''])).toEqual(['Căn hộ']);
    expect(withCurrentOptions(['Căn hộ'], [])).toEqual(['Căn hộ']);
  });
});
