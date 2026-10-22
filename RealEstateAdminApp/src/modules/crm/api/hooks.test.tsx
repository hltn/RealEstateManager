import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { CrmProvider } from '@crm/store/CrmProvider';
import { createCrmStore, createSeedDataState } from '@crm/store/crmStore';
import { FIXED_NOW } from '@crm/test/fixtures';
import { getCustomerTeamIds, getUsersById } from './access';
import { useCrmActor } from './hooks';

const setup = () => {
  const store = createCrmStore({ initialData: createSeedDataState(FIXED_NOW), initialSession: { currentUserId: 'hanh' }, shouldPersist: false });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <MemoryRouter>
      <CrmProvider store={store}>{children}</CrmProvider>
    </MemoryRouter>
  );
  return { store, wrapper };
};

describe('TB8 useCrmActor ổn định tham chiếu', () => {
  it('đổi dữ liệu khách/cài đặt KHÔNG tạo actor mới (tránh tính lại mọi truy vấn); đổi người dùng thì có', () => {
    const { store, wrapper } = setup();
    const { result } = renderHook(() => useCrmActor(), { wrapper });
    const first = result.current;
    act(() => store.getState().dispatch({ type: 'settings/update', changes: { upcomingDays: 9 } }));
    expect(result.current).toBe(first);
    act(() => store.getState().dispatch({ type: 'session/setUser', userId: 'minh' }));
    expect(result.current).not.toBe(first);
    expect(result.current.userId).toBe('minh');
  });
});

describe('TB8 map user cho phạm vi', () => {
  it('getUsersById cache theo tham chiếu mảng và getCustomerTeamIds cho kết quả đúng', () => {
    const { users } = createSeedDataState(FIXED_NOW);
    expect(getUsersById(users)).toBe(getUsersById(users));
    expect(getUsersById(users).get('hanh')?.displayName).toBe('Hạnh');
    expect(getCustomerTeamIds({ careTeam: [{ userId: 'hanh', role: 'PRIMARY', addedBy: 'hanh', addedAt: '' }, { userId: 'minh', role: 'MEMBER', addedBy: 'hanh', addedAt: '' }], createdBy: 'hanh' }, users).sort()).toEqual(['team-1', 'team-2']);
  });
});

describe('usePhoneLookup phản ứng theo state (thay mẹo lookupVersion)', () => {
  it('sau khi gửi đề nghị, kết quả tra trùng tự chuyển sang "đang chờ duyệt"', async () => {
    const { store, wrapper } = setup();
    act(() => store.getState().dispatch({ type: 'session/setUser', userId: 'thao' }));
    const { usePhoneLookup, useCrmApi } = await import('./hooks');
    const { result } = renderHook(() => ({ lookup: usePhoneLookup('0988 333 112'), api: useCrmApi() }), { wrapper });
    expect(result.current.lookup).toMatchObject({ exists: true, canRequestJoin: true, hasPendingRequest: false });
    act(() => {
      result.current.api.createCareTeamRequest({ customerRef: result.current.lookup?.customerRef as string });
    });
    expect(result.current.lookup).toMatchObject({ hasPendingRequest: true, canRequestJoin: false });
  });
});
