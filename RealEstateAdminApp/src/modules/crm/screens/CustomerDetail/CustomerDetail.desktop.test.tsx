import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CareLogView, CustomerDetail } from '@crm/api';
import { CrmProvider } from '@crm/store/CrmProvider';
import { createCrmStore, createSeedDataState } from '@crm/store/crmStore';
import { FIXED_NOW } from '@crm/test/fixtures';
import { CustomerDetailDesktop } from './CustomerDetail.desktop';

// Cờ ảnh BẬT để kiểm form ĐẦY ĐỦ (nội dung, kênh, kết quả, nhắc việc, ảnh).
vi.mock('@crm/config/featureFlags', () => ({
  CRM_FEATURE_FLAGS: { isAttachmentsEnabled: true, isInAppCallEnabled: false, isZaloZnsEnabled: false },
}));

// Các khối không liên quan tới PT-020/PT-022 được giản lược để test tập trung vào luồng Ghi chú / Lịch sử / Sửa.
vi.mock('./components/UpcomingAppointmentsSection', () => ({ UpcomingAppointmentsSection: () => null }));
vi.mock('./components/PersonaCards', () => ({ PersonaCard: () => null, RealEstateNeedsCard: () => null }));
vi.mock('./components/CriteriaBoard', () => ({ CriteriaBoard: () => null }));
vi.mock('./components/CareTeamCard', () => ({ CareTeamCard: () => null }));

const useCustomerHistories = vi.fn();
const createCareLog = vi.fn();
const customer = {
  id: 'c1',
  fullName: 'Nguyễn Văn A Rất Dài Tên Khách Hàng',
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
  permissions: { canDelete: false, canRevealNationalId: false },
  careTeam: [{ role: 'PRIMARY', user: { id: 'u1' } }],
  criteria: {},
  nextActionSuggestions: [],
  version: 1,
} as unknown as CustomerDetail;

const log: CareLogView = {
  id: 'l1',
  customerId: 'c1',
  author: { id: 'u1', displayName: 'Hạnh' },
  isPrimaryAuthor: true,
  occurredAt: '2026-10-26T02:00:00.000Z',
  content: 'Đã gọi tư vấn',
  contactChannel: 'CALL',
  contactResult: null,
  nextAction: null,
  source: 'MANUAL',
  images: [],
  attachmentIds: [],
  editedAt: null,
  canEdit: true,
};

vi.mock('@crm/api', async () => {
  const real = await vi.importActual<typeof import('@crm/api')>('@crm/api');
  return {
    ...real,
    useCustomerDetail: () => ({ data: customer, isLoading: false, isNotFound: false, error: null, refetch: vi.fn() }),
    useCareLogs: () => ({ data: [log], isLoading: false, hasMore: false, isFetchingMore: false, loadMore: vi.fn(), refetch: vi.fn() }),
    useCustomerHistories: (...args: unknown[]) => {
      useCustomerHistories(...args);
      return { data: [], isLoading: false, isError: false, error: null, isFetching: false, refetch: vi.fn() };
    },
    useCrmApi: () => ({ createPhoneView: vi.fn(), createCareLog, updateCareLog: vi.fn(), deleteCareLogAttachment: vi.fn(), removeSavedCareLogAttachment: vi.fn() }),
    useCrmActor: () => ({ userId: 'u1', role: 'STAFF', teamId: null, managedTeamIds: [] }),
    useCatalogs: () => ({ catalogs: { statuses: [], contactResults: [{ id: 'r1', label: 'Quan tâm', isActive: true, order: 1, suggestionText: '', suggestedFollowUpDays: null }] }, users: [] }),
    useNationalIdViews: () => ({ data: [] }),
  };
});

const renderScreen = () => {
  const store = createCrmStore({ initialData: createSeedDataState(FIXED_NOW), shouldPersist: false });
  return render(
    <MemoryRouter initialEntries={['/crm/customers/c1']}>
      <CrmProvider store={store}>
        <Routes>
          <Route path="/crm/customers/:customerId" element={<CustomerDetailDesktop />} />
        </Routes>
      </CrmProvider>
    </MemoryRouter>,
  );
};

beforeEach(() => {
  useCustomerHistories.mockClear();
  createCareLog.mockReset();
});

const selectTab = (name: string) => fireEvent.click(screen.getByRole('tab', { name: new RegExp(`^${name}`) }));

describe('Chi tiết khách (desktop) — PT-020/PT-022: form ghi chú chỉ hiện khi bấm nút, không mất bản nháp', () => {
  it('mặc định chưa có form: chỉ có nút "Ghi chú" (đầu hồ sơ + đầu thẻ Nhật ký chăm sóc) và danh sách nhật ký', () => {
    renderScreen();
    expect(screen.queryByRole('form')).toBeNull();
    expect(screen.getByText('Đã gọi tư vấn')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Ghi chú' })).toHaveLength(2);
  });

  it('PT-028: nút "Ghi chú" nằm trong đầu thẻ "Nhật ký chăm sóc" (cùng hàng tiêu đề), không còn khối riêng dưới thanh tab', () => {
    renderScreen();
    const card = screen.getByRole('region', { name: 'Nhật ký chăm sóc' });
    expect(within(card).getByRole('button', { name: 'Ghi chú' })).toBeInTheDocument();
    // Cả cột giữa (thanh tab + form + thẻ) chỉ có đúng 1 nút "Ghi chú", và nó nằm trong thẻ.
    const centerColumn = screen.getByRole('tablist', { name: 'Nhật ký và lịch sử' }).parentElement as HTMLElement;
    const buttons = within(centerColumn).getAllByRole('button', { name: 'Ghi chú' });
    expect(buttons).toHaveLength(1);
    expect(card).toContainElement(buttons[0]);
  });

  it('PT-028: bấm "Ghi chú" ở đầu thẻ mở form đầy đủ và nút ở đầu thẻ ẩn đi (như trước khi form thay nút); Hủy thì nút quay lại', () => {
    renderScreen();
    const card = screen.getByRole('region', { name: 'Nhật ký chăm sóc' });
    fireEvent.click(within(card).getByRole('button', { name: 'Ghi chú' }));
    expect(screen.getByRole('form', { name: 'Thêm nhật ký chăm sóc' })).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Nhật ký chăm sóc' })).queryByRole('button', { name: 'Ghi chú' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Hủy' }));
    expect(screen.queryByRole('form')).toBeNull();
    expect(within(screen.getByRole('region', { name: 'Nhật ký chăm sóc' })).getByRole('button', { name: 'Ghi chú' })).toBeInTheDocument();
  });

  it('PT-028: bấm "Sửa" một nhật ký (form sửa mở) thì nút "Ghi chú" ở đầu thẻ cũng ẩn; Hủy (chưa gõ gì) thì nút quay lại', () => {
    renderScreen();
    fireEvent.click(screen.getByRole('button', { name: /^Sửa nhật ký/ }));
    expect(screen.getByRole('form', { name: 'Sửa nhật ký chăm sóc' })).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Nhật ký chăm sóc' })).queryByRole('button', { name: 'Ghi chú' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Hủy' }));
    expect(screen.queryByRole('form')).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(within(screen.getByRole('region', { name: 'Nhật ký chăm sóc' })).getByRole('button', { name: 'Ghi chú' })).toBeInTheDocument();
  });

  it('PT-028: lưu thành công -> form đóng và nút "Ghi chú" ở đầu thẻ quay lại; lưu thất bại -> form + nháp còn, nút chưa quay lại', async () => {
    createCareLog.mockResolvedValueOnce({ ok: false, error: { code: 'INTERNAL', message: 'Lỗi' } });
    renderScreen();
    fireEvent.click(within(screen.getByRole('region', { name: 'Nhật ký chăm sóc' })).getByRole('button', { name: 'Ghi chú' }));
    fireEvent.change(screen.getByRole('textbox', { name: /Nội dung trao đổi/ }), { target: { value: 'Khách quan tâm căn góc' } });

    fireEvent.click(screen.getByRole('button', { name: 'Lưu nhật ký' }));
    await waitFor(() => expect(createCareLog).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Lưu nhật ký' })).toBeEnabled());
    expect(screen.getByRole('textbox', { name: /Nội dung trao đổi/ })).toHaveValue('Khách quan tâm căn góc');
    expect(within(screen.getByRole('region', { name: 'Nhật ký chăm sóc' })).queryByRole('button', { name: 'Ghi chú' })).toBeNull();

    createCareLog.mockResolvedValueOnce({ ok: true, data: {} });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu nhật ký' }));
    await waitFor(() => expect(screen.queryByRole('form')).toBeNull());
    expect(createCareLog).toHaveBeenCalledTimes(2);
    expect(createCareLog).toHaveBeenLastCalledWith('c1', expect.objectContaining({ content: 'Khách quan tâm căn góc' }), 'u1');
    expect(within(screen.getByRole('region', { name: 'Nhật ký chăm sóc' })).getByRole('button', { name: 'Ghi chú' })).toBeInTheDocument();
  });

  it('PT-028: sang tab "Lịch sử thay đổi" thì thẻ Nhật ký (và nút "Ghi chú" của nó) không hiện; chỉ còn nút ở đầu hồ sơ', () => {
    renderScreen();
    selectTab('Lịch sử thay đổi');
    expect(screen.queryByRole('region', { name: 'Nhật ký chăm sóc' })).toBeNull();
    expect(screen.getAllByRole('button', { name: 'Ghi chú' })).toHaveLength(1);
  });

  it('đang soạn rồi sang tab "Lịch sử thay đổi" và quay lại: form + nội dung đã gõ vẫn còn', () => {
    renderScreen();
    fireEvent.click(screen.getAllByRole('button', { name: 'Ghi chú' })[0]);
    fireEvent.change(screen.getByRole('textbox', { name: /Nội dung trao đổi/ }), { target: { value: 'Nháp chưa lưu' } });
    selectTab('Lịch sử thay đổi');
    expect(screen.queryByRole('form')).toBeNull();
    expect(screen.queryByText('Đã gọi tư vấn')).toBeNull();
    selectTab('Nhật ký chăm sóc');
    expect(screen.getByRole('textbox', { name: /Nội dung trao đổi/ })).toHaveValue('Nháp chưa lưu');
  });

  it('lịch sử thay đổi: chỉ gọi truy vấn khi người dùng bấm tab (isEnabled luôn true vì đã nằm sau tab)', () => {
    renderScreen();
    expect(useCustomerHistories).not.toHaveBeenCalled();
    selectTab('Lịch sử thay đổi');
    expect(useCustomerHistories).toHaveBeenLastCalledWith('c1', true);
  });

  it('đang soạn mà bấm "Sửa" nhật ký: hỏi lại trước khi bỏ bản nháp', () => {
    renderScreen();
    fireEvent.click(screen.getAllByRole('button', { name: 'Ghi chú' })[0]);
    fireEvent.change(screen.getByRole('textbox', { name: /Nội dung trao đổi/ }), { target: { value: 'Nháp' } });
    fireEvent.click(screen.getByRole('button', { name: /^Sửa nhật ký/ }));
    expect(screen.getByRole('dialog')).toHaveTextContent('Bỏ thay đổi chưa lưu?');
    fireEvent.click(screen.getByRole('button', { name: 'Bỏ thay đổi' }));
    expect(screen.getByRole('textbox', { name: /Nội dung trao đổi/ })).toHaveValue('Đã gọi tư vấn');
  });
});
