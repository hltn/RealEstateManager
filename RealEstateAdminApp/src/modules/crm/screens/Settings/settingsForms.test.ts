import { describe, expect, it } from 'vitest';
import type { ApiError } from '@crm/api';
import type { AdminUser, CrmSettings, CustomerStatusItem, UserRole } from '@crm/types/crm';
import {
  createEmptyDraft,
  withAreaParent,
  buildCreateUserBody,
  createEmptyUserDraft,
  planUserUpdate,
  orderUserUpdateSteps,
  describeStepError,
  describeUserSaveFailure,
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
  type UserUpdateStep,
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

  it('thêm khu vực mới mặc định là Tỉnh/Thành; chọn cha -> Quận/Huyện, bỏ cha -> về Tỉnh/Thành, loại do người dùng chọn thì giữ', () => {
    const draft = createEmptyDraft([]);
    expect(draft.areaType).toBe('PROVINCE');
    const withParent = withAreaParent(draft, 'p1');
    expect(withParent).toMatchObject({ parentId: 'p1', areaType: 'DISTRICT' });
    expect(withAreaParent(withParent, '')).toMatchObject({ parentId: '', areaType: 'PROVINCE' });
    expect(withAreaParent({ ...draft, areaType: 'WARD' }, 'p1')).toMatchObject({ parentId: 'p1', areaType: 'WARD' });
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
    expect(validateNewUser({ ...draft, teamIds: [] })).toMatch(/nhóm/);
    expect(validateNewUser({ ...draft, teamIds: [], roles: ['ADMIN'] })).toBeNull();
    expect(validateNewUser({ ...draft, roles: [] })).toMatch(/vai trò/);
    // ADMIN + STAFF vẫn có role thuộc nhóm nên cần nhóm.
    expect(validateNewUser({ ...draft, teamIds: [], roles: ['ADMIN', 'STAFF'] })).toMatch(/nhóm/);
  });

  it('body tạo tài khoản: roles[] sắp theo role cao nhất, teamIds giữ thứ tự chọn, không gửi role/teamId đơn; ADMIN thuần không có teamIds', () => {
    const draft = { ...createEmptyUserDraft('t1'), email: ' A@B.vn ', password: 'Matkhau123', displayName: ' An ', roles: ['STAFF', 'MANAGER'] as UserRole[], teamIds: ['t2', 't1'] };
    expect(buildCreateUserBody(draft)).toEqual({ email: 'a@b.vn', password: 'Matkhau123', displayName: 'An', roles: ['MANAGER', 'STAFF'], teamIds: ['t2', 't1'] });
    expect(buildCreateUserBody({ ...draft, roles: ['ADMIN'] })).toEqual({ email: 'a@b.vn', password: 'Matkhau123', displayName: 'An', roles: ['ADMIN'] });
  });

  describe('planUserUpdate', () => {
    const user: AdminUser = { id: 'u1', fullName: 'An', displayName: 'An', role: 'MANAGER', jobTitle: '', teamId: 't1', isActive: true, roles: ['MANAGER', 'STAFF'], teamIds: ['t1', 't2'] };
    const same = { roles: ['MANAGER', 'STAFF'] as UserRole[], teamIds: ['t1', 't2'], isActive: true };

    it('không đổi gì -> kế hoạch rỗng', () => {
      expect(planUserUpdate(user, same)).toEqual({ plan: {} });
    });

    it('đổi role + nhóm + trạng thái -> đủ ba việc, nhóm giữ thứ tự (nhóm chính = đầu)', () => {
      expect(planUserUpdate(user, { roles: ['ADMIN', 'STAFF'], teamIds: ['t2'], isActive: false })).toEqual({ plan: { roles: ['ADMIN', 'STAFF'], teamIds: ['t2'], status: 'BLOCKED' } });
    });

    it('mất cả MANAGER lẫn STAFF -> không gọi /teams (backend tự xóa nhóm) và không đòi nhóm', () => {
      expect(planUserUpdate(user, { roles: ['ADMIN'], teamIds: [], isActive: true })).toEqual({ plan: { roles: ['ADMIN'] } });
    });

    it('thêm role thuộc nhóm cho Quản trị -> phải chọn nhóm; chọn rồi thì gọi roles trước rồi teams', () => {
      const admin: AdminUser = { ...user, role: 'ADMIN', teamId: null, roles: ['ADMIN'], teamIds: [] };
      expect(planUserUpdate(admin, { roles: ['ADMIN', 'STAFF'], teamIds: [], isActive: true })).toEqual({ error: expect.stringMatching(/nhóm/) });
      expect(planUserUpdate(admin, { roles: ['ADMIN', 'STAFF'], teamIds: ['t1'], isActive: true })).toEqual({ plan: { roles: ['ADMIN', 'STAFF'], teamIds: ['t1'] } });
    });

    it('giữ role EDITOR sẵn có (không sửa được ở đây) nên lưu không làm mất EDITOR; không chọn role CRM nào -> lỗi', () => {
      const withEditor: AdminUser = { ...user, roles: ['MANAGER', 'EDITOR'], teamIds: ['t1'] };
      expect(planUserUpdate(withEditor, { roles: ['MANAGER', 'STAFF'], teamIds: ['t1'], isActive: true })).toEqual({ plan: { roles: ['MANAGER', 'STAFF', 'EDITOR'] } });
      expect(planUserUpdate(withEditor, { roles: [], teamIds: ['t1'], isActive: true })).toEqual({ error: expect.stringMatching(/vai trò/) });
    });

    it('tài khoản vốn chưa có nhóm chỉ đổi trạng thái thì không bị ép chọn nhóm', () => {
      const teamless: AdminUser = { ...user, role: 'STAFF', teamId: null, roles: ['STAFF'], teamIds: [] };
      expect(planUserUpdate(teamless, { roles: ['STAFF'], teamIds: [], isActive: false })).toEqual({ plan: { status: 'BLOCKED' } });
    });
  });

  describe('orderUserUpdateSteps', () => {
    const admin: AdminUser = { id: 'me', fullName: 'Tôi', displayName: 'Tôi', role: 'ADMIN', jobTitle: '', teamId: null, isActive: true, roles: ['ADMIN', 'STAFF'], teamIds: ['t1'] };
    const kinds = (steps: ReturnType<typeof orderUserUpdateSteps>) => steps.map((step) => (step.kind === 'roles' && step.isInterim ? 'roles*' : step.kind));

    it('bình thường: roles -> teams -> status', () => {
      expect(kinds(orderUserUpdateSteps(admin, { roles: ['MANAGER', 'STAFF'], teamIds: ['t2'], status: 'BLOCKED' }, false))).toEqual(['roles', 'teams', 'status']);
    });

    it('Quản trị tự bỏ ADMIN: teams/status (cần ADMIN) chạy TRƯỚC, roles cuối cùng', () => {
      expect(kinds(orderUserUpdateSteps(admin, { roles: ['STAFF'], teamIds: ['t2'], status: 'BLOCKED' }, true))).toEqual(['teams', 'status', 'roles']);
    });

    it('tự bỏ ADMIN mà chưa có role thuộc nhóm: chèn bước roles tạm (hợp role cũ + mới, còn ADMIN) trước teams', () => {
      const onlyAdmin: AdminUser = { ...admin, roles: ['ADMIN'], teamIds: [] };
      const steps = orderUserUpdateSteps(onlyAdmin, { roles: ['STAFF'], teamIds: ['t1'] }, true);
      expect(kinds(steps)).toEqual(['roles*', 'teams', 'roles']);
      expect(steps[0]).toMatchObject({ roles: ['ADMIN', 'STAFF'] });
    });

    it('người khác bị bỏ ADMIN, hoặc chính mình nhưng vẫn giữ ADMIN: giữ thứ tự thường', () => {
      expect(kinds(orderUserUpdateSteps(admin, { roles: ['STAFF'], teamIds: ['t2'] }, false))).toEqual(['roles', 'teams']);
      expect(kinds(orderUserUpdateSteps(admin, { roles: ['ADMIN', 'MANAGER'], teamIds: ['t2'] }, true))).toEqual(['roles', 'teams']);
    });
  });

  describe('thông báo lỗi lưu nhiều bước', () => {
    const roles: UserUpdateStep = { kind: 'roles', roles: ['STAFF'] };
    const teams: UserUpdateStep = { kind: 'teams', teamIds: ['t1'] };
    const status: UserUpdateStep = { kind: 'status', status: 'BLOCKED' };

    it('nêu phần đã lưu, phần lỗi (kèm lý do) và phần chưa chạy', () => {
      expect(describeUserSaveFailure({ done: [roles], failed: teams, pending: [status], reason: 'Nhóm không tồn tại' })).toBe(
        'Đã lưu vai trò; chưa lưu được nhóm: Nhóm không tồn tại (chưa thực hiện: trạng thái). Bấm Lưu để thử lại phần còn lại.',
      );
      expect(describeUserSaveFailure({ done: [], failed: roles, pending: [], reason: 'Lỗi' })).toBe('Chưa lưu được vai trò: Lỗi. Bấm Lưu để thử lại.');
    });

    it('lời máy chủ có dấu chấm cuối thì không bị chấm đôi', () => {
      expect(describeUserSaveFailure({ done: [], failed: roles, pending: [], reason: 'Hệ thống phải còn một Quản trị.' })).toBe('Chưa lưu được vai trò: Hệ thống phải còn một Quản trị. Bấm Lưu để thử lại.');
    });

    it('403 chung chung (đúng lời máy chủ, KHÔNG dấu chấm) được giải thích là mất quyền Quản trị; lỗi nghiệp vụ giữ nguyên lời máy chủ', () => {
      const generic: ApiError = { statusCode: 403, errorCode: 'INSUFFICIENT_ROLE', message: 'Bạn không có quyền thực hiện thao tác này' };
      expect(describeStepError(generic)).toMatch(/không còn quyền Quản trị/);
      for (const message of ['Bạn không quản lý nhóm này', 'Cannot block your own account']) {
        expect(describeStepError({ statusCode: 403, errorCode: 'INSUFFICIENT_ROLE', message })).toBe(message);
      }
      const lastAdmin: ApiError = { statusCode: 409, errorCode: 'LAST_ADMIN_REQUIRED', message: 'Hệ thống phải còn ít nhất một Quản trị đang hoạt động' };
      expect(describeStepError(lastAdmin)).toBe(lastAdmin.message);
      const reasoned: ApiError = { statusCode: 403, errorCode: 'INSUFFICIENT_ROLE', message: 'Không thể khóa chính tài khoản của bạn' };
      expect(describeStepError(reasoned)).toBe(reasoned.message);
    });
  });

  it('nhóm: tên bắt buộc; mã chỉ kiểm khi tạo (không đổi sau đó)', () => {
    expect(validateTeam({ id: null, name: 'KD1', code: 'KD 1', managerIds: [], isActive: true })).toMatch(/Mã nhóm/);
    expect(validateTeam({ id: null, name: 'KD1', code: 'KD-1', managerIds: [], isActive: true })).toBeNull();
    expect(validateTeam({ id: 't1', name: '', code: '', managerIds: [], isActive: true })).toMatch(/tên nhóm/);
    expect(validateTeam({ id: 't1', name: 'KD1', code: '', managerIds: [], isActive: true })).toBeNull();
  });
});
