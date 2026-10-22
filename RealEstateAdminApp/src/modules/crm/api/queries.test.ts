import { describe, expect, it } from 'vitest';
import { createTestState } from '@crm/test/fixtures';
import { selectCurrentUser } from '@crm/store/selectors';
import { buildActor, canAccessCustomer } from './access';
import { getCustomer, getListCounts, listCareLogs, listCustomers, listHistories, lookupPhone } from './queries';

const actorOf = (userId: string) => {
  const state = createTestState(userId);
  return { state, actor: buildActor(selectCurrentUser(state), state.teams) };
};

describe('phạm vi xem theo phân công (QT6)', () => {
  it('Quản trị thấy tất cả, Nhân viên chỉ thấy khách mình trong nhóm chăm sóc', () => {
    const admin = actorOf('admin');
    expect(listCustomers(admin.state, admin.actor, { listGroup: 'ALL', limit: 100 }).meta.total).toBe(admin.state.customers.length);
    const staff = actorOf('thao');
    const ids = listCustomers(staff.state, staff.actor, { listGroup: 'ALL', limit: 100 }).data.map((item) => item.id);
    expect(ids).toEqual(['CUST-001']);
  });

  it('Quản lý thấy khách của nhóm mình quản lý + khách mình cùng chăm sóc', () => {
    const { state, actor } = actorOf('minh'); // quản lý team-2
    const ids = listCustomers(state, actor, { listGroup: 'ALL', limit: 100 }).data.map((item) => item.id).sort();
    expect(ids).toEqual(['CUST-002', 'CUST-003', 'CUST-005', 'CUST-007', 'CUST-009']);
    const outOfScope = state.customers.find((customer) => customer.id === 'CUST-004');
    expect(outOfScope && canAccessCustomer(actor, outOfScope, state.users)).toBe(false);
  });

  it('khách ngoài phạm vi -> getCustomer null, không có nhật ký/lịch sử (như 404)', () => {
    const { state, actor } = actorOf('thao');
    expect(getCustomer(state, actor, 'CUST-002')).toBeNull();
    expect(listCareLogs(state, actor, 'CUST-002')).toEqual([]);
    expect(listHistories(state, actor, 'CUST-002')).toEqual([]);
  });
});

describe('danh sách + bộ lọc (C6, X3)', () => {
  const { state, actor } = actorOf('admin');

  it('tìm không dấu: "nguyen" ra "Nguyễn"; tìm theo SĐT có/không số 0', () => {
    expect(listCustomers(state, actor, { listGroup: 'ALL', q: 'nguyen van' }).data.map((item) => item.fullName)).toEqual(['Nguyễn Văn An']);
    expect(listCustomers(state, actor, { listGroup: 'ALL', q: '912345678' }).data.map((item) => item.id)).toEqual(['CUST-001']);
    expect(listCustomers(state, actor, { listGroup: 'ALL', q: 'dang quoc huy' }).data.map((item) => item.id)).toEqual(['CUST-008']);
  });

  it('Đang chăm sóc = Chưa tiếp cận + Có quan tâm; số đếm tab khớp số dòng', () => {
    const counts = getListCounts(state, actor, {});
    (['CARING', 'NET', 'DROPPED'] as const).forEach((listGroup) => {
      expect(listCustomers(state, actor, { listGroup, limit: 100 }).meta.total).toBe(counts[listGroup]);
    });
    expect(counts.CARING + counts.NET + counts.DROPPED).toBe(counts.ALL);
    const caringStatuses = new Set(listCustomers(state, actor, { listGroup: 'CARING', limit: 100 }).data.map((item) => item.status.code));
    expect([...caringStatuses].sort()).toEqual(['INTERESTED', 'NOT_CONTACTED']);
  });

  it('số đếm tab áp cùng bộ lọc (trừ tab)', () => {
    const counts = getListCounts(state, actor, { projectIds: ['proj-4'] });
    expect(counts.NET).toBe(2);
    expect(counts.CARING).toBe(0);
  });

  it('lọc theo nguồn, khu vực, tiến độ, người chăm sóc (cả người hỗ trợ), nghề nghiệp, thẻ', () => {
    const ids = (query: Parameters<typeof listCustomers>[2]) => listCustomers(state, actor, { listGroup: 'ALL', limit: 100, ...query }).data.map((item) => item.id).sort();
    expect(ids({ sourceIds: ['src-referral'] })).toEqual(['CUST-005']);
    expect(ids({ areaIds: ['area-q7'] })).toEqual(['CUST-001', 'CUST-007']);
    expect(ids({ progress: [100] })).toEqual(['CUST-004']);
    expect(ids({ progress: [0] })).toEqual(['CUST-011']);
    expect(ids({ assigneeIds: ['vy'] })).toEqual(['CUST-003']);
    expect(ids({ primaryAssigneeIds: ['vy'] })).toEqual([]);
    expect(ids({ occupation: 'giam doc' })).toEqual(['CUST-001', 'CUST-005', 'CUST-007']);
    expect(ids({ tagIds: ['tag-golf', 'tag-yacht'] })).toEqual(['CUST-007']);
  });

  it('sắp xếp mặc định theo ngày cập nhật cuối giảm dần; theo tên dùng thứ tự tiếng Việt', () => {
    const items = listCustomers(state, actor, { listGroup: 'ALL', limit: 100 }).data;
    const dates = items.map((item) => item.lastUpdatedAt);
    expect([...dates].sort().reverse()).toEqual(dates);
    const names = listCustomers(state, actor, { listGroup: 'ALL', limit: 100, sort: 'fullName' }).data.map((item) => item.fullName);
    expect(names[0]).toBe('Bùi Minh Phương');
  });

  it('phân trang trả meta chuẩn { total, page, limit, totalPages } và kẹp trang', () => {
    const page = listCustomers(state, actor, { listGroup: 'ALL', limit: 5, page: 99 });
    expect(page.meta).toEqual({ total: 11, page: 3, limit: 5, totalPages: 3 });
    expect(page.data).toHaveLength(1);
  });
});

describe('chi tiết khách', () => {
  it('tiến độ suy ra từ tiêu chí; quyền xem CCCD theo vai trò (D2)', () => {
    const staff = actorOf('thao');
    const detail = getCustomer(staff.state, staff.actor, 'CUST-001');
    expect(detail?.progress).toBe(50);
    expect(detail?.nationalIdMasked).toBe('••••1234');
    expect(detail?.permissions.canRevealNationalId).toBe(false);
    const primary = actorOf('hanh');
    expect(getCustomer(primary.state, primary.actor, 'CUST-001')?.permissions.canRevealNationalId).toBe(true);
  });

  it('dấu "Chính" chỉ khi tác giả đúng là phụ trách chính của khách', () => {
    const { state, actor } = actorOf('hanh');
    const logs = listCareLogs(state, actor, 'CUST-001');
    expect(logs.some((log) => log.isPrimaryAuthor)).toBe(true);
    expect(logs.filter((log) => log.isPrimaryAuthor).every((log) => log.author.id === 'hanh')).toBe(true);
    expect(logs.find((log) => log.author.id === 'thao')?.isPrimaryAuthor).toBe(false);
  });

  it('gợi ý bước tiếp theo lấy từ nhật ký thật (không có câu mặc định)', () => {
    const { state, actor } = actorOf('admin');
    expect(getCustomer(state, actor, 'CUST-011')?.nextActionSuggestions).toEqual(['Gọi giới thiệu lần đầu và hỏi nhu cầu']);
    expect(getCustomer(state, actor, 'CUST-006')?.nextActionSuggestions).toEqual([]);
  });
});

describe('lookupPhone (X2)', () => {
  it('khách ngoài phạm vi: chỉ trả tên người phụ trách, không lộ id/tên khách', () => {
    const { state, actor } = actorOf('thao');
    const result = lookupPhone(state, actor, '0988 333 112');
    expect(result).toMatchObject({ exists: true, isAccessible: false, caredByName: 'Minh', canRequestJoin: true });
    expect(result?.customerId).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain('Bích');
    expect(JSON.stringify(result)).not.toContain('CUST-002');
    expect(result?.customerRef).toMatch(/^JR-/);
  });

  it('khách trong phạm vi trả customerId; SĐT chưa có -> exists=false; sai định dạng -> null', () => {
    const { state, actor } = actorOf('hanh');
    const accessible = lookupPhone(state, actor, '+84912345678');
    expect(accessible).toMatchObject({ exists: true, isAccessible: true, customerId: 'CUST-001', canRequestJoin: false });
    expect(accessible?.customerRef).toBeUndefined(); // C6: đã xem được -> "Xem hồ sơ", không có nút đề nghị chết
    expect(lookupPhone(state, actor, '0900 000 000')?.exists).toBe(false);
    expect(lookupPhone(state, actor, '123')).toBeNull();
  });
});

describe('C3 tìm SĐT có ký tự phân cách / mã nước', () => {
  const { state, actor } = actorOf('admin');
  it.each([['+84912345678'], ['0912-345-678'], ['0912.345.678'], ['(0912) 345 678'], ['+84 912 345 678'], ['84912345678']])('"%s" ra CUST-001', (q) => {
    expect(listCustomers(state, actor, { listGroup: 'ALL', q }).data.map((item) => item.id)).toEqual(['CUST-001']);
  });
  it('số không tồn tại / quá ngắn không ra kết quả', () => {
    expect(listCustomers(state, actor, { listGroup: 'ALL', q: '+84999999999' }).data).toEqual([]);
  });
});

describe('bộ lọc ngày cập nhật — ranh giới múi giờ VN', () => {
  const { state, actor } = actorOf('admin');
  const withUpdatedAt = (lastUpdatedAt: string) => ({
    ...state,
    customers: state.customers.map((customer) => (customer.id === 'CUST-001' ? { ...customer, lastUpdatedAt } : customer)),
  });
  const ids = (updatedAt: string, filters: { updatedFrom?: string; updatedTo?: string }) =>
    listCustomers(withUpdatedAt(updatedAt), actor, { listGroup: 'ALL', ...filters }).data.map((item) => item.id);

  it('updatedFrom: 16:59:59.999Z ngày 21 (còn ngày 21 giờ VN) bị loại khỏi "từ 22/10"; 17:00:00Z được giữ', () => {
    expect(ids('2026-10-21T16:59:59.999Z', { updatedFrom: '2026-10-22', updatedTo: '2026-10-22' })).not.toContain('CUST-001');
    expect(ids('2026-10-21T17:00:00.000Z', { updatedFrom: '2026-10-22', updatedTo: '2026-10-22' })).toContain('CUST-001');
  });

  it('updatedTo: 16:59:59.999Z ngày 22 còn trong "đến 22/10"; 17:00:00Z (ngày 23 giờ VN) bị loại', () => {
    expect(ids('2026-10-22T16:59:59.999Z', { updatedTo: '2026-10-22' })).toContain('CUST-001');
    expect(ids('2026-10-22T17:00:00.000Z', { updatedTo: '2026-10-22' })).not.toContain('CUST-001');
  });
});
