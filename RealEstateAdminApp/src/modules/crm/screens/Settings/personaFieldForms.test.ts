import { describe, expect, it } from 'vitest';
import type { ApiError } from '@crm/api';
import type { AdminPersonaField } from '@crm/types/crm';
import {
  PERSONA_ACTIVE_OPTIONS_MAX,
  PERSONA_TOTAL_OPTIONS_MAX,
  addOptionToDraft,
  buildCreatePersonaFieldBody,
  buildMoveOrderItems,
  buildPersonaFieldPatch,
  canDeletePersonaField,
  changeCreateDraftType,
  createEmptyCreateDraft,
  describePersonaFieldError,
  groupPersonaFields,
  hasPersonaOptions,
  isAdvancedFilterType,
  makeOptionValue,
  summarizeOptions,
  suggestPersonaFieldKey,
  toPersonaFieldDraft,
  validateCreateDraft,
  validatePersonaFieldDraft,
} from './personaFieldForms';

const field = (patch: Partial<AdminPersonaField> & Pick<AdminPersonaField, 'id'>): AdminPersonaField => ({
  key: patch.id,
  label: patch.id,
  groupCode: 'PERSONAL',
  type: 'TEXT',
  options: [],
  order: 1,
  isSystem: false,
  isActive: true,
  ...patch,
});

const propertyType = field({
  id: 'pt',
  key: 'property_type',
  label: 'Loại hình',
  groupCode: 'REAL_ESTATE',
  type: 'MULTI_SELECT',
  isSystem: true,
  options: [
    { value: 'APARTMENT', label: 'Căn hộ', isActive: true },
    { value: 'VILLA', label: 'Biệt thự', isActive: true },
    { value: 'LAND', label: 'Đất nền', isActive: false },
  ],
});

describe('groupPersonaFields (FR-41: danh sách theo 7 nhóm)', () => {
  it('gom theo thứ tự 7 nhóm chuẩn, trong nhóm theo order, bỏ nhóm rỗng', () => {
    const groups = groupPersonaFields([
      field({ id: 're', groupCode: 'REAL_ESTATE', order: 1 }),
      field({ id: 'b', groupCode: 'PERSONAL', order: 3 }),
      field({ id: 'a', groupCode: 'PERSONAL', order: 2 }),
      field({ id: 'oc', groupCode: 'OCCUPATION', order: 9 }),
    ]);
    expect(groups.map((group) => [group.code, group.label, group.fields.map((item) => item.id)])).toEqual([
      ['PERSONAL', 'Cá nhân', ['a', 'b']],
      ['OCCUPATION', 'Nghề nghiệp', ['oc']],
      ['REAL_ESTATE', 'Nhu cầu BĐS', ['re']],
    ]);
  });

  it('đủ 7 nhóm khi mỗi nhóm có trường', () => {
    const codes = ['PERSONAL', 'OCCUPATION', 'LIFESTYLE', 'OCCASION', 'FAMILY', 'CONTACT', 'REAL_ESTATE'];
    const groups = groupPersonaFields(codes.map((code, index) => field({ id: code, groupCode: code, order: index })));
    expect(groups.map((group) => group.code)).toEqual(codes);
  });

  it('trường thuộc nhóm lạ có nhóm riêng ở cuối (không biến mất, không bị gộp vào "Cá nhân")', () => {
    const groups = groupPersonaFields([field({ id: 'x', groupCode: 'FUTURE', order: 1 }), field({ id: 'p', groupCode: 'PERSONAL', order: 2 })]);
    expect(groups.map((group) => group.code)).toEqual(['PERSONAL', 'FUTURE']);
    expect(groups[1].label).toBe('Nhóm FUTURE');
    expect(groups[1].fields.map((item) => item.id)).toEqual(['x']);
  });

  it('không có trường thì không có nhóm; trường đã tắt vẫn có mặt (để bật lại)', () => {
    expect(groupPersonaFields([])).toEqual([]);
    expect(groupPersonaFields([field({ id: 'off', isActive: false })])[0].fields).toHaveLength(1);
  });
});

describe('summarizeOptions / hasPersonaOptions', () => {
  it('đếm lựa chọn đang dùng và đã tắt; kiểu không có lựa chọn trả rỗng', () => {
    expect(summarizeOptions(propertyType)).toBe('2 lựa chọn, 1 đã tắt');
    expect(summarizeOptions({ ...propertyType, options: propertyType.options.slice(0, 2) })).toBe('2 lựa chọn');
    expect(summarizeOptions(field({ id: 't' }))).toBe('');
  });

  it('chỉ SELECT/MULTI_SELECT có lựa chọn', () => {
    expect(['SELECT', 'MULTI_SELECT'].every((type) => hasPersonaOptions(type as never))).toBe(true);
    expect(['TEXT', 'TEXTAREA', 'NUMBER_RANGE', 'DATE', 'BOOLEAN'].some((type) => hasPersonaOptions(type as never))).toBe(false);
  });
});

describe('buildMoveOrderItems (đổi thứ tự trong nhóm)', () => {
  const fields = [
    field({ id: 'p1', groupCode: 'PERSONAL', order: 1 }),
    field({ id: 'o1', groupCode: 'OCCUPATION', order: 2 }),
    field({ id: 'p2', groupCode: 'PERSONAL', order: 3 }),
    field({ id: 'p3', groupCode: 'PERSONAL', order: 7 }),
  ];

  it('chuyển xuống: hoán đổi "ô" order của hai trường kề nhau trong nhóm, không đụng nhóm khác', () => {
    expect(buildMoveOrderItems(fields, 'p1', 'down')).toEqual([
      { id: 'p2', order: 1 },
      { id: 'p1', order: 3 },
    ]);
  });

  it('chuyển lên là phép ngược lại', () => {
    expect(buildMoveOrderItems(fields, 'p3', 'up')).toEqual([
      { id: 'p3', order: 3 },
      { id: 'p2', order: 7 },
    ]);
  });

  it('đã ở đầu/cuối nhóm hoặc không có trường: null (không gọi API)', () => {
    expect(buildMoveOrderItems(fields, 'p1', 'up')).toBeNull();
    expect(buildMoveOrderItems(fields, 'p3', 'down')).toBeNull();
    expect(buildMoveOrderItems(fields, 'o1', 'up')).toBeNull();
    expect(buildMoveOrderItems(fields, 'khong-co', 'up')).toBeNull();
  });

  it('dữ liệu cũ có order trùng nhau: đánh số lại liên tiếp để đổi chỗ vẫn có hiệu lực', () => {
    const tied = [field({ id: 'a', order: 5 }), field({ id: 'b', order: 5 }), field({ id: 'c', order: 5 })];
    const items = buildMoveOrderItems(tied, 'a', 'down');
    expect(items).not.toBeNull();
    // Áp các order mới lên nhóm: b đứng trước a, a trước c, và mọi order khác nhau từng đôi.
    const applied = tied.map((item) => ({ ...item, order: (items ?? []).find((changed) => changed.id === item.id)?.order ?? item.order }));
    expect([...applied].sort((left, right) => left.order - right.order).map((item) => item.id)).toEqual(['b', 'a', 'c']);
    expect(new Set(applied.map((item) => item.order)).size).toBe(applied.length);
  });

  it('order trùng trong nhóm: số đánh lại KHÔNG trùng order của nhóm khác (nợ QA L4)', () => {
    // Nhóm PERSONAL trùng order 5; nhóm OCCUPATION giữ đúng các ô 6 và 7 mà phép đánh số liên tiếp 5,6,7 sẽ chạm vào.
    const mixed = [
      field({ id: 'a', groupCode: 'PERSONAL', order: 5 }),
      field({ id: 'b', groupCode: 'PERSONAL', order: 5 }),
      field({ id: 'c', groupCode: 'PERSONAL', order: 5 }),
      field({ id: 'o1', groupCode: 'OCCUPATION', order: 6 }),
      field({ id: 'o2', groupCode: 'OCCUPATION', order: 7 }),
    ];
    const items = buildMoveOrderItems(mixed, 'a', 'down') ?? [];
    const applied = mixed.map((item) => ({ ...item, order: items.find((changed) => changed.id === item.id)?.order ?? item.order }));
    expect(new Set(applied.map((item) => item.order)).size).toBe(applied.length);
    const personal = applied.filter((item) => item.groupCode === 'PERSONAL').sort((left, right) => left.order - right.order);
    expect(personal.map((item) => item.id)).toEqual(['b', 'a', 'c']);
    // Nhóm khác không bị đổi order.
    expect(items.every((item) => ['a', 'b', 'c'].includes(item.id))).toBe(true);
  });

  it('chỉ gửi trường thật sự đổi order', () => {
    const items = buildMoveOrderItems(fields, 'p2', 'down') ?? [];
    expect(items.map((item) => item.id).sort()).toEqual(['p2', 'p3']);
  });
});

describe('makeOptionValue / addOptionToDraft', () => {
  it('mã từ nhãn: bỏ dấu, chữ hoa, "_" nối; nhãn không chữ cái -> OPTION', () => {
    expect(makeOptionValue('Biệt thự / Villa', [])).toBe('BIET_THU_VILLA');
    expect(makeOptionValue('???', [])).toBe('OPTION');
  });

  it('không trùng mã đã có (kể cả đã tắt, so theo slug): thêm hậu tố _2, _3', () => {
    expect(makeOptionValue('Căn hộ', ['can_ho'])).toBe('CAN_HO_2');
    expect(makeOptionValue('Căn hộ', ['CAN_HO', 'CAN_HO_2'])).toBe('CAN_HO_3');
  });

  it('mã không dài quá 40 ký tự kể cả khi có hậu tố', () => {
    const longLabel = 'a'.repeat(80);
    const first = makeOptionValue(longLabel, []);
    expect(first).toHaveLength(40);
    const second = makeOptionValue(longLabel, [first]);
    expect(second.length).toBeLessThanOrEqual(40);
    expect(second.endsWith('_2')).toBe(true);
  });

  it('thêm lựa chọn mới: đánh dấu isNew, đang dùng, mã sinh từ nhãn đã cắt khoảng trắng', () => {
    const { draft, error } = addOptionToDraft(toPersonaFieldDraft(propertyType), '  Nhà phố ');
    expect(error).toBeNull();
    expect(draft.options.at(-1)).toEqual({ value: 'NHA_PHO', label: 'Nhà phố', isActive: true, isNew: true });
  });

  it('trùng nhãn lựa chọn ĐANG DÙNG (không phân biệt dấu/hoa thường): lỗi, nháp giữ nguyên', () => {
    const initial = toPersonaFieldDraft(propertyType);
    const result = addOptionToDraft(initial, 'can ho');
    expect(result.error).toBe('Đã có lựa chọn "Căn hộ".');
    expect(result.draft).toBe(initial);
  });

  it('trùng nhãn lựa chọn ĐÃ TẮT: bật lại lựa chọn đó với mã cũ, không sinh lựa chọn thứ hai', () => {
    const { draft, error } = addOptionToDraft(toPersonaFieldDraft(propertyType), 'Đất nền');
    expect(error).toBeNull();
    expect(draft.options).toHaveLength(3);
    expect(draft.options[2]).toEqual({ value: 'LAND', label: 'Đất nền', isActive: true, isNew: false });
  });

  it('nhãn vừa trùng lựa chọn đang dùng vừa trùng lựa chọn đã tắt: coi là trùng đang dùng, không bật thêm bản thứ hai (nợ QA L4)', () => {
    const draft = {
      fieldId: 'x',
      label: 'X',
      options: [
        { value: 'OLD', label: 'Căn hộ', isActive: false, isNew: false },
        { value: 'CUR', label: 'Căn hộ', isActive: true, isNew: false },
      ],
    };
    const result = addOptionToDraft(draft, 'căn hộ');
    expect(result.error).toBe('Đã có lựa chọn "Căn hộ".');
    expect(result.draft).toBe(draft);
  });

  it('nhãn rỗng/quá dài/đã đủ 100 lựa chọn: báo lỗi', () => {
    const initial = toPersonaFieldDraft(propertyType);
    expect(addOptionToDraft(initial, '   ').error).toBe('Nhập tên lựa chọn.');
    expect(addOptionToDraft(initial, 'x'.repeat(101)).error).toMatch(/tối đa 100/);
    const full = { ...initial, options: Array.from({ length: PERSONA_TOTAL_OPTIONS_MAX }, (_, index) => ({ value: `V${index}`, label: `Lựa chọn ${index}`, isActive: false, isNew: false })) };
    expect(addOptionToDraft(full, 'Mới').error).toMatch(/tối đa 100 lựa chọn/);
  });
});

describe('validatePersonaFieldDraft', () => {
  it('nhãn trống/quá dài báo lỗi; kiểu không có lựa chọn chỉ kiểm nhãn', () => {
    const text = field({ id: 't' });
    expect(validatePersonaFieldDraft({ ...toPersonaFieldDraft(text), label: '  ' }, 'TEXT')).toBe('Nhãn trường không được để trống.');
    expect(validatePersonaFieldDraft({ ...toPersonaFieldDraft(text), label: 'x'.repeat(101) }, 'TEXT')).toMatch(/tối đa 100/);
    expect(validatePersonaFieldDraft(toPersonaFieldDraft(text), 'TEXT')).toBeNull();
  });

  it('SELECT/MULTI_SELECT: tắt hết lựa chọn là lỗi (khớp 400 của BE)', () => {
    const draft = toPersonaFieldDraft(propertyType);
    const allOff = { ...draft, options: draft.options.map((option) => ({ ...option, isActive: false })) };
    expect(validatePersonaFieldDraft(allOff, 'MULTI_SELECT')).toBe('Cần ít nhất một lựa chọn đang dùng.');
    expect(validatePersonaFieldDraft(draft, 'MULTI_SELECT')).toBeNull();
  });

  it('nhãn lựa chọn đang dùng để trống hoặc trùng nhau là lỗi', () => {
    const draft = toPersonaFieldDraft(propertyType);
    const blank = { ...draft, options: draft.options.map((option, index) => (index === 0 ? { ...option, label: ' ' } : option)) };
    expect(validatePersonaFieldDraft(blank, 'MULTI_SELECT')).toBe('Tên lựa chọn không được để trống.');
    const dup = { ...draft, options: draft.options.map((option, index) => (index === 1 ? { ...option, label: 'căn hộ' } : option)) };
    expect(validatePersonaFieldDraft(dup, 'MULTI_SELECT')).toMatch(/trùng nhau/);
  });

  it('lựa chọn ĐÃ TẮT trùng nhãn với lựa chọn đang dùng không chặn lưu (chỉ lựa chọn đang dùng được gửi; nợ QA L4)', () => {
    const draft = toPersonaFieldDraft(propertyType);
    // "Căn hộ" (đang dùng) đổi thành "Đất nền" trùng lựa chọn đã tắt LAND: bản tắt không được gửi lên nên không xung đột.
    const renamed = { ...draft, options: draft.options.map((option, index) => (index === 0 ? { ...option, label: 'Đất nền' } : option)) };
    expect(validatePersonaFieldDraft(renamed, 'MULTI_SELECT')).toBeNull();
    // Hai lựa chọn đang dùng trùng nhãn thì vẫn là lỗi.
    const bothActive = { ...renamed, options: renamed.options.map((option) => (option.value === 'LAND' ? { ...option, isActive: true } : option)) };
    expect(validatePersonaFieldDraft(bothActive, 'MULTI_SELECT')).toMatch(/trùng nhau/);
  });

  it('quá 50 lựa chọn đang dùng hoặc quá 100 tổng: lỗi', () => {
    const make = (active: number, total: number) => ({
      fieldId: 'x',
      label: 'X',
      options: Array.from({ length: total }, (_, index) => ({ value: `V${index}`, label: `L${index}`, isActive: index < active, isNew: false })),
    });
    expect(validatePersonaFieldDraft(make(PERSONA_ACTIVE_OPTIONS_MAX + 1, PERSONA_ACTIVE_OPTIONS_MAX + 1), 'SELECT')).toMatch(/tối đa 50/i);
    expect(validatePersonaFieldDraft(make(PERSONA_ACTIVE_OPTIONS_MAX, PERSONA_ACTIVE_OPTIONS_MAX), 'SELECT')).toBeNull();
    expect(validatePersonaFieldDraft(make(10, PERSONA_TOTAL_OPTIONS_MAX + 1), 'SELECT')).toMatch(/tối đa 100/);
  });
});

describe('buildPersonaFieldPatch (đổi cấu hình không mất dữ liệu cũ)', () => {
  it('không đổi gì -> body rỗng (không gọi API)', () => {
    expect(buildPersonaFieldPatch(propertyType, toPersonaFieldDraft(propertyType))).toEqual({});
  });

  it('chỉ đổi nhãn trường: chỉ có label (kể cả cắt khoảng trắng), không có options', () => {
    expect(buildPersonaFieldPatch(propertyType, { ...toPersonaFieldDraft(propertyType), label: '  Loại BĐS ' })).toEqual({ label: 'Loại BĐS' });
  });

  it('đổi nhãn lựa chọn: giữ nguyên mã value; chỉ gửi lựa chọn đang dùng', () => {
    const draft = toPersonaFieldDraft(propertyType);
    const renamed = { ...draft, options: draft.options.map((option) => (option.value === 'VILLA' ? { ...option, label: 'Biệt thự / Villa' } : option)) };
    expect(buildPersonaFieldPatch(propertyType, renamed)).toEqual({
      options: [
        { value: 'APARTMENT', label: 'Căn hộ', isActive: true },
        { value: 'VILLA', label: 'Biệt thự / Villa', isActive: true },
      ],
    });
  });

  it('tắt một lựa chọn: lựa chọn đó BỊ BỎ khỏi danh sách gửi (BE tắt chứ không xóa)', () => {
    const draft = toPersonaFieldDraft(propertyType);
    const off = { ...draft, options: draft.options.map((option) => (option.value === 'VILLA' ? { ...option, isActive: false } : option)) };
    expect(buildPersonaFieldPatch(propertyType, off).options).toEqual([{ value: 'APARTMENT', label: 'Căn hộ', isActive: true }]);
  });

  it('bật lại lựa chọn đã tắt: gửi với mã cũ; thêm mới: gửi kèm mã sinh ra', () => {
    const { draft: withNew } = addOptionToDraft(toPersonaFieldDraft(propertyType), 'Nhà phố');
    const { draft } = addOptionToDraft(withNew, 'Đất nền');
    expect(buildPersonaFieldPatch(propertyType, draft).options).toEqual([
      { value: 'APARTMENT', label: 'Căn hộ', isActive: true },
      { value: 'VILLA', label: 'Biệt thự', isActive: true },
      { value: 'LAND', label: 'Đất nền', isActive: true },
      { value: 'NHA_PHO', label: 'Nhà phố', isActive: true },
    ]);
  });

  it('kiểu không có lựa chọn không bao giờ gửi options', () => {
    const text = field({ id: 't', label: 'Quê quán' });
    expect(buildPersonaFieldPatch(text, { ...toPersonaFieldDraft(text), label: 'Nơi sinh' })).toEqual({ label: 'Nơi sinh' });
  });

  it('trường có > 50 lựa chọn tổng nhưng ≤ 50 đang dùng: body không vượt trần 50 của BE', () => {
    const options = Array.from({ length: 80 }, (_, index) => ({ value: `V${index}`, label: `Lựa chọn ${index}`, isActive: index < 5 }));
    const big = field({ id: 'big', type: 'SELECT', options });
    const draft = toPersonaFieldDraft(big);
    const renamed = { ...draft, options: draft.options.map((option, index) => (index === 0 ? { ...option, label: 'Đổi tên' } : option)) };
    expect(buildPersonaFieldPatch(big, renamed).options).toHaveLength(5);
  });
});

describe('describePersonaFieldError (theo errorCode, không theo message)', () => {
  const error = (patch: Partial<ApiError>): ApiError => ({ statusCode: 409, errorCode: 'CONFLICT', message: 'Lời máy chủ', ...patch });

  it('PERSONA_FIELD_SYSTEM + field=type: không đổi kiểu trường hệ thống (bỏ qua message)', () => {
    expect(describePersonaFieldError(error({ errorCode: 'PERSONA_FIELD_SYSTEM', message: 'bất kỳ', details: { field: 'type' } }))).toBe(
      'Trường hệ thống không đổi kiểu được. Hãy sửa nhãn/lựa chọn, tắt trường hoặc tạo trường mới.',
    );
  });

  it('PERSONA_FIELD_SYSTEM + valueCount: không xóa được, nêu số khách', () => {
    expect(describePersonaFieldError(error({ errorCode: 'PERSONA_FIELD_SYSTEM', details: { valueCount: 12 } }))).toBe('Trường hệ thống không xóa được (12 khách đang có dữ liệu). Hãy tắt trường nếu không dùng.');
    expect(describePersonaFieldError(error({ errorCode: 'PERSONA_FIELD_SYSTEM' }))).toBe('Trường hệ thống không xóa được. Hãy tắt trường nếu không dùng.');
  });

  it('PERSONA_FIELD_TYPE_LOCKED: nêu số khách đã có dữ liệu', () => {
    expect(describePersonaFieldError(error({ errorCode: 'PERSONA_FIELD_TYPE_LOCKED', details: { valueCount: 3 } }))).toBe('Trường đã có dữ liệu của 3 khách nên không đổi kiểu được. Hãy tạo trường mới.');
    expect(describePersonaFieldError(error({ errorCode: 'PERSONA_FIELD_TYPE_LOCKED', details: { valueCount: 'x' } }))).toBe('Trường đã có dữ liệu nên không đổi kiểu được. Hãy tạo trường mới.');
  });

  it('404: nói trường không còn; VALIDATION_FAILED và lỗi khác: dùng lời máy chủ', () => {
    expect(describePersonaFieldError(error({ statusCode: 404, errorCode: 'RESOURCE_NOT_FOUND' }))).toMatch(/không còn tồn tại/);
    expect(describePersonaFieldError(error({ statusCode: 400, errorCode: 'VALIDATION_FAILED', message: 'Lựa chọn trùng nhau: "A"' }))).toBe('Lựa chọn trùng nhau: "A"');
    expect(describePersonaFieldError(error({ statusCode: 403, errorCode: 'INSUFFICIENT_ROLE', message: 'Bạn không có quyền' }))).toBe('Bạn không có quyền');
  });
});

describe('thêm trường mới (FR-41, T-64)', () => {
  const draftOf = (changes: Partial<ReturnType<typeof createEmptyCreateDraft>> = {}) => ({ ...createEmptyCreateDraft('REAL_ESTATE'), label: 'Tầm nhìn', ...changes });
  const error = (patch: Partial<ApiError>): ApiError => ({ statusCode: 409, errorCode: 'CONFLICT', message: 'Lời máy chủ', ...patch });

  it('suggestPersonaFieldKey: bỏ dấu, chữ thường, nối "_", bắt đầu bằng chữ cái, tối đa 40 ký tự', () => {
    expect(suggestPersonaFieldKey('Tầm nhìn đẹp')).toBe('tam_nhin_dep');
    expect(suggestPersonaFieldKey('123 Tầng')).toBe('f_123_tang');
    expect(suggestPersonaFieldKey('')).toBe('');
    expect(suggestPersonaFieldKey('!!!')).toBe('');
    expect(suggestPersonaFieldKey('a'.repeat(60))).toHaveLength(40);
  });

  it('draft rỗng: nhóm được chọn, kiểu TEXT, trọng số 1, không lọc/nhạy cảm, chưa tự sửa key', () => {
    expect(createEmptyCreateDraft('LIFESTYLE')).toMatchObject({ groupCode: 'LIFESTYLE', type: 'TEXT', weight: '1', isFilterable: false, isSensitive: false, options: [], isKeyEdited: false });
  });

  it('validateCreateDraft: nhãn, key, trọng số', () => {
    expect(validateCreateDraft(draftOf({ label: ' ', key: 'x' }))).toBe('Nhãn trường không được để trống.');
    expect(validateCreateDraft(draftOf({ key: '' }))).toMatch(/Mã trường/);
    expect(validateCreateDraft(draftOf({ key: 'Tam Nhin' }))).toMatch(/Mã trường/);
    expect(validateCreateDraft(draftOf({ key: '1abc' }))).toMatch(/Mã trường/);
    expect(validateCreateDraft(draftOf({ key: 'a'.repeat(41) }))).toMatch(/Mã trường/);
    expect(validateCreateDraft(draftOf({ key: 'tam_nhin', weight: '101' }))).toMatch(/Trọng số/);
    expect(validateCreateDraft(draftOf({ key: 'tam_nhin', weight: '-1' }))).toMatch(/Trọng số/);
    expect(validateCreateDraft(draftOf({ key: 'tam_nhin', weight: '1.5' }))).toMatch(/Trọng số/);
    expect(validateCreateDraft(draftOf({ key: 'tam_nhin', weight: '' }))).toMatch(/Trọng số/);
    expect(validateCreateDraft(draftOf({ key: 'tam_nhin', weight: '100' }))).toBeNull();
  });

  it('validateCreateDraft: SELECT/MULTI_SELECT cần ít nhất 1 lựa chọn; kiểu khác bỏ qua lựa chọn', () => {
    expect(validateCreateDraft(draftOf({ key: 'tam_nhin', type: 'SELECT' }))).toBe('Cần ít nhất một lựa chọn đang dùng.');
    const option = { value: 'BIEN', label: 'Biển', isActive: true, isNew: true };
    expect(validateCreateDraft(draftOf({ key: 'tam_nhin', type: 'MULTI_SELECT', options: [option] }))).toBeNull();
    expect(validateCreateDraft(draftOf({ key: 'tam_nhin', type: 'MULTI_SELECT', options: [option, { ...option, value: 'BIEN_2', label: 'biển' }] }))).toMatch(/trùng nhau/);
    expect(validateCreateDraft(draftOf({ key: 'tam_nhin', type: 'TEXT', options: [option] }))).toBeNull();
  });

  it('validateCreateDraft: nhạy cảm và lọc được không đi cùng nhau; lọc được chỉ với TEXT/SELECT/MULTI_SELECT/BOOLEAN', () => {
    expect(validateCreateDraft(draftOf({ key: 'k', isFilterable: true, isSensitive: true }))).toMatch(/nhạy cảm/i);
    for (const type of ['TEXTAREA', 'NUMBER_RANGE', 'DATE'] as const) {
      expect(validateCreateDraft(draftOf({ key: 'k', type, isFilterable: true }))).toMatch(/lọc/i);
    }
    expect(validateCreateDraft(draftOf({ key: 'k', type: 'BOOLEAN', isFilterable: true }))).toBeNull();
    expect(validateCreateDraft(draftOf({ key: 'k', type: 'TEXT', isSensitive: true }))).toBeNull();
  });

  it('buildCreatePersonaFieldBody: gửi key/label/nhóm/kiểu/trọng số/cờ; options chỉ với SELECT/MULTI_SELECT, cắt khoảng trắng', () => {
    expect(buildCreatePersonaFieldBody(draftOf({ key: 'tam_nhin', label: '  Tầm nhìn ', weight: '7', isFilterable: true }))).toEqual({
      key: 'tam_nhin',
      label: 'Tầm nhìn',
      groupCode: 'REAL_ESTATE',
      type: 'TEXT',
      weight: 7,
      isFilterable: true,
      isSensitive: false,
    });
    const body = buildCreatePersonaFieldBody(
      draftOf({ key: 'huong', type: 'SELECT', options: [{ value: 'DONG', label: ' Đông ', isActive: true, isNew: true }, { value: 'TAY', label: 'Tây', isActive: false, isNew: true }] }),
    );
    expect(body.options).toEqual([{ value: 'DONG', label: 'Đông', isActive: true }]);
  });

  it('changeCreateDraftType: đổi sang kiểu không lọc được thì tự bỏ "Lọc được", kiểu lọc được thì giữ nguyên', () => {
    expect(changeCreateDraftType(draftOf({ type: 'TEXT', isFilterable: true }), 'DATE')).toMatchObject({ type: 'DATE', isFilterable: false });
    expect(changeCreateDraftType(draftOf({ type: 'TEXT', isFilterable: true }), 'SELECT')).toMatchObject({ type: 'SELECT', isFilterable: true });
    expect(changeCreateDraftType(draftOf({ type: 'TEXT', isFilterable: false }), 'BOOLEAN').isFilterable).toBe(false);
  });

  it('canDeletePersonaField: chỉ trường không phải hệ thống mới có nút xóa', () => {
    expect(canDeletePersonaField(field({ id: 'a', isSystem: false }))).toBe(true);
    expect(canDeletePersonaField(field({ id: 'b', isSystem: true }))).toBe(false);
  });

  it('describePersonaFieldError: 409 CATALOG_DUPLICATED trên key báo mã trường đã tồn tại', () => {
    expect(describePersonaFieldError(error({ errorCode: 'CATALOG_DUPLICATED', details: { field: 'key', value: 'tam_nhin' } }))).toMatch(/tam_nhin.*đã/);
  });
});

describe('isAdvancedFilterType', () => {
  it('chỉ SELECT, MULTI_SELECT, BOOLEAN hiện ở bộ lọc nâng cao; TEXT và các kiểu khác thì không', () => {
    expect(['SELECT', 'MULTI_SELECT', 'BOOLEAN'].map((type) => isAdvancedFilterType(type as never))).toEqual([true, true, true]);
    expect(['TEXT', 'TEXTAREA', 'DATE', 'NUMBER_RANGE'].map((type) => isAdvancedFilterType(type as never))).toEqual([false, false, false, false]);
  });
});
