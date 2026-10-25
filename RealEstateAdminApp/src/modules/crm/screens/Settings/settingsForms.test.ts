import { describe, expect, it } from 'vitest';
import type { CrmSettings, CustomerStatusItem } from '@crm/types/crm';
import {
  createEmptyDraft,
  createEmptyUserDraft,
  deriveCatalogCode,
  diffSettings,
  getNextOrder,
  parseNumberList,
  parseSettingsDraft,
  sortCatalogItems,
  toCatalogBody,
  toDraft,
  toSettingsDraft,
  validateDraft,
  validateNewUser,
  validateTeam,
} from './settingsForms';

const SETTINGS: CrmSettings = {
  staleCustomerDays: 14,
  staleCheckTime: '08:00',
  occasionNotifyTime: '07:30',
  occasionLeadDays: [0, 1],
  defaultAppointmentReminderMinutes: [60, 1440],
  careLogEditWindowHours: 24,
  careLogNotifyDebounceMinutes: 10,
  phoneViewAlertPerHour: 200,
};

const STATUS: CustomerStatusItem = { id: 's1', code: 'INTERESTED', label: 'Có quan tâm', listGroup: 'INTERESTED', tone: 'success', order: 2, isDefault: false, isSystem: true, isActive: true };

describe('danh mục: bản nháp -> body API', () => {
  it('thứ tự kế tiếp = lớn nhất + 1; mục ẩn xếp cuối', () => {
    expect(getNextOrder([STATUS, { ...STATUS, id: 's2', order: 5 }])).toBe(6);
    expect(getNextOrder([])).toBe(1);
    expect(sortCatalogItems([{ ...STATUS, id: 'a', order: 2 }, { ...STATUS, id: 'b', order: 1, isActive: false }, { ...STATUS, id: 'c', order: 3 }]).map((item) => item.id)).toEqual(['a', 'c', 'b']);
  });

  it('mã sinh từ tên: chữ HOA không dấu, bắt đầu bằng chữ, tối đa 30 ký tự', () => {
    expect(deriveCatalogCode('Hội chợ BĐS')).toBe('HOI_CHO_BDS');
    expect(deriveCatalogCode('123 Facebook')).toBe('FACEBOOK');
    expect(deriveCatalogCode('a'.repeat(50))).toHaveLength(30);
    expect(deriveCatalogCode('!!!')).toBe('');
  });

  it('tạo tình trạng gửi code + listGroup; sửa KHÔNG gửi code; tình trạng hệ thống không gửi listGroup', () => {
    const create = toCatalogBody('statuses', { ...createEmptyDraft([]), name: ' Đã đặt cọc ', listGroup: 'NET', tone: 'warning' });
    expect(create).toEqual({ code: 'DA_DAT_COC', label: 'Đã đặt cọc', listGroup: 'NET', color: 'warning', order: 1 });
    const editSystem = toCatalogBody('statuses', { ...toDraft(STATUS), name: 'Quan tâm', isDefault: false });
    expect(editSystem).not.toHaveProperty('code');
    expect(editSystem).not.toHaveProperty('listGroup');
    expect(editSystem).toMatchObject({ label: 'Quan tâm', isActive: true });
    expect(toCatalogBody('statuses', { ...toDraft({ ...STATUS, isSystem: false }), listGroup: 'DROPPED' })).toHaveProperty('listGroup', 'DROPPED');
  });

  it('nguồn khách và khu vực: body đúng DTO (khu vực đổi cha = parentId, null về gốc)', () => {
    expect(toCatalogBody('leadSources', { ...createEmptyDraft([]), name: 'Zalo OA' })).toEqual({ code: 'ZALO_OA', label: 'Zalo OA', order: 1 });
    expect(toCatalogBody('areas', { ...createEmptyDraft([]), name: 'Thủ Đức', areaType: 'DISTRICT', parentId: 'p1' })).toEqual({ name: 'Thủ Đức', type: 'DISTRICT', order: 1, parentId: 'p1' });
    const editArea = toCatalogBody('areas', { ...createEmptyDraft([]), id: 'a1', name: 'Thủ Đức', parentId: '' });
    expect(editArea).toMatchObject({ parentId: null });
    expect(editArea).not.toHaveProperty('type');
  });

  it('kiểm tên/mã/thứ tự trước khi gọi API', () => {
    expect(validateDraft('leadSources', createEmptyDraft([]))).toMatch(/nhập tên/);
    expect(validateDraft('leadSources', { ...createEmptyDraft([]), name: '123' })).toMatch(/mã/);
    expect(validateDraft('leadSources', { ...createEmptyDraft([]), name: 'Zalo' })).toBeNull();
    expect(validateDraft('areas', { ...createEmptyDraft([]), name: 'Q7', order: -1 })).toMatch(/Thứ tự/);
  });
});

describe('cài đặt nhắc việc (05 §2.14)', () => {
  it('khứ hồi bản nháp -> giá trị, danh sách phân tách dấu phẩy', () => {
    const parsed = parseSettingsDraft(toSettingsDraft(SETTINGS));
    expect(parsed).toEqual({ value: SETTINGS });
    expect(parseNumberList('60, 1440,')).toEqual([60, 1440]);
    expect(parseNumberList('1, x')[1]).toBeNaN();
  });

  it.each([
    [{ staleCustomerDays: '0' }, /Khách lâu chưa chăm sóc/],
    [{ staleCustomerDays: '400' }, /từ 1 đến 365/],
    [{ staleCheckTime: '24:00' }, /HH:mm/],
    [{ occasionLeadDays: '0, 0' }, /số khác nhau/],
    [{ occasionLeadDays: '31' }, /0 đến 30/],
    [{ defaultAppointmentReminderMinutes: '1,2,3,4,5,6' }, /1–5 số/],
    [{ phoneViewAlertPerHour: '1.5' }, /số nguyên/],
  ])('từ chối giá trị sai %j', (override, message) => {
    const result = parseSettingsDraft({ ...toSettingsDraft(SETTINGS), ...override });
    expect(result).toHaveProperty('error');
    expect((result as { error: string }).error).toMatch(message);
  });

  it('chỉ gửi trường đã đổi', () => {
    expect(diffSettings(SETTINGS, SETTINGS)).toEqual({});
    expect(diffSettings(SETTINGS, { ...SETTINGS, occasionLeadDays: [0, 1, 3], staleCustomerDays: 30 })).toEqual({ occasionLeadDays: [0, 1, 3], staleCustomerDays: 30 });
  });
});

describe('tài khoản và nhóm', () => {
  it('tạo tài khoản: email, mật khẩu ≥ 8, tên hiển thị; Quản lý/Nhân viên cần nhóm, Quản trị thì không', () => {
    const draft = { ...createEmptyUserDraft('t1'), email: 'a@b.vn', password: 'Matkhau123', displayName: 'An' };
    expect(validateNewUser(draft)).toBeNull();
    expect(validateNewUser({ ...draft, email: 'abc' })).toMatch(/Email/);
    expect(validateNewUser({ ...draft, password: '1234567' })).toMatch(/Mật khẩu/);
    expect(validateNewUser({ ...draft, displayName: ' ' })).toMatch(/tên hiển thị/);
    expect(validateNewUser({ ...draft, teamId: '' })).toMatch(/nhóm/);
    expect(validateNewUser({ ...draft, teamId: '', role: 'ADMIN' })).toBeNull();
  });

  it('nhóm: tên bắt buộc; mã chỉ kiểm khi tạo (không đổi sau đó)', () => {
    expect(validateTeam({ id: null, name: 'KD1', code: 'KD 1', managerIds: [], isActive: true })).toMatch(/Mã nhóm/);
    expect(validateTeam({ id: null, name: 'KD1', code: 'KD-1', managerIds: [], isActive: true })).toBeNull();
    expect(validateTeam({ id: 't1', name: '', code: '', managerIds: [], isActive: true })).toMatch(/tên nhóm/);
    expect(validateTeam({ id: 't1', name: 'KD1', code: '', managerIds: [], isActive: true })).toBeNull();
  });
});
