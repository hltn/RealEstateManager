import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CareLogView, CustomerDetail } from '@crm/api';
import { CrmProvider } from '@crm/store/CrmProvider';
import { createCrmStore, createSeedDataState } from '@crm/store/crmStore';
import { FIXED_NOW } from '@crm/test/fixtures';
import { CustomerDetailMobile } from './CustomerDetail.mobile';

// Cờ ảnh BẬT để kiểm form ĐẦY ĐỦ (nội dung, kênh, kết quả, nhắc việc, ảnh).
vi.mock('@crm/config/featureFlags', () => ({
  CRM_FEATURE_FLAGS: { isAttachmentsEnabled: true, isInAppCallEnabled: false, isZaloZnsEnabled: false },
}));

// Các khối không liên quan tới PT-017..022 được giản lược để test tập trung vào luồng Ghi chú / Lịch sử / Sửa.
vi.mock('./components/UpcomingAppointmentsSection', () => ({ UpcomingAppointmentsSection: () => null }));
vi.mock('./components/PersonaCards', () => ({ PersonaCard: () => null, RealEstateNeedsCard: () => null }));
vi.mock('./components/CriteriaBoard', () => ({ CriteriaBoard: () => null }));
vi.mock('./components/CareTeamCard', () => ({ CareTeamCard: () => null }));

const useCustomerHistories = vi.fn();
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
    useCrmApi: () => ({ createPhoneView: vi.fn(), createCareLog: vi.fn(), updateCareLog: vi.fn(), deleteCareLogAttachment: vi.fn(), removeSavedCareLogAttachment: vi.fn() }),
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
          <Route path="/crm/customers/:customerId" element={<CustomerDetailMobile />} />
        </Routes>
      </CrmProvider>
    </MemoryRouter>,
  );
};

const openLogsTab = () => fireEvent.click(screen.getByRole('tab', { name: 'Nhật ký' }));

beforeEach(() => useCustomerHistories.mockClear());

describe('Chi tiết khách (mobile) — PT-017: đầu màn không hiện tên khách ở dòng breadcrumb', () => {
  it('tên khách chỉ xuất hiện 1 lần (h1 của thẻ tóm tắt); đầu màn chỉ có nhãn "Quản lý khách hàng"', () => {
    renderScreen();
    expect(screen.getAllByText(customer.fullName)).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1, name: customer.fullName })).toBeInTheDocument();
    expect(screen.getByText('Quản lý khách hàng')).toBeInTheDocument();
  });
});

describe('Chi tiết khách (mobile) — PT-018: SĐT bỏ khỏi tab Thông tin nhưng vẫn còn đường xem/gọi', () => {
  it('section "Thông tin" không có SĐT; thẻ tóm tắt còn SĐT che + "Hiện số"; thanh cố định còn Gọi điện/Nhắn Zalo', () => {
    renderScreen();
    const info = screen.getByRole('region', { name: 'Thông tin khách hàng' });
    expect(within(info).queryByText(/0912/)).toBeNull();
    const summary = screen.getByRole('region', { name: 'Tóm tắt hồ sơ' });
    expect(within(summary).getByText(/0912 ••• 678/)).toBeInTheDocument();
    expect(within(summary).getByRole('button', { name: /Hiện số/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Gọi điện' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Nhắn Zalo' })).toBeInTheDocument();
  });
});

describe('Chi tiết khách (mobile) — PT-020: form ghi chú chỉ hiện khi bấm "Ghi chú"', () => {
  it('vào tab Nhật ký: chưa có form, chỉ có nút "Ghi chú" (trong vùng Nhật ký) và danh sách nhật ký', () => {
    renderScreen();
    openLogsTab();
    expect(screen.queryByRole('form')).toBeNull();
    expect(screen.getByText('Đã gọi tư vấn')).toBeInTheDocument();
    // Có 2 nút "Ghi chú": ở thẻ tóm tắt và ở đầu tab Nhật ký.
    expect(screen.getAllByRole('button', { name: 'Ghi chú' })).toHaveLength(2);
  });

  it('bấm "Ghi chú" trong tab Nhật ký: hiện form ĐẦY ĐỦ (nội dung, kênh, kết quả, nhắc việc, ảnh) và nút Ghi chú trong tab biến mất', () => {
    renderScreen();
    openLogsTab();
    const logsTabButton = screen.getAllByRole('button', { name: 'Ghi chú' })[1];
    fireEvent.click(logsTabButton);
    const form = screen.getByRole('form', { name: 'Thêm nhật ký chăm sóc' });
    expect(within(form).getByRole('textbox', { name: /Nội dung trao đổi/ })).toBeVisible();
    expect(within(form).getByRole('combobox', { name: 'Kênh liên hệ' })).toBeVisible();
    expect(within(form).getByRole('combobox', { name: 'Kết quả liên hệ' })).toBeVisible();
    expect(within(form).getByRole('group', { name: 'Nhắc việc tiếp theo' })).toBeVisible();
    expect(within(form).getByText('Thêm ảnh')).toBeVisible();
    expect(screen.getAllByRole('button', { name: 'Ghi chú' })).toHaveLength(1);
  });

  it('bấm "Ghi chú" ở thẻ tóm tắt khi đang ở tab Thông tin: tự sang tab Nhật ký và mở form đầy đủ (không mở hộp rút gọn)', () => {
    renderScreen();
    expect(screen.getByRole('tab', { name: 'Thông tin' })).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Ghi chú' }));
    expect(screen.getByRole('tab', { name: 'Nhật ký' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('form', { name: 'Thêm nhật ký chăm sóc' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('Hủy: form đóng lại, nút "Ghi chú" quay về', () => {
    renderScreen();
    fireEvent.click(screen.getByRole('button', { name: 'Ghi chú' }));
    fireEvent.click(screen.getByRole('button', { name: 'Hủy' }));
    expect(screen.queryByRole('form')).toBeNull();
    expect(screen.getAllByRole('button', { name: 'Ghi chú' })).toHaveLength(2);
  });
});

describe('Chi tiết khách (mobile) — PT-021: Lịch sử thay đổi thu gọn, chỉ tải khi mở', () => {
  it('mặc định thu gọn, truy vấn lịch sử luôn bị tắt (enabled = false) cho tới khi mở', () => {
    renderScreen();
    openLogsTab();
    const toggle = screen.getByRole('button', { name: /Lịch sử thay đổi/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(useCustomerHistories).toHaveBeenCalled();
    expect(useCustomerHistories.mock.calls.every((call) => call[1] === false)).toBe(true);
  });

  it('bấm mở: truy vấn được bật (enabled = true); đóng lại: tắt lại (dữ liệu giữ ở cache của React Query)', () => {
    renderScreen();
    openLogsTab();
    const toggle = screen.getByRole('button', { name: /Lịch sử thay đổi/ });
    fireEvent.click(toggle);
    expect(useCustomerHistories).toHaveBeenLastCalledWith('c1', true);
    fireEvent.click(toggle);
    expect(useCustomerHistories).toHaveBeenLastCalledWith('c1', false);
  });
});

describe('Chi tiết khách (mobile) — PT-022: nút Sửa nhật ký', () => {
  it('canEdit = true: có nút Sửa; bấm mở form sửa điền sẵn nội dung cũ; Hủy đóng form', () => {
    renderScreen();
    openLogsTab();
    fireEvent.click(screen.getByRole('button', { name: /^Sửa nhật ký/ }));
    const form = screen.getByRole('form', { name: 'Sửa nhật ký chăm sóc' });
    expect(within(form).getByRole('textbox', { name: /Nội dung trao đổi/ })).toHaveValue('Đã gọi tư vấn');
    expect(within(form).getByRole('button', { name: 'Lưu thay đổi' })).toBeInTheDocument();
    fireEvent.click(within(form).getByRole('button', { name: 'Hủy' }));
    expect(screen.queryByRole('form')).toBeNull();
  });
});

describe('Chi tiết khách (mobile) — PT-020/PT-022: không mất bản nháp âm thầm', () => {
  const typeDraft = (text: string) => fireEvent.change(screen.getByRole('textbox', { name: /Nội dung trao đổi/ }), { target: { value: text } });

  it('đang soạn rồi đổi sang tab Thông tin/Tiến độ và quay lại: form + nội dung đã gõ vẫn còn', () => {
    renderScreen();
    fireEvent.click(screen.getByRole('button', { name: 'Ghi chú' }));
    typeDraft('Khách hẹn xem nhà thứ bảy');
    fireEvent.click(screen.getByRole('tab', { name: 'Thông tin' }));
    expect(screen.queryByRole('form')).toBeNull(); // ẩn khỏi tab khác (không chiếm chỗ, không có trong cây truy cập)
    fireEvent.click(screen.getByRole('tab', { name: 'Tiến độ' }));
    openLogsTab();
    expect(screen.getByRole('textbox', { name: /Nội dung trao đổi/ })).toHaveValue('Khách hẹn xem nhà thứ bảy');
  });

  it('đang soạn (có nội dung) mà bấm "Sửa" nhật ký: hỏi lại, KHÔNG đổi form; "Tiếp tục nhập" giữ nguyên bản nháp', () => {
    renderScreen();
    openLogsTab();
    fireEvent.click(screen.getAllByRole('button', { name: 'Ghi chú' })[1]);
    typeDraft('Bản nháp quan trọng');
    fireEvent.click(screen.getByRole('button', { name: /^Sửa nhật ký/ }));
    expect(screen.getByRole('dialog')).toHaveTextContent('Bỏ thay đổi chưa lưu?');
    expect(screen.queryByRole('form', { name: 'Sửa nhật ký chăm sóc' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Tiếp tục nhập' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('textbox', { name: /Nội dung trao đổi/ })).toHaveValue('Bản nháp quan trọng');
  });

  it('đang soạn rồi xác nhận "Bỏ thay đổi": sang form sửa nhật ký với dữ liệu cũ', () => {
    renderScreen();
    openLogsTab();
    fireEvent.click(screen.getAllByRole('button', { name: 'Ghi chú' })[1]);
    typeDraft('Bản nháp sẽ bị bỏ');
    fireEvent.click(screen.getByRole('button', { name: /^Sửa nhật ký/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Bỏ thay đổi' }));
    const form = screen.getByRole('form', { name: 'Sửa nhật ký chăm sóc' });
    expect(within(form).getByRole('textbox', { name: /Nội dung trao đổi/ })).toHaveValue('Đã gọi tư vấn');
  });

  it('form mới mở, chưa gõ gì: bấm "Sửa" chuyển thẳng, không hỏi', () => {
    renderScreen();
    openLogsTab();
    fireEvent.click(screen.getAllByRole('button', { name: 'Ghi chú' })[1]);
    fireEvent.click(screen.getByRole('button', { name: /^Sửa nhật ký/ }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('form', { name: 'Sửa nhật ký chăm sóc' })).toBeInTheDocument();
  });

  it('có bản nháp mà bấm Hủy: hỏi lại; xác nhận thì đóng form, từ chối thì giữ nội dung', () => {
    renderScreen();
    fireEvent.click(screen.getByRole('button', { name: 'Ghi chú' }));
    typeDraft('Chưa lưu');
    fireEvent.click(screen.getByRole('button', { name: 'Hủy' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Tiếp tục nhập' }));
    expect(screen.getByRole('textbox', { name: /Nội dung trao đổi/ })).toHaveValue('Chưa lưu');
    fireEvent.click(screen.getByRole('button', { name: 'Hủy' }));
    fireEvent.click(screen.getByRole('button', { name: 'Bỏ thay đổi' }));
    expect(screen.queryByRole('form')).toBeNull();
  });

  it('đang sửa nhật ký mà bấm "Ghi chú" ở thẻ tóm tắt khi đã đổi nội dung: hỏi lại thay vì mất thay đổi', () => {
    renderScreen();
    openLogsTab();
    fireEvent.click(screen.getByRole('button', { name: /^Sửa nhật ký/ }));
    typeDraft('Đã sửa nội dung nhật ký');
    fireEvent.click(screen.getAllByRole('button', { name: 'Ghi chú' })[0]);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('form', { name: 'Sửa nhật ký chăm sóc' })).toBeInTheDocument();
  });
});
