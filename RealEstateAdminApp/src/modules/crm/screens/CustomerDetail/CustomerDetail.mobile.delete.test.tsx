/** Chi tiết khách (mobile): nút "Xóa khách" nằm cuối tab "Thông tin" (kín đáo), KHÔNG ở cụm nút đầu trang; phân quyền theo `permissions.canDelete`. */
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CustomerDetail } from '@crm/api';
import { CrmProvider } from '@crm/store/CrmProvider';
import { createCrmStore, createSeedDataState } from '@crm/store/crmStore';
import { FIXED_NOW } from '@crm/test/fixtures';
import { CustomerDetailMobile } from './CustomerDetail.mobile';

vi.mock('@crm/config/featureFlags', () => ({
  CRM_FEATURE_FLAGS: { isAttachmentsEnabled: true, isInAppCallEnabled: false, isZaloZnsEnabled: false },
}));
vi.mock('./components/UpcomingAppointmentsSection', () => ({ UpcomingAppointmentsSection: () => null }));
vi.mock('./components/PersonaCards', () => ({ PersonaCard: () => null, RealEstateNeedsCard: () => null }));
vi.mock('./components/CriteriaBoard', () => ({ CriteriaBoard: () => null }));
vi.mock('./components/CareTeamCard', () => ({ CareTeamCard: () => null }));

/** Hồ sơ khách do từng test đổi quyền xóa (khai báo bằng hoisted để vi.mock đọc được). */
const state = vi.hoisted(() => ({ canDelete: true }));

const makeCustomer = (canDelete: boolean) =>
  ({
    id: 'c1',
    customerCode: 'KH-000053',
    fullName: 'Nguyễn Văn An',
    phoneMasked: '0912 ••• 678',
    email: '',
    area: null,
    source: null,
    projects: [],
    tags: [],
    hasNationalId: false,
    nationalIdMasked: null,
    createdAt: '2026-10-20T03:00:00.000Z',
    createdBy: { id: 'u1', displayName: 'Hạnh' },
    lastUpdatedAt: '2026-10-26T02:00:00.000Z',
    lastUpdatedBy: { id: 'u1', displayName: 'Hạnh' },
    primaryAssignee: { id: 'u1', displayName: 'Hạnh' },
    status: { id: 's', label: 'Mới', tone: 'brand' },
    permissions: { canDelete, canRevealNationalId: false },
    careTeam: [{ role: 'PRIMARY', user: { id: 'u1' } }],
    criteria: {},
    nextActionSuggestions: [],
    version: 1,
  }) as unknown as CustomerDetail;

vi.mock('@crm/api', async () => {
  const real = await vi.importActual<typeof import('@crm/api')>('@crm/api');
  return {
    ...real,
    useCustomerDetail: () => ({ data: makeCustomer(state.canDelete), isLoading: false, isNotFound: false, error: null, refetch: vi.fn() }),
    useCareLogs: () => ({ data: [], isLoading: false, hasMore: false, isFetchingMore: false, loadMore: vi.fn(), refetch: vi.fn() }),
    useCustomerHistories: () => ({ data: [], isLoading: false, isError: false, error: null, isFetching: false, refetch: vi.fn() }),
    useCrmApi: () => ({ createPhoneView: vi.fn(), createCareLog: vi.fn(), updateCareLog: vi.fn(), deleteCareLogAttachment: vi.fn(), removeSavedCareLogAttachment: vi.fn(), deleteCustomer: vi.fn() }),
    useCrmActor: () => ({ userId: 'u1', role: 'STAFF', teamId: null, managedTeamIds: [] }),
    useCatalogs: () => ({ catalogs: { statuses: [], contactResults: [] }, users: [] }),
    useNationalIdViews: () => ({ data: [] }),
  };
});

const renderScreen = () => {
  const store = createCrmStore({ initialData: createSeedDataState(FIXED_NOW), shouldPersist: false });
  return render(
    <MemoryRouter initialEntries={['/crm/customers/c1']}>
      <CrmProvider store={store}>
        <Routes>
          <Route path="/crm/customers/:customerId" element={<CustomerDetailMobile />} />
        </Routes>
      </CrmProvider>
    </MemoryRouter>,
  );
};

const getDeleteButtons = () => screen.queryAllByRole('button', { name: 'Xóa khách' });

beforeEach(() => {
  state.canDelete = true;
});

describe('Chi tiết khách (mobile): "Xóa khách" ở cuối tab Thông tin', () => {
  it('có quyền xóa: đúng 1 nút, nằm cuối tab Thông tin (sau mọi khối), KHÔNG trong thẻ tóm tắt đầu trang', () => {
    renderScreen();
    const buttons = getDeleteButtons();
    expect(buttons).toHaveLength(1);
    const summary = screen.getByRole('region', { name: 'Tóm tắt hồ sơ' });
    expect(within(summary).queryByRole('button', { name: 'Xóa khách' })).toBeNull();
    const info = screen.getByRole('region', { name: 'Thông tin khách hàng' });
    // Nút đứng SAU khối thông tin khách trong tài liệu và có đường kẻ phía trên (border-t).
    expect(info.compareDocumentPosition(buttons[0]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(buttons[0].parentElement).toHaveClass('border-t');
    expect(buttons[0].className).not.toMatch(/(^|\s)bg-error-(500|600)/);
  });

  it('có quyền xóa: chỉ hiện ở tab Thông tin, đổi sang Nhật ký/Tiến độ thì không còn nút', () => {
    renderScreen();
    fireEvent.click(screen.getByRole('tab', { name: 'Nhật ký' }));
    expect(getDeleteButtons()).toHaveLength(0);
    fireEvent.click(screen.getByRole('tab', { name: 'Tiến độ' }));
    expect(getDeleteButtons()).toHaveLength(0);
    fireEvent.click(screen.getByRole('tab', { name: 'Thông tin' }));
    expect(getDeleteButtons()).toHaveLength(1);
  });

  it('KHÔNG có quyền xóa (vd. người được mời chéo nhóm): không có nút ở bất kỳ đâu/tab nào', () => {
    state.canDelete = false;
    renderScreen();
    expect(getDeleteButtons()).toHaveLength(0);
    for (const tab of ['Nhật ký', 'Tiến độ', 'Thông tin']) {
      fireEvent.click(screen.getByRole('tab', { name: tab }));
      expect(getDeleteButtons()).toHaveLength(0);
    }
  });

  it('bấm nút: mở hộp xác nhận có ô lý do và tiêu đề đúng tên khách (không nhân đôi nút)', () => {
    renderScreen();
    fireEvent.click(getDeleteButtons()[0]);
    expect(screen.getByLabelText(/Lý do xóa/)).toBeInTheDocument();
    expect(screen.getByText('Xóa khách Nguyễn Văn An?')).toBeInTheDocument();
  });
});
