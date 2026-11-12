import { describe, expect, it } from 'vitest';
import { createHarness, withEmptyCareTeam } from '../../../test/crmHarness';
import { listCareTeamInvitees } from './queries';
import type { ApiResult } from './types';

const errorOf = <T>(result: ApiResult<T>) => {
  if (result.ok) throw new Error('Kỳ vọng lỗi nhưng thành công');
  return result.error;
};
const dataOf = <T>(result: ApiResult<T>): T => {
  if (!result.ok) throw new Error(`Kỳ vọng thành công nhưng lỗi ${result.error.errorCode}`);
  return result.data;
};

describe('createCustomer (v1.0.5)', () => {
  it('chỉ cần họ tên: phone null, có mã khách, người tạo là PRIMARY', async () => {
    const harness = createHarness({ actAs: 'thao' });
    const created = dataOf(await harness.api.createCustomer({ fullName: 'Khách không số' }));
    expect(created.phoneMasked).toBeNull();
    expect(created.customerCode).toMatch(/^KH-\d{6}$/);
    expect(created.careTeam.map((member) => [member.user.id, member.role])).toEqual([['thao', 'PRIMARY']]);
  });

  it.each(['admin', 'hanh', 'thao'])('%s tạo khách đều là PRIMARY (kể cả Quản trị)', async (userId) => {
    const harness = createHarness({ actAs: userId });
    const created = dataOf(await harness.api.createCustomer({ fullName: `Khách của ${userId}` }));
    expect(created.careTeam).toHaveLength(1);
    expect(created.careTeam[0]).toMatchObject({ role: 'PRIMARY', user: { id: userId } });
  });

  it('cho phép trùng SĐT với khách khác; mã khách khác nhau', async () => {
    const harness = createHarness({ actAs: 'hanh' });
    const first = dataOf(await harness.api.createCustomer({ fullName: 'A', phone: '0912345678' }));
    const second = dataOf(await harness.api.createCustomer({ fullName: 'B', phone: '0912345678' }));
    expect(first.customerCode).not.toBe(second.customerCode);
    expect(harness.state().customers.filter((customer) => customer.phone === '+84912345678').length).toBeGreaterThanOrEqual(3);
  });

  it('SĐT rỗng hoặc null được lưu null; SĐT sai bị 400 INVALID_PHONE', async () => {
    const harness = createHarness({ actAs: 'hanh' });
    expect(dataOf(await harness.api.createCustomer({ fullName: 'A', phone: '' })).phoneMasked).toBeNull();
    expect(dataOf(await harness.api.createCustomer({ fullName: 'B', phone: null })).phoneMasked).toBeNull();
    expect(errorOf(await harness.api.createCustomer({ fullName: 'C', phone: '12' })).errorCode).toBe('INVALID_PHONE');
  });

  it('bỏ qua careTeam do client gửi (người tạo vẫn là PRIMARY duy nhất)', async () => {
    const harness = createHarness({ actAs: 'thao' });
    const input = { fullName: 'A', careTeam: { primaryUserId: 'tuan', memberIds: ['trang'] } } as unknown as Parameters<typeof harness.api.createCustomer>[0];
    const created = dataOf(await harness.api.createCustomer(input));
    expect(created.careTeam.map((member) => member.user.id)).toEqual(['thao']);
  });

  it('mã khách tăng dần, không dùng lại sau khi tạo liên tiếp', async () => {
    const harness = createHarness({ actAs: 'hanh' });
    const codes = [dataOf(await harness.api.createCustomer({ fullName: 'A' })).customerCode, dataOf(await harness.api.createCustomer({ fullName: 'B' })).customerCode];
    expect(new Set(codes).size).toBe(2);
    expect((codes[1] ?? '') > (codes[0] ?? '')).toBe(true);
  });
});

describe('updateCustomer: xóa SĐT', () => {
  it('phone null xóa số, rồi phone-view trả 409 CUSTOMER_PHONE_NOT_SET', async () => {
    const harness = createHarness({ actAs: 'hanh' });
    const version = harness.state().customers.find((customer) => customer.id === 'CUST-001')?.version ?? 1;
    const updated = dataOf(await harness.api.updateCustomer('CUST-001', { version, phone: null }));
    expect(updated.phoneMasked).toBeNull();
    expect(harness.state().customers.find((customer) => customer.id === 'CUST-001')?.phone).toBeNull();
    expect(errorOf(await harness.api.createPhoneView('CUST-001')).errorCode).toBe('CUSTOMER_PHONE_NOT_SET');
  });

  it('phone rỗng cũng xóa số; số trùng khách khác vẫn được lưu', async () => {
    const harness = createHarness({ actAs: 'hanh' });
    const version = (id: string) => harness.state().customers.find((customer) => customer.id === id)?.version ?? 1;
    expect(dataOf(await harness.api.updateCustomer('CUST-001', { version: version('CUST-001'), phone: '' })).phoneMasked).toBeNull();
    dataOf(await harness.api.updateCustomer('CUST-017', { version: version('CUST-017'), phone: '0988333112' }));
    expect(harness.state().customers.filter((customer) => customer.phone === '+84988333112')).toHaveLength(2);
  });
});

describe('createPhoneView', () => {
  it('khách không SĐT: 409 CUSTOMER_PHONE_NOT_SET, KHÔNG ghi log PHONE_VIEWED', async () => {
    const harness = createHarness({ actAs: 'hanh' });
    const logsBefore = harness.state().changeLogs.length;
    const error = errorOf(await harness.api.createPhoneView('CUST-017'));
    expect(error.statusCode).toBe(409);
    expect(error.errorCode).toBe('CUSTOMER_PHONE_NOT_SET');
    expect(error.message).toBe('Khách chưa có số điện thoại');
    expect(harness.state().changeLogs).toHaveLength(logsBefore);
  });

  it('khách có SĐT: trả số và ghi log', async () => {
    const harness = createHarness({ actAs: 'hanh' });
    const logsBefore = harness.state().changeLogs.length;
    expect(dataOf(await harness.api.createPhoneView('CUST-001')).phone).toBe('+84912345678');
    expect(harness.state().changeLogs.length).toBeGreaterThan(logsBefore);
  });
});

describe('nhóm chăm sóc', () => {
  it('thêm MEMBER thành công; thêm lại -> 409 ALREADY_IN_CARE_TEAM', async () => {
    const harness = createHarness({ actAs: 'hanh' });
    dataOf(await harness.api.addCareTeamMembers('CUST-011', { userIds: ['tuan'] }));
    expect(errorOf(await harness.api.addCareTeamMembers('CUST-011', { userIds: ['tuan'] })).errorCode).toBe('ALREADY_IN_CARE_TEAM');
  });

  it('nhóm có người: gửi primaryUserId -> 400 VALIDATION_FAILED', async () => {
    const harness = createHarness({ actAs: 'hanh' });
    const error = errorOf(await harness.api.addCareTeamMembers('CUST-011', { userIds: ['tuan'], primaryUserId: 'tuan' }));
    expect(error).toMatchObject({ statusCode: 400, errorCode: 'VALIDATION_FAILED' });
  });

  it('tối đa 10 MEMBER: thứ 11 -> 409 CARE_TEAM_LIMIT_EXCEEDED, nhóm không đổi', async () => {
    // Dữ liệu mẫu chỉ có 10 người mời được: thêm 3 nhân viên giả để đủ vượt giới hạn.
    const harness = createHarness({
      actAs: 'admin',
      mutate: (data) => ({ ...data, users: [...data.users, ...['x1', 'x2', 'x3'].map((id) => ({ ...data.users.find((user) => user.id === 'tuan')!, id, email: `${id}@stnd.vn`, displayName: id }))] }),
    });
    // Nguồn ứng viên đúng như UI: chính `listCareTeamInvitees` (đã loại tài khoản khóa/không phân công được).
    const memberIds = listCareTeamInvitees(harness.state(), harness.actor(), { customerId: 'CUST-011', limit: 20 }).data.map((user) => user.id);
    expect(memberIds.length).toBeGreaterThanOrEqual(11);
    dataOf(await harness.api.addCareTeamMembers('CUST-011', { userIds: memberIds.slice(0, 10) }));
    const error = errorOf(await harness.api.addCareTeamMembers('CUST-011', { userIds: [memberIds[10]] }));
    expect(error.errorCode).toBe('CARE_TEAM_LIMIT_EXCEEDED');
    expect(harness.state().customers.find((customer) => customer.id === 'CUST-011')?.careTeam).toHaveLength(11);
  });

  it('gỡ PRIMARY -> 409 PRIMARY_LOCKED; gỡ MEMBER thành công', async () => {
    const harness = createHarness({ actAs: 'hanh' });
    expect(errorOf(await harness.api.removeCareTeamMember('CUST-001', 'hanh')).errorCode).toBe('PRIMARY_LOCKED');
    dataOf(await harness.api.removeCareTeamMember('CUST-001', 'thao'));
    expect(harness.state().customers.find((customer) => customer.id === 'CUST-001')?.careTeam.map((member) => member.userId)).toEqual(['hanh']);
  });

  it('không còn API đổi PRIMARY/đề nghị tham gia', () => {
    const { api } = createHarness();
    const keys = Object.keys(api);
    expect(keys).not.toContain('changePrimary');
    expect(keys).not.toContain('createCareTeamRequest');
    expect(keys).not.toContain('resolveCareTeamRequest');
    expect(keys).not.toContain('lookupPhone');
  });
});

describe('khách chưa có PRIMARY (nhóm rỗng)', () => {
  const options = { mutate: withEmptyCareTeam('CUST-011') };

  it('thiếu primaryUserId -> 400 PRIMARY_REQUIRED', async () => {
    const harness = createHarness({ actAs: 'admin', ...options });
    expect(errorOf(await harness.api.addCareTeamMembers('CUST-011', { userIds: ['tuan'] })).errorCode).toBe('PRIMARY_REQUIRED');
  });

  it('Manager/Admin đặt PRIMARY ban đầu một lần, sau đó bị khóa', async () => {
    const harness = createHarness({ actAs: 'admin', ...options });
    dataOf(await harness.api.setInitialPrimary('CUST-011', 'tuan'));
    const team = harness.state().customers.find((customer) => customer.id === 'CUST-011')?.careTeam ?? [];
    expect(team.map((member) => [member.userId, member.role])).toEqual([['tuan', 'PRIMARY']]);
    expect(errorOf(await harness.api.setInitialPrimary('CUST-011', 'trang')).errorCode).toBe('PRIMARY_LOCKED');
  });

  it('Staff không được đặt PRIMARY ban đầu (403)', async () => {
    const harness = createHarness({ actAs: 'thao', ...options });
    const result = await harness.api.setInitialPrimary('CUST-011', 'thao');
    // Staff không thấy khách chưa phân công của người khác: 404 hoặc 403 đều là từ chối đúng.
    expect([403, 404]).toContain(errorOf(result).statusCode);
  });
});

describe('bulkOperation ASSIGN', () => {
  it('chỉ thêm MEMBER, không giới hạn theo nhóm người gọi', async () => {
    const harness = createHarness({ actAs: 'hanh' });
    const result = dataOf(await harness.api.bulkOperation({ type: 'ASSIGN', customerIds: ['CUST-011'], memberIds: ['tung'] }));
    expect(result.succeeded).toEqual(['CUST-011']);
    expect(harness.state().customers.find((customer) => customer.id === 'CUST-011')?.careTeam.find((member) => member.userId === 'tung')?.role).toBe('MEMBER');
  });

  it('khách nhóm rỗng: PRIMARY_REQUIRED theo từng khách, khách khác vẫn chạy', async () => {
    const harness = createHarness({ actAs: 'admin', mutate: withEmptyCareTeam('CUST-011') });
    const result = dataOf(await harness.api.bulkOperation({ type: 'ASSIGN', customerIds: ['CUST-011', 'CUST-001'], memberIds: ['tung'] }));
    expect(result.failed).toEqual([{ customerId: 'CUST-011', errorCode: 'PRIMARY_REQUIRED' }]);
    expect(result.succeeded).toEqual(['CUST-001']);
  });

  it('Staff không được phân hàng loạt (403)', async () => {
    const harness = createHarness({ actAs: 'thao' });
    expect(errorOf(await harness.api.bulkOperation({ type: 'ASSIGN', customerIds: ['CUST-001'], memberIds: ['tuan'] })).statusCode).toBe(403);
  });
});
