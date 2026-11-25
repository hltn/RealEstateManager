/**
 * Luật v1.0.6 (FR-30..FR-33) trên mock API của prototype — CÙNG bảng ca với backend (`appointments-write.assignees.spec.ts`,
 * `customer-delete-policy.spec.ts`) và Admin App: người tạo khách ngoài nhóm chăm sóc (Admin/Nhân viên/Quản lý), nhóm chăm sóc không có
 * người tạo, thành viên INACTIVE. Khách mẫu: tạo bởi `creator`; nhóm chủ = nhóm của người tạo.
 */
import { describe, expect, it } from 'vitest';
import type { CrmDataState } from '@crm/store';
import type { CareTeamRole } from '@crm/types/crm';
import { composeMutations, createHarness, withLockedUser } from '../../../test/crmHarness';
import { getCustomerPermissions, getDefaultAssigneeIds, hasOwnerRights, listAssignableAssignees } from './access';
import { listDailyTasks } from './dailyTasks';
import { getCustomer } from './queries';
import type { ApiResult } from './types';

const CUSTOMER_ID = 'CUST-001';
const futureIso = (hours: number) => new Date(Date.now() + hours * 3_600_000).toISOString();
const MEETING = { customerId: CUSTOMER_ID, type: 'MEETING' as const, location: 'VP' };

const errorOf = <T>(result: ApiResult<T>) => {
  if (result.ok) throw new Error('Kỳ vọng lỗi nhưng thành công');
  return result.error;
};
const dataOf = <T>(result: ApiResult<T>): T => {
  if (!result.ok) throw new Error(`Kỳ vọng thành công nhưng lỗi ${result.error.errorCode}: ${result.error.message}`);
  return result.data;
};

/** Đặt người tạo + nhóm chăm sóc của khách mẫu (PRIMARY là phần tử đầu). */
const withOwners =
  (createdBy: string, members: [string, CareTeamRole][]) =>
  (data: CrmDataState): CrmDataState => ({
    ...data,
    customers: data.customers.map((customer) =>
      customer.id === CUSTOMER_ID
        ? {
            ...customer,
            createdBy,
            careTeam: members.map(([userId, role]) => ({ userId, role, addedBy: createdBy, addedAt: '2026-10-01T00:00:00.000Z' })),
            primaryAssigneeId: members.find(([, role]) => role === 'PRIMARY')?.[0] ?? null,
          }
        : customer,
    ),
  });

/** Nhóm chăm sóc: thao (PRIMARY, nhóm 1) + vy (MEMBER, nhóm 2); người tạo ở NGOÀI nhóm chăm sóc. */
const outsideCreator = (creator: string) =>
  withOwners(creator, [
    ['thao', 'PRIMARY'],
    ['vy', 'MEMBER'],
  ]);

describe('hasOwnerRights / getCustomerPermissions (FR-31)', () => {
  // Người tạo tung (STAFF nhóm 2) -> nhóm chủ = nhóm 2 -> Quản lý minh. thao (nhóm 1) và vy (nhóm 2) chỉ ở nhóm chăm sóc.
  const harness = createHarness({ actAs: 'admin', mutate: outsideCreator('tung') });
  const customer = harness.state().customers.find((item) => item.id === CUSTOMER_ID)!;
  const permissionsOf = (userId: string) => {
    harness.actAs(userId);
    return getCustomerPermissions(harness.actor(), customer, harness.state().users);
  };

  it.each([
    ['admin', true],
    ['tung', true],
    ['minh', true],
    ['hanh', false],
    ['thao', false],
    ['vy', false],
  ])('%s: quyền chủ khách = %s (Admin, người tạo, Quản lý nhóm chủ; PRIMARY/MEMBER/Quản lý nhóm khác không)', (userId, expected) => {
    harness.actAs(userId);
    expect(hasOwnerRights(harness.actor(), customer, harness.state().users)).toBe(expected);
  });

  it('canDelete chỉ Admin hoặc người tạo, mọi tình trạng; Quản lý nhóm chủ không xóa được', () => {
    expect(['admin', 'tung', 'minh', 'hanh', 'thao'].map((userId) => permissionsOf(userId).canDelete)).toEqual([true, true, false, false, false]);
  });

  it('canManageCareTeam và canRevealNationalId theo quyền chủ khách, không theo nhóm chăm sóc', () => {
    expect(permissionsOf('thao')).toMatchObject({ canManageCareTeam: false, canRevealNationalId: false, canEdit: true });
    expect(permissionsOf('minh')).toMatchObject({ canManageCareTeam: true, canRevealNationalId: true });
  });
});

describe('createAppointment: người thực hiện (FR-30)', () => {
  it.each([
    ['admin', 'Admin'],
    ['tung', 'Nhân viên'],
    ['minh', 'Quản lý'],
  ])('người tạo khách ngoài nhóm chăm sóc (%s, %s) vẫn được chọn làm người thực hiện', async (creator) => {
    const harness = createHarness({ actAs: 'thao', mutate: outsideCreator(creator) });
    const view = dataOf(await harness.api.createAppointment({ ...MEETING, startAt: futureIso(48), assigneeIds: [creator, 'thao'] }));
    expect(view.assignees.map((assignee) => assignee.id)).toEqual([creator, 'thao']);
  });

  it('nhóm chăm sóc KHÔNG có người tạo: người tạo + Quản lý nhóm chủ vẫn chọn được; 21 người bị chặn', async () => {
    const harness = createHarness({ actAs: 'thao', mutate: outsideCreator('tung') });
    const ids = ['thao', 'vy', 'tung', 'minh'];
    const view = dataOf(await harness.api.createAppointment({ ...MEETING, startAt: futureIso(48), assigneeIds: ids }));
    expect(view.assignees.map((assignee) => assignee.id)).toEqual(ids);
    const tooMany = Array.from({ length: 21 }, (_, index) => `u${index}`);
    expect(errorOf(await harness.api.createAppointment({ ...MEETING, startAt: futureIso(48), assigneeIds: tooMany })).errorCode).toBe('VALIDATION_FAILED');
  });

  it('mặc định: người tạo lịch nếu thuộc danh sách; Admin ngoài danh sách thì lấy PRIMARY (không tự chọn mình)', async () => {
    const byCreator = createHarness({ actAs: 'tung', mutate: outsideCreator('tung') });
    const first = dataOf(await byCreator.api.createAppointment({ ...MEETING, startAt: futureIso(48) }));
    expect(first.assignees.map((assignee) => assignee.id)).toEqual(['tung']);
    const byAdmin = createHarness({ actAs: 'admin', mutate: outsideCreator('tung') });
    const second = dataOf(await byAdmin.api.createAppointment({ ...MEETING, startAt: futureIso(48) }));
    expect(second.assignees.map((assignee) => assignee.id)).toEqual(['thao']);
  });

  it('USER_NOT_ASSIGNABLE: thông điệp NGUYÊN VĂN backend theo details.reason (NOT_IN_CARE_TEAM, NOT_ACTIVE)', async () => {
    const harness = createHarness({ actAs: 'thao', mutate: composeMutations(outsideCreator('tung'), withLockedUser('vy')) });
    const outside = errorOf(await harness.api.createAppointment({ ...MEETING, startAt: futureIso(48), assigneeIds: ['khoa'] }));
    expect(outside).toMatchObject({ errorCode: 'USER_NOT_ASSIGNABLE', details: { reason: 'NOT_IN_CARE_TEAM' } });
    expect(outside.message).toBe('Người thực hiện phải là thành viên nhóm chăm sóc, người tạo khách hoặc Quản lý của nhóm chủ khách; nhờ thành viên có quyền mời đưa người đó vào nhóm trước');
    const inactive = errorOf(await harness.api.createAppointment({ ...MEETING, startAt: futureIso(48), assigneeIds: ['vy'] }));
    expect(inactive).toMatchObject({ errorCode: 'USER_NOT_ASSIGNABLE', details: { reason: 'NOT_ACTIVE' } });
    expect(inactive.message).toBe('Người thực hiện không còn hoạt động (tài khoản bị khóa hoặc đã xóa)');
  });

  it('USER_NOT_ASSIGNABLE: thành viên nhóm chăm sóc không có vai trò CRM -> NOT_CRM_ROLE nguyên văn', async () => {
    // `ha` hoạt động nhưng chỉ có vai trò EDITOR; đưa vào nhóm chăm sóc qua dữ liệu để chạm nhánh NOT_CRM_ROLE.
    const harness = createHarness({
      actAs: 'thao',
      mutate: withOwners('tung', [
        ['thao', 'PRIMARY'],
        ['ha', 'MEMBER'],
      ]),
    });
    const error = errorOf(await harness.api.createAppointment({ ...MEETING, startAt: futureIso(48), assigneeIds: ['ha'] }));
    expect(error).toMatchObject({ errorCode: 'USER_NOT_ASSIGNABLE', details: { reason: 'NOT_CRM_ROLE' } });
    expect(error.message).toBe('Người thực hiện không có vai trò CRM (cần là Quản trị, Quản lý hoặc Nhân viên)');
  });

  it('thành viên INACTIVE không nằm trong danh sách chọn và không được chọn làm mặc định', () => {
    const harness = createHarness({ actAs: 'thao', mutate: composeMutations(outsideCreator('tung'), withLockedUser('thao')) });
    const detail = getCustomer(harness.state(), harness.actor(), CUSTOMER_ID)!;
    const options = listAssignableAssignees(detail);
    expect(options.map((option) => option.userId)).toEqual(['vy', 'minh', 'tung']);
    expect(getDefaultAssigneeIds(options, 'khoa')).toEqual([]);
  });

  it('Quản lý nhóm khác (đã mời chéo vào nhóm chăm sóc) vẫn đặt được lịch hẹn: không bị chặn bởi nhóm', async () => {
    const harness = createHarness({
      actAs: 'hanh',
      mutate: withOwners('tung', [
        ['thao', 'PRIMARY'],
        ['hanh', 'MEMBER'],
      ]),
    });
    const view = dataOf(await harness.api.createAppointment({ ...MEETING, startAt: futureIso(48) }));
    expect(view.assignees.map((assignee) => assignee.id)).toEqual(['hanh']);
  });
});

describe('Việc hôm nay: lịch nhiều người thực hiện (FR-30, FR-32)', () => {
  it('lịch hiện ở việc của MỖI người thực hiện; canEdit/canDelete theo người tạo lịch hoặc Admin', async () => {
    const harness = createHarness({ actAs: 'thao', mutate: outsideCreator('tung') });
    const created = dataOf(await harness.api.createAppointment({ ...MEETING, startAt: futureIso(1), assigneeIds: ['thao', 'tung'] }));
    const tasksOf = (userId: string) => {
      harness.actAs(userId);
      return listDailyTasks(harness.state(), harness.actor(), { scope: 'mine' }).filter((task) => task.appointmentId === created.id);
    };
    const mine = tasksOf('thao');
    expect(mine).toHaveLength(1);
    expect(mine[0]?.assignees.map((assignee) => assignee.id)).toEqual(['thao', 'tung']);
    expect(mine[0]).toMatchObject({ canEdit: true, canDelete: true });
    expect(tasksOf('tung')[0]).toMatchObject({ canEdit: false, canDelete: false });
  });
});

describe('Xóa khách: Admin hoặc người tạo (FR-31)', () => {
  const REASON = 'Khách trùng, xóa theo yêu cầu';

  it.each([
    ['admin', true],
    ['tung', true],
    ['minh', false],
    ['thao', false],
  ])('xóa đơn bởi %s -> được = %s (khách KHÔNG thuộc nhóm "Bỏ")', async (userId, isAllowed) => {
    const harness = createHarness({ actAs: userId, mutate: outsideCreator('tung') });
    const result = await harness.api.deleteCustomer(CUSTOMER_ID, REASON);
    if (isAllowed) expect(result.ok).toBe(true);
    else expect(errorOf(result)).toMatchObject({ statusCode: 403, errorCode: 'INSUFFICIENT_ROLE' });
  });

  it('xóa hàng loạt: Quản lý nhóm chủ (không phải người tạo) bị INSUFFICIENT_ROLE trong failed[]', async () => {
    const harness = createHarness({ actAs: 'minh', mutate: outsideCreator('tung') });
    const result = dataOf(await harness.api.bulkOperation({ type: 'DELETE', customerIds: [CUSTOMER_ID], reason: REASON }));
    expect(result.succeeded).toEqual([]);
    expect(result.failed).toEqual([{ customerId: CUSTOMER_ID, errorCode: 'INSUFFICIENT_ROLE' }]);
  });

  it('xóa hàng loạt bởi người tạo: thành công kể cả khi khách không thuộc nhóm "Bỏ"', async () => {
    const harness = createHarness({ actAs: 'tung', mutate: outsideCreator('tung') });
    const result = dataOf(await harness.api.bulkOperation({ type: 'DELETE', customerIds: [CUSTOMER_ID], reason: REASON }));
    expect(result).toMatchObject({ succeeded: [CUSTOMER_ID], failed: [] });
  });
});

describe('Người tạo khách không bị gỡ khỏi nhóm chăm sóc (FR-31)', () => {
  const creatorInTeam = withOwners('tung', [
    ['thao', 'PRIMARY'],
    ['tung', 'MEMBER'],
    ['vy', 'MEMBER'],
  ]);

  it.each(['admin', 'tung', 'minh'])('%s gỡ người tạo -> 409 PRIMARY_LOCKED + details.reason CREATOR_LOCKED', async (userId) => {
    const harness = createHarness({ actAs: userId, mutate: creatorInTeam });
    expect(errorOf(await harness.api.removeCareTeamMember(CUSTOMER_ID, 'tung'))).toMatchObject({ statusCode: 409, errorCode: 'PRIMARY_LOCKED', details: { reason: 'CREATOR_LOCKED' } });
  });

  it('thành viên khác (không phải người tạo) vẫn gỡ được bởi chủ khách', async () => {
    const harness = createHarness({ actAs: 'minh', mutate: creatorInTeam });
    dataOf(await harness.api.removeCareTeamMember(CUSTOMER_ID, 'vy'));
    expect(harness.state().customers.find((item) => item.id === CUSTOMER_ID)?.careTeam.map((member) => member.userId)).toEqual(['thao', 'tung']);
  });

  it('PRIMARY không phải chủ khách không gỡ được (403 CARE_TEAM_ACTION_FORBIDDEN)', async () => {
    const harness = createHarness({ actAs: 'thao', mutate: creatorInTeam });
    expect(errorOf(await harness.api.removeCareTeamMember(CUSTOMER_ID, 'vy')).errorCode).toBe('CARE_TEAM_ACTION_FORBIDDEN');
  });
});

describe('Mời hàng loạt (bulk ASSIGN) kiểm quyền chủ khách từng khách (FR-31)', () => {
  it('Quản lý nhóm khác chỉ truy cập qua nhóm chăm sóc: failed[] INSUFFICIENT_ROLE; Quản lý nhóm chủ thì thành công', async () => {
    // thao (nhóm 1) đưa hanh vào phạm vi; vy (nhóm 2) đưa minh vào phạm vi; thành viên mời thêm là khoa (chưa ở nhóm chăm sóc).
    const mutate = withOwners('tung', [
      ['thao', 'PRIMARY'],
      ['vy', 'MEMBER'],
    ]);
    const other = createHarness({ actAs: 'hanh', mutate });
    const denied = dataOf(await other.api.bulkOperation({ type: 'ASSIGN', customerIds: [CUSTOMER_ID], memberIds: ['khoa'] }));
    expect(denied.failed).toEqual([{ customerId: CUSTOMER_ID, errorCode: 'INSUFFICIENT_ROLE' }]);
    const owner = createHarness({ actAs: 'minh', mutate });
    const allowed = dataOf(await owner.api.bulkOperation({ type: 'ASSIGN', customerIds: [CUSTOMER_ID], memberIds: ['khoa'] }));
    expect(allowed.failed).toEqual([]);
    expect(allowed.succeeded).toEqual([CUSTOMER_ID]);
  });
});
