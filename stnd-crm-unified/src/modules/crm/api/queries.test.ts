import { describe, expect, it } from 'vitest';
import { createHarness } from '../../../test/crmHarness';
import { listCareTeamInvitees, listCustomerAssignees, listCustomers } from './queries';

describe('listCareTeamInvitees (care-team-invitees)', () => {
  it('chỉ trả id, displayName, teamNames; không email/SĐT/vai trò', () => {
    const { state, actor } = createHarness({ actAs: 'hanh' });
    const page = listCareTeamInvitees(state(), actor(), { customerId: 'CUST-001' });
    expect(page.data.length).toBeGreaterThan(0);
    page.data.forEach((item) => expect(Object.keys(item).sort()).toEqual(['displayName', 'id', 'teamNames']));
  });

  it('loại người gọi và người đã trong nhóm; không có tài khoản khóa hay chỉ-EDITOR', () => {
    const { state, actor } = createHarness({ actAs: 'hanh' });
    const ids = listCareTeamInvitees(state(), actor(), { customerId: 'CUST-001' }).data.map((item) => item.id);
    expect(ids).not.toContain('hanh');
    expect(ids).not.toContain('thao');
    expect(ids).not.toContain('phuc');
    expect(ids).not.toContain('ha');
    expect(ids).toContain('tuan');
  });

  it('mời không giới hạn theo nhóm người gọi (Quản lý nhóm 1 thấy nhân viên nhóm 2)', () => {
    const { state, actor } = createHarness({ actAs: 'hanh' });
    expect(listCareTeamInvitees(state(), actor(), { customerId: 'CUST-001' }).data.map((item) => item.id)).toContain('tung');
  });

  it('limit tối đa 20, trang cuối không vượt giới hạn', () => {
    const { state, actor } = createHarness({ actAs: 'admin' });
    const page = listCareTeamInvitees(state(), actor(), { limit: 500 });
    expect(page.meta.limit).toBe(20);
    expect(page.data.length).toBeLessThanOrEqual(20);
  });

  it('tìm theo tên hiển thị không dấu', () => {
    const { state, actor } = createHarness({ actAs: 'admin' });
    expect(listCareTeamInvitees(state(), actor(), { q: 'thao' }).data.map((item) => item.id)).toEqual(['thao']);
  });

  it('STAFF không phải PRIMARY, hoặc STAFF không có customerId: trang rỗng', () => {
    const member = createHarness({ actAs: 'thao' });
    expect(listCareTeamInvitees(member.state(), member.actor(), { customerId: 'CUST-001' }).data).toEqual([]);
    expect(listCareTeamInvitees(member.state(), member.actor(), {}).data).toEqual([]);
  });
});

describe('listCustomerAssignees (customer-assignees)', () => {
  it('trả người trong careTeam của khách thấy được, gồm cả tài khoản đã khóa với isLocked', () => {
    const { state, actor } = createHarness({
      actAs: 'admin',
      mutate: (data) => ({ ...data, users: data.users.map((user) => (user.id === 'thao' ? { ...user, isActive: false } : user)) }),
    });
    const items = listCustomerAssignees(state(), actor()).data;
    expect(items.find((item) => item.id === 'thao')?.isLocked).toBe(true);
    expect(items.find((item) => item.id === 'hanh')?.isLocked).toBe(false);
  });

  it('không lộ người ngoài careTeam của khách (tung không phụ trách khách nào của nhóm 1)', () => {
    const { state, actor } = createHarness({ actAs: 'thao' });
    const ids = listCustomerAssignees(state(), actor()).data.map((item) => item.id);
    expect(ids).toContain('thao');
    expect(ids).not.toContain('admin');
  });

  it('limit tối đa 100', () => {
    const { state, actor } = createHarness({ actAs: 'admin' });
    expect(listCustomerAssignees(state(), actor(), { limit: 9999 }).meta.limit).toBe(100);
  });
});

describe('listCustomers: mã khách và khách không SĐT', () => {
  it('khách không SĐT có phoneMasked null và vẫn có mã', () => {
    const { state, actor } = createHarness({ actAs: 'hanh' });
    const item = listCustomers(state(), actor(), { limit: 100 }).data.find((customer) => customer.id === 'CUST-017');
    expect(item?.phoneMasked).toBeNull();
    expect(item?.customerCode).toMatch(/^KH-\d{6}$/);
  });

  it('tìm theo mã KH-000001 (có/không gạch ngang) ra đúng khách', () => {
    const { state, actor } = createHarness({ actAs: 'admin' });
    const first = state().customers[0];
    const byCode = listCustomers(state(), actor(), { q: first.customerCode ?? '' }).data.map((item) => item.id);
    expect(byCode).toEqual([first.id]);
    const noDash = (first.customerCode ?? '').replace('-', '');
    expect(listCustomers(state(), actor(), { q: noDash }).data.map((item) => item.id)).toContain(first.id);
  });

  it('hai khách cùng SĐT cùng hiện ra khi tìm theo SĐT', () => {
    const { state, actor } = createHarness({ actAs: 'admin' });
    const ids = listCustomers(state(), actor(), { q: '0912345678' }).data.map((item) => item.id);
    expect(ids).toEqual(expect.arrayContaining(['CUST-001', 'CUST-018']));
  });

  it('mã khách là duy nhất trong dữ liệu mẫu', () => {
    const { state } = createHarness();
    const codes = state().customers.map((customer) => customer.customerCode);
    expect(new Set(codes).size).toBe(codes.length);
  });
});
