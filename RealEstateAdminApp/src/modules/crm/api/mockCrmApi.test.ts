import { beforeEach, describe, expect, it } from 'vitest';
import { resetNationalIdVaultForTest, seedNationalIds } from '@crm/lib/nationalIdVault';
import { createTestHarness, FIXED_NOW } from '@crm/test/fixtures';
import { getCustomer } from './queries';
import { buildActor } from './access';
import { selectCurrentUser } from '@crm/store/selectors';

beforeEach(() => {
  resetNationalIdVaultForTest();
  seedNationalIds({ 'CUST-001': '079092001234' });
});

describe('createCustomer (C1, X2, QT3, QT4)', () => {
  it('chỉ bắt buộc họ tên + SĐT; khách mới tiến độ 0%, tình trạng mặc định "Chưa tiếp cận", SĐT lưu E.164', () => {
    const { api } = createTestHarness('hanh');
    const result = api.createCustomer({ fullName: 'Khách Mới', phone: '0900 111 222' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.progress).toBe(0);
    expect(result.data.status.code).toBe('NOT_CONTACTED');
    expect(result.data.phone).toBe('+84900111222');
    expect(result.data.primaryAssignee).toBeNull();
  });

  it('Nhân viên tạo khách luôn là phụ trách chính (dù chọn người khác)', () => {
    const { api } = createTestHarness('thao');
    const result = api.createCustomer({ fullName: 'Khách NV', phone: '0900 111 333', careTeam: { primaryUserId: 'tuan', memberIds: [] } });
    expect(result.ok && result.data.primaryAssignee?.id).toBe('thao');
  });

  it('trùng SĐT -> 409 chỉ báo "do [tên] chăm sóc", không lộ tên khách', () => {
    const { api } = createTestHarness('thao');
    const result = api.createCustomer({ fullName: 'Trùng', phone: '+84 988 333 112' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.errorCode).toBe('CUSTOMER_PHONE_DUPLICATED');
    expect(result.error.message).toBe('Đã có khách hàng với số điện thoại này, do Minh chăm sóc.');
    expect(JSON.stringify(result.error)).not.toContain('Bích');
  });

  it('thiếu tên / SĐT sai -> lỗi', () => {
    const { api } = createTestHarness();
    expect(api.createCustomer({ fullName: ' ', phone: '0900111444' }).ok).toBe(false);
    const invalid = api.createCustomer({ fullName: 'A', phone: '123' });
    expect(!invalid.ok && invalid.error.errorCode).toBe('INVALID_PHONE');
  });

  it('có thành viên mà không có phụ trách chính -> PRIMARY_REQUIRED', () => {
    const { api } = createTestHarness('hanh');
    const result = api.createCustomer({ fullName: 'A', phone: '0900111555', careTeam: { primaryUserId: '', memberIds: ['thao'] } });
    expect(!result.ok && result.error.errorCode).toBe('PRIMARY_REQUIRED');
  });
});

describe('đề nghị tham gia nhóm chăm sóc (X2)', () => {
  it('gửi -> phụ trách chính duyệt -> người gửi thành MEMBER; gửi lặp bị chặn', () => {
    const harness = createTestHarness('thao');
    const lookup = harness.api.lookupPhone('0988333112');
    const customerRef = lookup.ok ? (lookup.data.customerRef as string) : '';
    expect(customerRef).toMatch(/^JR-/);
    expect(customerRef).not.toContain('CUST-002'); // TB9: token mờ, không lộ id nội bộ
    const created = harness.api.createCareTeamRequest({ customerRef, message: 'Khách gọi cho em' });
    expect(created.ok).toBe(true);
    const duplicate = harness.api.createCareTeamRequest({ customerRef });
    expect(!duplicate.ok && duplicate.error.errorCode).toBe('JOIN_REQUEST_EXISTS');

    const requestId = created.ok ? created.data.id : '';
    harness.switchUser('tung'); // không phải phụ trách chính, không phải quản lý nhóm
    const forbidden = harness.api.resolveCareTeamRequest(requestId, 'APPROVED');
    expect(forbidden.ok).toBe(false);

    harness.switchUser('minh');
    expect(harness.api.resolveCareTeamRequest(requestId, 'APPROVED').ok).toBe(true);
    const customer = harness.getState().customers.find((item) => item.id === 'CUST-002');
    expect(customer?.careTeam.find((member) => member.userId === 'thao')?.role).toBe('MEMBER');
    expect(harness.getState().changeLogs.some((log) => log.action === 'CARE_TEAM_MEMBER_ADDED' && log.customerId === 'CUST-002')).toBe(true);
  });
});

describe('đổi tình trạng + Hoàn tác (C6, QT2)', () => {
  it('đổi sang Bỏ rồi hoàn tác về tình trạng cũ, cả 2 lần đều ghi lịch sử', () => {
    const { api, getState } = createTestHarness('hanh');
    const changed = api.updateCustomerStatus('CUST-001', { statusId: 'st-dropped' });
    expect(changed.ok && changed.data.previousStatusId).toBe('st-interested');
    const undo = api.updateCustomerStatus('CUST-001', { statusId: 'st-interested' });
    expect(undo.ok).toBe(true);
    expect(getState().changeLogs.filter((log) => log.action === 'STATUS_CHANGED' && log.customerId === 'CUST-001')).toHaveLength(2);
  });

  it('version lệch -> 409 VERSION_CONFLICT', () => {
    const { api } = createTestHarness('hanh');
    const result = api.updateCustomerStatus('CUST-001', { statusId: 'st-net', version: 999 });
    expect(!result.ok && result.error.errorCode).toBe('VERSION_CONFLICT');
  });

  it('khách ngoài phạm vi -> 404 (không 403)', () => {
    const { api } = createTestHarness('thao');
    const result = api.updateCustomerStatus('CUST-002', { statusId: 'st-net' });
    expect(!result.ok && result.error.statusCode).toBe(404);
  });
});

describe('tiêu chí (C4, C5)', () => {
  it('sửa mô tả + dấu đạt; tiến độ do hệ thống tính lại', () => {
    const { api } = createTestHarness('hanh');
    const result = api.updateCustomerCriteria('CUST-011', { criteria: { demand: { isDone: true, description: 'Căn 2PN' }, timing: { description: 'Quý 1' } } });
    expect(result.ok && result.data.progress).toBe(25);
    expect(result.ok && result.data.criteria.demand.description).toBe('Căn 2PN');
    expect(result.ok && result.data.criteria.timing.isDone).toBe(false);
    expect(result.ok && result.data.criteria.demand.updatedBy?.id).toBe('hanh');
  });
});

describe('CCCD (C9)', () => {
  it('nhân viên thường không được xem đầy đủ (403); phụ trách chính xem được và mỗi lần xem có log', () => {
    const harness = createTestHarness('thao');
    const forbidden = harness.api.createNationalIdView('CUST-001');
    expect(!forbidden.ok && forbidden.error.errorCode).toBe('NATIONAL_ID_FORBIDDEN');

    harness.switchUser('hanh');
    const viewed = harness.api.createNationalIdView('CUST-001');
    expect(viewed.ok && viewed.data.nationalId).toBe('079092001234');
    harness.api.createNationalIdView('CUST-001');
    expect(harness.getState().nationalIdViews.filter((view) => view.customerId === 'CUST-001' && view.viewerId === 'hanh')).toHaveLength(2);
  });

  it('nhập CCCD mới chỉ lưu 4 số cuối trong hồ sơ', () => {
    const { api, getState } = createTestHarness('hanh');
    expect(api.putNationalId('CUST-006', '001 086 123 456').ok).toBe(true);
    const customer = getState().customers.find((item) => item.id === 'CUST-006');
    expect(customer?.nationalIdLast4).toBe('3456');
    expect(JSON.stringify(customer)).not.toContain('001086123456');
  });
});

describe('nhóm chăm sóc (C8, QT7)', () => {
  it('phụ trách chính thêm được thành viên nhưng không gỡ được chính mình', () => {
    const { api } = createTestHarness('tung');
    expect(api.addCareTeamMembers('CUST-003', { userIds: ['quan'] }).ok).toBe(true);
    const removePrimary = api.removeCareTeamMember('CUST-003', 'tung', 'vy');
    expect(!removePrimary.ok && removePrimary.error.errorCode).toBe('CARE_TEAM_ACTION_FORBIDDEN');
  });

  it('Quản lý gỡ phụ trách chính phải chọn người thay; luôn còn đúng 1 PRIMARY', () => {
    const { api, getState } = createTestHarness('minh');
    const missing = api.removeCareTeamMember('CUST-003', 'tung');
    expect(!missing.ok && missing.error.errorCode).toBe('PRIMARY_REPLACEMENT_REQUIRED');
    expect(api.removeCareTeamMember('CUST-003', 'tung', 'vy').ok).toBe(true);
    const team = getState().customers.find((item) => item.id === 'CUST-003')?.careTeam ?? [];
    expect(team.filter((member) => member.role === 'PRIMARY').map((member) => member.userId)).toEqual(['vy']);
    expect(team.some((member) => member.userId === 'tung')).toBe(false);
  });

  it('đổi phụ trách chính: người mới thành PRIMARY, người cũ thành MEMBER', () => {
    const { api, getState } = createTestHarness('hanh');
    expect(api.changePrimary('CUST-001', 'thao').ok).toBe(true);
    const team = getState().customers.find((item) => item.id === 'CUST-001')?.careTeam ?? [];
    expect(team.find((member) => member.userId === 'thao')?.role).toBe('PRIMARY');
    expect(team.find((member) => member.userId === 'hanh')?.role).toBe('MEMBER');
  });
});

describe('nhật ký + nhắc việc tiếp theo (C2, C3)', () => {
  it('tác giả = người dùng hiện tại; có hạn + tạo lịch hẹn -> sinh lịch, cập nhật nextAppointmentAt', () => {
    const { api, getState } = createTestHarness('thao');
    const dueAt = new Date(FIXED_NOW.getTime() + 2 * 24 * 60 * 60 * 1000).toISOString();
    const result = api.createCareLog('CUST-001', {
      content: 'Gọi khách, hẹn gọi lại',
      contactChannel: 'CALL',
      contactResultId: 'cr-busy',
      nextAction: { suggestion: 'Gọi lại tư vấn', dueAt, appointment: { type: 'CALLBACK' } },
    });
    expect(result.ok && result.data.author.id).toBe('thao');
    expect(result.ok && result.data.isPrimaryAuthor).toBe(false);
    const appointment = getState().appointments.find((item) => item.sourceCareLogId === (result.ok ? result.data.id : ''));
    expect(appointment).toMatchObject({ type: 'CALLBACK', startAt: dueAt, assigneeId: 'thao' });
    const state = getState();
    const detail = getCustomer(state, buildActor(selectCurrentUser(state), state.teams), 'CUST-001');
    expect(detail?.lastCareLogAt).toBe(FIXED_NOW.toISOString());
  });

  it('lịch hẹn: người thực hiện phải thuộc nhóm chăm sóc', () => {
    const { api } = createTestHarness('hanh');
    const result = api.createAppointment({ customerId: 'CUST-001', type: 'MEETING', startAt: FIXED_NOW.toISOString(), assigneeId: 'tuan' });
    expect(!result.ok && result.error.errorCode).toBe('USER_NOT_ASSIGNABLE');
    expect(api.createAppointment({ customerId: 'CUST-001', type: 'MEETING', startAt: FIXED_NOW.toISOString(), assigneeId: 'thao' }).ok).toBe(true);
  });
});

describe('chân dung (QT9)', () => {
  it('lưu giá trị kèm nguồn/người/ngày và tính lại độ đầy đủ', () => {
    const { api, getState } = createTestHarness('hanh');
    const before = getState().customers.find((item) => item.id === 'CUST-011')?.personaCompleteness ?? 0;
    const result = api.updateCustomerPersona('CUST-011', {
      values: [{ fieldKey: 'occupation', value: { valueText: 'Kế toán' }, source: 'CUSTOMER_SHARED' }],
    });
    expect(result.ok).toBe(true);
    const customer = getState().customers.find((item) => item.id === 'CUST-011');
    expect(customer?.persona.find((value) => value.fieldKey === 'occupation')).toMatchObject({ source: 'CUSTOMER_SHARED', updatedBy: 'hanh' });
    expect(customer?.personaCompleteness).toBeGreaterThan(before);
    expect(getState().changeLogs[0]).toMatchObject({ action: 'PERSONA_UPDATED', changes: [{ field: 'Chân dung: Nghề nghiệp / chức vụ', from: '(trống)', to: 'Kế toán' }] });
  });

  it('trường không tồn tại -> PERSONA_VALUE_INVALID', () => {
    const { api } = createTestHarness('hanh');
    const result = api.updateCustomerPersona('CUST-011', { values: [{ fieldKey: 'religion', value: { valueText: 'x' }, source: 'CUSTOMER_SHARED' }] });
    expect(!result.ok && result.error.errorCode).toBe('PERSONA_VALUE_INVALID');
  });
});

describe('thao tác hàng loạt', () => {
  it('nhân viên không được phân người hàng loạt; CHANGE_STATUS chỉ tác động khách trong phạm vi, ngoài phạm vi báo CUSTOMER_NOT_FOUND', () => {
    const staff = createTestHarness('hanh');
    staff.switchUser('thao');
    const forbidden = staff.api.bulkOperation({ type: 'ASSIGN', customerIds: ['CUST-001'], memberIds: ['tuan'] });
    expect(!forbidden.ok && forbidden.error.errorCode).toBe('INSUFFICIENT_ROLE');
    const manager = createTestHarness('hanh');
    const result = manager.api.bulkOperation({ type: 'CHANGE_STATUS', customerIds: ['CUST-001', 'CUST-002'], statusId: 'st-net' });
    expect(result.ok && result.data.succeeded).toEqual(['CUST-001']);
    expect(result.ok && result.data.failed).toEqual([{ customerId: 'CUST-002', errorCode: 'CUSTOMER_NOT_FOUND' }]);
  });

  it('bulk ASSIGN thành công: Quản lý thêm người cùng nhóm làm MEMBER, ghi changeLog', () => {
    const { api, getState } = createTestHarness('hanh');
    const logsBefore = getState().changeLogs.length;
    const result = api.bulkOperation({ type: 'ASSIGN', customerIds: ['CUST-001'], memberIds: ['tuan'] });
    expect(result.ok && result.data.succeeded).toEqual(['CUST-001']);
    expect(getState().customers.find((item) => item.id === 'CUST-001')?.careTeam.find((member) => member.userId === 'tuan')?.role).toBe('MEMBER');
    expect(getState().changeLogs).toHaveLength(logsBefore + 1);
  });
});

describe('C4 / N3 importCustomers (API)', () => {
  const row = (phone: string, extra: Record<string, unknown> = {}) => ({ fullName: 'Khách nhập', phone, ...extra });

  it('quá 5.000 dòng -> 400 IMPORT_TOO_LARGE, không tạo khách nào', () => {
    const { api, getState } = createTestHarness('admin');
    const before = getState().customers.length;
    const rows = Array.from({ length: 5001 }, (_, index) => row(`09${String(10000000 + index)}`));
    const result = api.importCustomers(rows);
    expect(!result.ok && result.error.errorCode).toBe('IMPORT_TOO_LARGE');
    expect(getState().customers).toHaveLength(before);
  });

  it('dòng trỏ tới danh mục đã ẩn hoặc nhân viên đã khoá bị bỏ qua kèm lý do', () => {
    const harness = createTestHarness('admin');
    const source = harness.getState().catalogs.leadSources[0];
    harness.api.upsertCatalogItem('leadSources', { ...source, isActive: false });
    const vy = harness.getState().users.find((user) => user.id === 'vy')!;
    harness.api.upsertUser({ ...vy, isActive: false });
    const result = harness.api.importCustomers([row('0900111001', { sourceId: source.id }), row('0900111002', { primaryUserId: 'vy' }), row('0900111003')]);
    expect(result.ok && result.data.created).toBe(1);
    expect(result.ok && result.data.skipped.map((item) => item.row)).toEqual([1, 2]);
  });
});

describe('TB9 / C6 đề nghị tham gia', () => {
  it('id nội bộ thô, token sai, hoặc khách đã xem được -> CÙNG một lỗi 404 (không phân biệt tồn tại/không được phép)', () => {
    const harness = createTestHarness('thao');
    const raw = harness.api.createCareTeamRequest({ customerRef: 'CUST-002' });
    const missing = harness.api.createCareTeamRequest({ customerRef: 'CUST-999' });
    const forged = harness.api.createCareTeamRequest({ customerRef: 'JR-abc' });
    const accessible = harness.api.createCareTeamRequest({ customerRef: 'CUST-001' });
    [raw, missing, forged, accessible].forEach((result) => {
      expect(!result.ok && [result.error.statusCode, result.error.errorCode]).toEqual([404, 'RESOURCE_NOT_FOUND']);
    });
    expect(harness.getState().careTeamRequests).toHaveLength(0);
  });

  it('token của người khác không dùng được', () => {
    const thao = createTestHarness('thao');
    const ref = thao.api.lookupPhone('0988333112');
    const tuan = createTestHarness('tuan');
    const result = tuan.api.createCareTeamRequest({ customerRef: ref.ok ? (ref.data.customerRef as string) : '' });
    expect(!result.ok && result.error.errorCode).toBe('RESOURCE_NOT_FOUND');
  });
});

describe('createAppointment: ngày quá khứ', () => {
  it('startAt thuộc ngày trước hôm nay (giờ VN) -> 400 APPOINTMENT_IN_PAST; 16:59:59.999Z ngày trước đó vẫn là quá khứ, 17:00:00Z là hôm nay', () => {
    const { api } = createTestHarness('hanh'); // hôm nay = 22/10 giờ VN
    const past = api.createAppointment({ customerId: 'CUST-001', type: 'MEETING', startAt: '2026-10-21T16:59:59.999Z', assigneeId: 'hanh' });
    expect(!past.ok && past.error.errorCode).toBe('APPOINTMENT_IN_PAST');
    const today = api.createAppointment({ customerId: 'CUST-001', type: 'MEETING', startAt: '2026-10-21T17:00:00.000Z', assigneeId: 'hanh' });
    expect(today.ok).toBe(true);
  });
});
