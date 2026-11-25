/**
 * Dựng component CRM trong test: store riêng (không ghi localStorage) + `CrmProvider` + `MemoryRouter` + tài khoản đăng nhập giả.
 * `LocationProbe` hiện đường dẫn hiện tại (`data-testid="location"`) để kiểm điều hướng sau khi lưu.
 */
import type { ReactElement } from 'react';
import { render, type RenderResult } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { CrmProvider } from '@crm/store';
import type { CrmDataState } from '@crm/store';
import { useAuthStore } from '../stores/auth.store';
import { createHarness, type CrmHarness } from './crmHarness';

interface RenderCrmOptions {
  /** Id người dùng mẫu đăng nhập (mặc định hanh = Quản lý nhóm 1). */
  actAs?: string;
  route?: string;
  mutate?: (data: CrmDataState) => CrmDataState;
}

export const LocationProbe = () => {
  const { pathname } = useLocation();
  return <output data-testid="location">{pathname}</output>;
};

/** Đặt người đăng nhập theo dữ liệu mẫu của store (vai trò lấy từ chính người dùng mẫu). */
export const signInAs = (harness: CrmHarness, userId: string): void => {
  const user = harness.state().users.find((item) => item.id === userId);
  if (!user) throw new Error(`Không có người dùng mẫu ${userId}`);
  useAuthStore.setState({
    user: { _id: user.id, email: `${user.id}@stnd.vn`, displayName: user.displayName, role: user.role, teamId: user.teamId ?? undefined },
    accessToken: 't',
  });
};

export const signOut = (): void => useAuthStore.setState({ user: null, accessToken: null });

export const renderCrm = (ui: ReactElement, { actAs = 'hanh', route = '/crm/customers', mutate }: RenderCrmOptions = {}): RenderResult & { harness: CrmHarness } => {
  const harness = createHarness({ actAs, mutate });
  signInAs(harness, actAs);
  const result = render(
    <MemoryRouter initialEntries={[route]}>
      <CrmProvider store={harness.store}>
        {ui}
        <LocationProbe />
      </CrmProvider>
    </MemoryRouter>,
  );
  return { ...result, harness };
};
