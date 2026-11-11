import { createElement, type ReactNode } from 'react';
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { CrmStoreContext } from '@crm/store/crmContext';
import { useAuthStore } from '../../../stores/auth.store';
import { createHarness } from '../../../test/crmHarness';
import { careTeamInviteesKey, useAssigneeFilterOptions, useCareTeamInvitees, useCatalogs } from './hooks';

const renderWithCrm = <T,>(callback: (props: { enabled: boolean; q: string; page: number }) => T, userId = 'hanh', role: 'ADMIN' | 'MANAGER' | 'STAFF' = 'MANAGER') => {
  const harness = createHarness({ actAs: userId });
  useAuthStore.setState({ user: { _id: userId, email: `${userId}@stnd.vn`, displayName: userId, role }, accessToken: 't' });
  const wrapper = ({ children }: { children: ReactNode }) => createElement(CrmStoreContext.Provider, { value: harness.store }, children);
  const rendered = renderHook(callback, { wrapper, initialProps: { enabled: true, q: '', page: 1 } });
  return { harness, ...rendered };
};

afterEach(() => useAuthStore.setState({ user: null, accessToken: null }));

describe('careTeamInviteesKey', () => {
  it('đúng dạng [crm, care-team-invitees, customerId, q, page]', () => {
    expect(careTeamInviteesKey('CUST-1', 'an', 2)).toEqual(['crm', 'care-team-invitees', 'CUST-1', 'an', 2]);
  });

  it('không có customerId -> null (thao tác hàng loạt)', () => {
    expect(careTeamInviteesKey(undefined, '', 1)).toEqual(['crm', 'care-team-invitees', null, '', 1]);
  });

  it('khác q/page/customerId cho khóa khác nhau', () => {
    const base = careTeamInviteesKey('C', '', 1).join('|');
    expect(careTeamInviteesKey('C', 'a', 1).join('|')).not.toBe(base);
    expect(careTeamInviteesKey('C', '', 2).join('|')).not.toBe(base);
    expect(careTeamInviteesKey('D', '', 1).join('|')).not.toBe(base);
  });
});

describe('useCareTeamInvitees', () => {
  it('trả danh sách người mời được khi bật', () => {
    const { result } = renderWithCrm(({ enabled, q, page }) => useCareTeamInvitees('CUST-001', q, page, enabled));
    expect(result.current.data.data.length).toBeGreaterThan(0);
    expect(result.current.data.data.map((item) => item.id)).not.toContain('hanh');
  });

  it('đổi q: kết quả theo từ khóa mới', () => {
    const { result, rerender } = renderWithCrm(({ enabled, q, page }) => useCareTeamInvitees('CUST-001', q, page, enabled));
    rerender({ enabled: true, q: 'tuan', page: 1 });
    expect(result.current.data.data.map((item) => item.id)).toEqual(['tuan']);
  });

  it('keepPreviousData: khi tắt (hộp thoại đóng) vẫn giữ kết quả cuối, không nháy rỗng', () => {
    const { result, rerender } = renderWithCrm(({ enabled, q, page }) => useCareTeamInvitees('CUST-001', q, page, enabled));
    rerender({ enabled: true, q: 'tuan', page: 1 });
    expect(result.current.data.data).toHaveLength(1);
    rerender({ enabled: false, q: 'tuan', page: 1 });
    expect(result.current.data.data.map((item) => item.id)).toEqual(['tuan']);
  });

  it('chưa bật lần nào: trang rỗng hợp lệ (có meta)', () => {
    const { result } = renderWithCrm(({ q, page }) => useCareTeamInvitees('CUST-001', q, page, false));
    expect(result.current.data.data).toEqual([]);
    expect(result.current.data.meta.limit).toBe(20);
  });

  it('thêm người vào nhóm thì người đó biến khỏi danh sách', async () => {
    const { result, harness } = renderWithCrm(({ enabled, q, page }) => useCareTeamInvitees('CUST-011', q, page, enabled));
    expect(result.current.data.data.map((item) => item.id)).toContain('tuan');
    await act(async () => {
      await harness.api.addCareTeamMembers('CUST-011', { userIds: ['tuan'] });
    });
    expect(result.current.data.data.map((item) => item.id)).not.toContain('tuan');
  });
});

describe('useCatalogs', () => {
  it('không còn assignable và users (backend đã gỡ nguồn cũ)', () => {
    const { result } = renderWithCrm(() => useCatalogs());
    expect(result.current).not.toHaveProperty('assignable');
    expect(result.current).not.toHaveProperty('users');
    expect(result.current.catalogs.statuses.length).toBeGreaterThan(0);
  });
});

describe('useAssigneeFilterOptions', () => {
  it('lấy từ customer-assignees: tài khoản khóa có hậu tố "(đã khóa)"', () => {
    const harness = createHarness({
      actAs: 'admin',
      mutate: (data) => ({ ...data, users: data.users.map((user) => (user.id === 'thao' ? { ...user, isActive: false } : user)) }),
    });
    useAuthStore.setState({ user: { _id: 'admin', email: 'admin@stnd.vn', displayName: 'Admin', role: 'ADMIN' }, accessToken: 't' });
    const wrapper = ({ children }: { children: ReactNode }) => createElement(CrmStoreContext.Provider, { value: harness.store }, children);
    const { result } = renderHook(() => useAssigneeFilterOptions(), { wrapper });
    const labels = Object.fromEntries(result.current.map((option) => [option.value, option.label]));
    expect(labels.thao).toMatch(/đã khóa/);
    expect(labels.hanh).toBe('Hạnh');
  });

  it('Staff chỉ thấy người trong careTeam của khách mình thấy', () => {
    const { result } = renderWithCrm(() => useAssigneeFilterOptions(), 'thao', 'STAFF');
    const ids = result.current.map((option) => option.value);
    expect(ids).toContain('thao');
    expect(ids).not.toContain('admin');
  });
});
