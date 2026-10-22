/**
 * Hồi quy QA N3 / C2 / C5 / TB4 / TB9: bất biến "đúng 1 PRIMARY hợp lệ" ở MỌI đường gán người chăm sóc,
 * chuyển việc khi gỡ người, khoá người dùng, bulk.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { resetNationalIdVaultForTest } from '@crm/lib/nationalIdVault';
import { crmReducer } from '@crm/store/crmReducer';
import { createTestHarness, createTestState, FIXED_NOW } from '@crm/test/fixtures';
import { assertAssignableUsers } from './assignable';

beforeEach(() => resetNationalIdVaultForTest());

const code = <T>(result: { ok: boolean; error?: { errorCode: string } } | { ok: true; data: T }) => ('error' in result ? result.error?.errorCode : undefined);

/** Quản trị khoá người dùng (qua API thật). */
const lockUser = (harness: ReturnType<typeof createTestHarness>, userId: string) => {
  const previous = harness.getState().session.currentUserId;
  harness.switchUser('admin');
  const user = harness.getState().users.find((item) => item.id === userId)!;
  const result = harness.api.upsertUser({ ...user, isActive: false });
  harness.switchUser(previous);
  return result;
};

describe('assertAssignableUsers', () => {
  const state = createTestState('admin');
  it('chấp nhận người đang hoạt động không phải ADMIN', () => {
    expect(assertAssignableUsers(state, ['hanh', 'thao'])).toBeNull();
  });
  it('từ chối ADMIN, id không tồn tại, người đã khoá', () => {
    expect(assertAssignableUsers(state, ['admin'])?.userIds).toEqual(['admin']);
    expect(assertAssignableUsers(state, ['ghost'])?.userIds).toEqual(['ghost']);
    const locked = { ...state, users: state.users.map((user) => (user.id === 'vy' ? { ...user, isActive: false } : user)) };
    expect(assertAssignableUsers(locked, ['thao', 'vy'])?.userIds).toEqual(['vy']);
  });
});

describe('N3 createCustomer', () => {
  it.each([['admin'], ['ghost']])('primaryUserId = %s bị từ chối, không tạo khách', (primaryUserId) => {
    const harness = createTestHarness('hanh');
    const before = harness.getState().customers.length;
    const result = harness.api.createCustomer({ fullName: 'A', phone: '0911000111', careTeam: { primaryUserId, memberIds: [] } });
    expect(code(result)).toBe('USER_NOT_ASSIGNABLE');
    expect(harness.getState().customers).toHaveLength(before);
  });

  it('memberIds chứa người đã khoá bị từ chối', () => {
    const harness = createTestHarness('hanh');
    expect(lockUser(harness, 'vy').ok).toBe(true);
    const result = harness.api.createCustomer({ fullName: 'A', phone: '0911000111', careTeam: { primaryUserId: 'thao', memberIds: ['vy'] } });
    expect(code(result)).toBe('USER_NOT_ASSIGNABLE');
  });
});

describe('N3 addCareTeamMembers / removeCareTeamMember / changePrimary', () => {
  const customerWithoutTeam = (harness: ReturnType<typeof createTestHarness>) => {
    const created = harness.api.createCustomer({ fullName: 'Chưa phân', phone: '0911000222' });
    if (!created.ok) throw new Error('setup');
    return created.data.id;
  };

  it('lần phân đầu: primaryUserId là ADMIN/không tồn tại bị từ chối', () => {
    const harness = createTestHarness('hanh');
    const id = customerWithoutTeam(harness);
    expect(code(harness.api.addCareTeamMembers(id, { userIds: ['thao'], primaryUserId: 'admin' }))).toBe('USER_NOT_ASSIGNABLE');
    expect(code(harness.api.addCareTeamMembers(id, { userIds: [], primaryUserId: 'ghost' }))).toBe('USER_NOT_ASSIGNABLE');
    expect(harness.getState().customers.find((item) => item.id === id)?.careTeam).toEqual([]);
  });

  it('gỡ phụ trách chính: người thay là ADMIN/đã khoá bị từ chối', () => {
    const harness = createTestHarness('hanh');
    expect(code(harness.api.removeCareTeamMember('CUST-001', 'hanh', 'admin'))).toBe('USER_NOT_ASSIGNABLE');
    expect(code(harness.api.removeCareTeamMember('CUST-001', 'hanh', 'ghost'))).toBe('USER_NOT_ASSIGNABLE');
    expect(harness.getState().customers.find((item) => item.id === 'CUST-001')?.primaryAssigneeId).toBe('hanh');
  });
});

describe('N3 duyệt đề nghị tham gia', () => {
  it('người gửi đã bị khoá -> không duyệt được, không thêm vào nhóm', () => {
    const harness = createTestHarness('vy');
    const lookup = harness.api.lookupPhone('0912345678');
    const customerRef = lookup.ok ? lookup.data.customerRef : undefined;
    if (!customerRef) throw new Error('setup: vy phải có token đề nghị');
    const request = harness.api.createCareTeamRequest({ customerRef });
    if (!request.ok) throw new Error(JSON.stringify(request.error));
    expect(lockUser(harness, 'vy').ok).toBe(true);
    harness.switchUser('hanh');
    const resolved = harness.api.resolveCareTeamRequest(request.data.id, 'APPROVED');
    expect(code(resolved)).toBe('USER_NOT_ASSIGNABLE');
    expect(harness.getState().customers.find((item) => item.id === 'CUST-001')?.careTeam.some((member) => member.userId === 'vy')).toBe(false);
  });
});

describe('N3 bulk ASSIGN', () => {
  const emptyCustomer = (harness: ReturnType<typeof createTestHarness>) => {
    const created = harness.api.createCustomer({ fullName: 'Chưa phân', phone: '0911000333' });
    if (!created.ok) throw new Error('setup');
    return created.data.id;
  };

  it('khách chưa có ai: không tự lấy người đầu làm PRIMARY — phải chọn rõ', () => {
    const harness = createTestHarness('hanh');
    const id = emptyCustomer(harness);
    const result = harness.api.bulkOperation({ type: 'ASSIGN', customerIds: [id], memberIds: ['thao', 'tuan'] });
    expect(result.ok && result.data.failed).toEqual([{ customerId: id, errorCode: 'PRIMARY_REQUIRED' }]);
    expect(harness.getState().customers.find((item) => item.id === id)?.careTeam).toEqual([]);
  });

  it('thành công: chọn rõ PRIMARY; khách đã có nhóm thì chỉ thêm MEMBER', () => {
    const harness = createTestHarness('hanh');
    const id = emptyCustomer(harness);
    const result = harness.api.bulkOperation({ type: 'ASSIGN', customerIds: [id, 'CUST-001'], memberIds: ['tuan'], primaryUserId: 'thao' });
    expect(result.ok && result.data.succeeded).toEqual([id, 'CUST-001']);
    const team = (customerId: string) => harness.getState().customers.find((item) => item.id === customerId)?.careTeam.map((member) => `${member.userId}:${member.role}`);
    expect(team(id)).toEqual(['thao:PRIMARY', 'tuan:MEMBER']);
    expect(team('CUST-001')).toEqual(['hanh:PRIMARY', 'thao:MEMBER', 'tuan:MEMBER']);
  });

  it('người bị khoá/ADMIN -> từ chối cả lượt, không khách nào đổi', () => {
    const harness = createTestHarness('hanh');
    const result = harness.api.bulkOperation({ type: 'ASSIGN', customerIds: ['CUST-001'], memberIds: ['admin'] });
    expect(code(result)).toBe('USER_NOT_ASSIGNABLE');
  });
});

describe('C2 bulk CHANGE_STATUS', () => {
  it('statusId không tồn tại hoặc đã ẩn bị từ chối', () => {
    const harness = createTestHarness('hanh');
    expect(code(harness.api.bulkOperation({ type: 'CHANGE_STATUS', customerIds: ['CUST-001'], statusId: 'st-ghost' }))).toBe('STATUS_NOT_FOUND');
    harness.switchUser('admin');
    const interested = harness.getState().catalogs.statuses.find((status) => status.id === 'st-interested')!;
    expect(harness.api.upsertCatalogItem('statuses', { ...interested, isActive: false }).ok).toBe(true);
    harness.switchUser('hanh');
    expect(code(harness.api.bulkOperation({ type: 'CHANGE_STATUS', customerIds: ['CUST-001'], statusId: 'st-interested' }))).toBe('STATUS_NOT_FOUND');
  });

  it('chỉ đếm khách thật sự đổi tình trạng', () => {
    const harness = createTestHarness('hanh');
    const status = (id: string) => harness.getState().customers.find((item) => item.id === id)?.statusId;
    const target = status('CUST-001') === 'st-net' ? 'st-interested' : 'st-net';
    const sameAsCurrent = harness.api.bulkOperation({ type: 'CHANGE_STATUS', customerIds: ['CUST-001'], statusId: status('CUST-001') as string });
    expect(sameAsCurrent.ok && sameAsCurrent.data).toMatchObject({ succeeded: [], unchanged: ['CUST-001'] });
    const changed = harness.api.bulkOperation({ type: 'CHANGE_STATUS', customerIds: ['CUST-001'], statusId: target });
    expect(changed.ok && changed.data.succeeded).toEqual(['CUST-001']);
  });
});

describe('C5 gỡ người chăm sóc chuyển việc của họ sang phụ trách chính', () => {
  it('lịch hẹn SCHEDULED + bước tiếp theo chưa xong chuyển sang PRIMARY, có changeLog', () => {
    const harness = createTestHarness('hanh');
    const apt = harness.api.createAppointment({ customerId: 'CUST-001', type: 'MEETING', startAt: '2026-10-30T03:00:00.000Z', assigneeId: 'thao' });
    if (!apt.ok) throw new Error('setup');
    harness.switchUser('thao');
    const log = harness.api.createCareLog('CUST-001', { content: 'Gọi khách', contactChannel: 'CALL', nextAction: { suggestion: 'Gọi lại', dueAt: '2026-10-31T03:00:00.000Z' } });
    if (!log.ok) throw new Error('setup');
    harness.switchUser('hanh');

    expect(harness.api.removeCareTeamMember('CUST-001', 'thao').ok).toBe(true);
    const state = harness.getState();
    expect(state.appointments.find((item) => item.id === apt.data.id)?.assigneeId).toBe('hanh');
    expect(state.careLogs.find((item) => item.id === log.data.id)?.nextAction?.assigneeId).toBe('hanh');
    const changeLog = state.changeLogs.find((item) => item.customerId === 'CUST-001' && item.action === 'CARE_TEAM_MEMBER_REMOVED');
    expect(changeLog?.changes.map((change) => change.field).join('|')).toMatch(/Lịch hẹn|Bước tiếp theo/);
  });

  it('việc "Bước tiếp theo" xuất hiện ở "Việc của tôi" của PRIMARY sau khi gỡ', async () => {
    const { listDailyTasks } = await import('./dailyTasks');
    const { buildActor } = await import('./access');
    const harness = createTestHarness('thao');
    harness.api.createCareLog('CUST-001', { content: 'Gọi khách', contactChannel: 'CALL', nextAction: { suggestion: 'Gọi lại', dueAt: '2026-10-20T03:00:00.000Z' } });
    harness.switchUser('hanh');
    harness.api.removeCareTeamMember('CUST-001', 'thao');
    const state = harness.getState();
    const hanh = state.users.find((user) => user.id === 'hanh')!;
    const tasks = listDailyTasks(state, buildActor(hanh, state.teams), { scope: 'mine' }, FIXED_NOW);
    expect(tasks.some((task) => task.kind === 'FOLLOW_UP' && task.customer?.id === 'CUST-001' && task.assignee?.id === 'hanh')).toBe(true);
  });
});

describe('N3 khoá người dùng', () => {
  it('gỡ khỏi nhóm MEMBER (có changeLog) và chuyển lịch hẹn sang PRIMARY', () => {
    const harness = createTestHarness('hanh');
    const apt = harness.api.createAppointment({ customerId: 'CUST-001', type: 'MEETING', startAt: '2026-10-30T03:00:00.000Z', assigneeId: 'thao' });
    if (!apt.ok) throw new Error('setup');
    expect(lockUser(harness, 'thao').ok).toBe(true);
    const state = harness.getState();
    expect(state.customers.find((item) => item.id === 'CUST-001')?.careTeam.map((member) => member.userId)).toEqual(['hanh']);
    expect(state.appointments.find((item) => item.id === apt.data.id)?.assigneeId).toBe('hanh');
    expect(state.changeLogs.some((item) => item.customerId === 'CUST-001' && item.action === 'CARE_TEAM_MEMBER_REMOVED')).toBe(true);
  });

  it('vẫn chặn khoá người đang phụ trách chính khách', () => {
    const harness = createTestHarness('admin');
    const hanh = harness.getState().users.find((user) => user.id === 'hanh')!;
    expect(code(harness.api.upsertUser({ ...hanh, isActive: false }))).toBe('VALIDATION_FAILED');
  });
});

describe('N3 reducer isCareTeamValid kiểm user tồn tại + hoạt động', () => {
  it('customers/update với careTeam chứa userId lạ bị bỏ qua', () => {
    const state = createTestState('hanh');
    const meta = { actorId: 'hanh', now: FIXED_NOW.toISOString(), changeLogId: 'CHG-x', source: 'WEB' as const };
    const next = crmReducer(state, {
      type: 'customers/update',
      customerId: 'CUST-001',
      patch: { careTeam: [{ userId: 'ghost', role: 'PRIMARY', addedBy: 'hanh', addedAt: meta.now }] },
      action: 'CUSTOMER_UPDATED',
      meta,
    });
    expect(next).toBe(state);
  });
});

describe('TB3 bulk ASSIGN không gán chéo nhóm', () => {
  it('Quản lý nhóm 2 không phân được người nhóm 1', () => {
    const harness = createTestHarness('minh');
    const result = harness.api.bulkOperation({ type: 'ASSIGN', customerIds: ['CUST-003'], memberIds: ['thao'] });
    expect(code(result)).toBe('USER_OUT_OF_TEAM');
    expect(harness.api.bulkOperation({ type: 'ASSIGN', customerIds: ['CUST-003'], memberIds: ['quan'] }).ok).toBe(true);
  });

  it('CHANGE_STATUS trả previousStatusIds để Hoàn tác', () => {
    const harness = createTestHarness('hanh');
    const before = harness.getState().customers.find((item) => item.id === 'CUST-001')!.statusId;
    const target = before === 'st-net' ? 'st-interested' : 'st-net';
    const result = harness.api.bulkOperation({ type: 'CHANGE_STATUS', customerIds: ['CUST-001'], statusId: target });
    expect(result.ok && result.data.previousStatusIds).toEqual({ 'CUST-001': before });
  });
});

describe('TB4 hoàn thành bước tiếp theo', () => {
  it('ghi changeLog + cập nhật lastUpdatedAt/By + version; hoàn thành lần 2 là no-op', () => {
    const harness = createTestHarness('hanh');
    const log = harness.api.createCareLog('CUST-001', { content: 'Gọi khách', contactChannel: 'CALL', nextAction: { suggestion: 'Gửi bảng giá', dueAt: '2026-10-25T03:00:00.000Z' } });
    if (!log.ok) throw new Error('setup');
    const before = harness.getState().customers.find((item) => item.id === 'CUST-001')!;
    const logsBefore = harness.getState().changeLogs.length;
    expect(harness.api.completeFollowUp(log.data.id).ok).toBe(true);
    const after = harness.getState().customers.find((item) => item.id === 'CUST-001')!;
    expect(after.version).toBe(before.version + 1);
    expect(after.lastUpdatedBy).toBe('hanh');
    expect(harness.getState().changeLogs.length).toBe(logsBefore + 1);
    expect(harness.getState().changeLogs[0]).toMatchObject({ action: 'FOLLOW_UP_COMPLETED', customerId: 'CUST-001' });
    harness.api.completeFollowUp(log.data.id);
    expect(harness.getState().changeLogs.length).toBe(logsBefore + 1);
  });
});

describe('TB-n2 đổi vai trò sang ADMIN', () => {
  it('đang là PRIMARY của khách -> bị chặn, vai trò không đổi', () => {
    const harness = createTestHarness('admin');
    const hanh = harness.getState().users.find((user) => user.id === 'hanh')!;
    expect(code(harness.api.upsertUser({ ...hanh, role: 'ADMIN', teamId: null }))).toBe('VALIDATION_FAILED');
    expect(harness.getState().users.find((user) => user.id === 'hanh')?.role).toBe('MANAGER');
  });

  it('đang là MEMBER -> được đổi, bị gỡ khỏi nhóm (changeLog) và việc chuyển sang PRIMARY', () => {
    const harness = createTestHarness('hanh');
    const apt = harness.api.createAppointment({ customerId: 'CUST-001', type: 'MEETING', startAt: '2026-10-30T03:00:00.000Z', assigneeId: 'thao' });
    if (!apt.ok) throw new Error('setup');
    harness.switchUser('admin');
    const thao = harness.getState().users.find((user) => user.id === 'thao')!;
    expect(harness.api.upsertUser({ ...thao, role: 'ADMIN', teamId: null }).ok).toBe(true);
    const state = harness.getState();
    expect(state.customers.find((item) => item.id === 'CUST-001')?.careTeam.map((member) => member.userId)).toEqual(['hanh']);
    expect(state.appointments.find((item) => item.id === apt.data.id)?.assigneeId).toBe('hanh');
    expect(state.changeLogs.some((item) => item.customerId === 'CUST-001' && item.action === 'CARE_TEAM_MEMBER_REMOVED')).toBe(true);
  });
});

describe('Th4/Th6 tham chiếu danh mục phải tồn tại và đang dùng', () => {
  it('createCustomer: nguồn/khu vực/dự án/thẻ lạ hoặc đã ẩn bị từ chối', () => {
    const harness = createTestHarness('admin');
    const before = harness.getState().customers.length;
    const bad = (extra: Record<string, unknown>) => code(harness.api.createCustomer({ fullName: 'A', phone: '0911000555', ...extra }));
    expect(bad({ sourceId: 'src-ghost' })).toBe('INVALID_CATALOG_REF');
    expect(bad({ areaId: 'area-ghost' })).toBe('INVALID_CATALOG_REF');
    expect(bad({ interestedProjectIds: ['proj-ghost'] })).toBe('INVALID_CATALOG_REF');
    expect(bad({ tagIds: ['tag-ghost'] })).toBe('INVALID_CATALOG_REF');
    const source = harness.getState().catalogs.leadSources[0];
    harness.api.upsertCatalogItem('leadSources', { ...source, isActive: false });
    expect(bad({ sourceId: source.id })).toBe('INVALID_CATALOG_REF');
    expect(harness.getState().customers).toHaveLength(before);
  });

  it('updateCustomer / saveCustomerProfile: giá trị lạ bị từ chối, nhưng giữ nguyên giá trị đã ẩn mà khách đã có thì được', () => {
    const harness = createTestHarness('hanh');
    const before = harness.getState().customers.find((item) => item.id === 'CUST-001')!;
    expect(code(harness.api.updateCustomer('CUST-001', { version: before.version, sourceId: 'src-ghost' }))).toBe('INVALID_CATALOG_REF');
    expect(code(harness.api.saveCustomerProfile('CUST-001', { profile: { tagIds: ['tag-ghost'] } }))).toBe('INVALID_CATALOG_REF');
    harness.switchUser('admin');
    const area = harness.getState().catalogs.areas.find((item) => item.id === before.areaId)!;
    harness.api.upsertCatalogItem('areas', { ...area, isActive: false });
    harness.switchUser('hanh');
    const current = harness.getState().customers.find((item) => item.id === 'CUST-001')!;
    expect(harness.api.updateCustomer('CUST-001', { version: current.version, areaId: current.areaId, notes: 'giữ khu vực đã ẩn' }).ok).toBe(true);
  });

  it('bulk ADD_TAGS: thẻ lạ bị từ chối; khách đã có thẻ -> unchanged, không đếm succeeded', () => {
    const harness = createTestHarness('hanh');
    expect(code(harness.api.bulkOperation({ type: 'ADD_TAGS', customerIds: ['CUST-001'], tagIds: ['tag-ghost'] }))).toBe('INVALID_CATALOG_REF');
    const customer = harness.getState().customers.find((item) => item.id === 'CUST-001')!;
    const tagId = customer.tagIds[0] ?? harness.getState().catalogs.tags[0].id;
    const first = harness.api.bulkOperation({ type: 'ADD_TAGS', customerIds: ['CUST-001'], tagIds: [tagId] });
    const second = harness.api.bulkOperation({ type: 'ADD_TAGS', customerIds: ['CUST-001'], tagIds: [tagId] });
    expect(first.ok && first.data.succeeded.length + first.data.unchanged.length).toBe(1);
    expect(second.ok && second.data).toMatchObject({ succeeded: [], unchanged: ['CUST-001'] });
  });
});

describe('Th5 createAppointment qua assertAssignableUsers', () => {
  const emptyCustomer = (harness: ReturnType<typeof createTestHarness>) => {
    const created = harness.api.createCustomer({ fullName: 'Chưa nhóm', phone: '0911000666' });
    if (!created.ok) throw new Error('setup');
    return created.data.id;
  };
  const input = { type: 'MEETING' as const, startAt: '2026-10-30T03:00:00.000Z' };

  it('Quản trị tạo lịch cho khách chưa có nhóm, không chọn người -> KHÔNG tự gán Quản trị', () => {
    const harness = createTestHarness('admin');
    const id = emptyCustomer(harness);
    expect(code(harness.api.createAppointment({ customerId: id, ...input }))).toBe('USER_NOT_ASSIGNABLE');
    expect(harness.getState().appointments.some((item) => item.customerId === id)).toBe(false);
  });

  it('khách chưa có nhóm nhưng chọn rõ nhân viên hợp lệ -> được; chọn người đã khoá -> bị từ chối', () => {
    const harness = createTestHarness('admin');
    const id = emptyCustomer(harness);
    expect(harness.api.createAppointment({ customerId: id, ...input, assigneeId: 'thao' }).ok).toBe(true);
    lockUser(harness, 'vy');
    expect(code(harness.api.createAppointment({ customerId: id, ...input, assigneeId: 'vy' }))).toBe('USER_NOT_ASSIGNABLE');
  });

  it('khách có nhóm: người thực hiện ngoài nhóm bị từ chối', () => {
    const harness = createTestHarness('hanh');
    expect(code(harness.api.createAppointment({ customerId: 'CUST-001', ...input, assigneeId: 'tuan' }))).toBe('USER_NOT_ASSIGNABLE');
  });
});
