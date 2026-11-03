import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
const getFooter = () => screen.getByRole('contentinfo', { name: 'Thao tác nhanh với khách' });
/** Nút "Ghi chú" ở thẻ tóm tắt đầu hồ sơ. */
const getHeaderNoteButton = () => within(screen.getByRole('region', { name: 'Tóm tắt hồ sơ' })).getByRole('button', { name: 'Ghi chú' });
/** Nút "Ghi chú" ở thanh cố định đáy màn (PT-028). */
const getFooterNoteButton = () => within(getFooter()).getByRole('button', { name: 'Ghi chú' });

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
  it('section "Thông tin" không có SĐT; thẻ tóm tắt còn SĐT che + "Hiện số"; thanh cố định còn Ghi chú/Gọi điện/Nhắn Zalo', () => {
    renderScreen();
    const info = screen.getByRole('region', { name: 'Thông tin khách hàng' });
    expect(within(info).queryByText(/0912/)).toBeNull();
    const summary = screen.getByRole('region', { name: 'Tóm tắt hồ sơ' });
    expect(within(summary).getByText(/0912 ••• 678/)).toBeInTheDocument();
    expect(within(summary).getByRole('button', { name: /Hiện số/ })).toBeInTheDocument();
    expect(within(getFooter()).getByRole('button', { name: 'Gọi điện' })).toBeInTheDocument();
    expect(within(getFooter()).getByRole('button', { name: 'Nhắn Zalo' })).toBeInTheDocument();
  });
});

describe('Chi tiết khách (mobile) — PT-028: nút "Ghi chú" nằm ở thanh đáy, hiện ở mọi tab', () => {
  it('thanh đáy có đúng 3 nút theo thứ tự Ghi chú, Gọi điện, Nhắn Zalo', () => {
    renderScreen();
    const labels = within(getFooter()).getAllByRole('button').map((button) => button.textContent?.trim());
    expect(labels).toEqual(['Ghi chú', 'Gọi điện', 'Nhắn Zalo']);
  });

  it.each(['Thông tin', 'Nhật ký', 'Tiến độ'])('tab %s: thanh đáy vẫn có nút "Ghi chú"', (tabName) => {
    renderScreen();
    fireEvent.click(screen.getByRole('tab', { name: tabName }));
    expect(getFooterNoteButton()).toBeInTheDocument();
  });

  it.each(['Thông tin', 'Tiến độ'])('đang ở tab %s: bấm "Ghi chú" ở thanh đáy -> sang tab Nhật ký và mở form đầy đủ (như nút ở thẻ đầu hồ sơ)', (tabName) => {
    renderScreen();
    fireEvent.click(screen.getByRole('tab', { name: tabName }));
    fireEvent.click(getFooterNoteButton());
    expect(screen.getByRole('tab', { name: 'Nhật ký' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('form', { name: 'Thêm nhật ký chăm sóc' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('tab Nhật ký không còn nút "Ghi chú" riêng dưới thanh tab: chỉ còn 2 nút (thẻ đầu hồ sơ + thanh đáy), form chưa mở', () => {
    renderScreen();
    openLogsTab();
    expect(screen.getAllByRole('button', { name: 'Ghi chú' })).toHaveLength(2);
    expect(screen.queryByRole('form')).toBeNull();
  });

  it('form đang mở: thanh đáy vẫn còn đủ 3 nút; nội dung chừa đáy 6rem + safe-area (home indicator) để cuộn tới cuối form không bị che', () => {
    renderScreen();
    fireEvent.click(getFooterNoteButton());
    expect(screen.getByRole('form', { name: 'Thêm nhật ký chăm sóc' })).toBeInTheDocument();
    expect(within(getFooter()).getAllByRole('button')).toHaveLength(3);
    expect(screen.getByTestId('customer-detail-mobile')).toHaveClass('pb-[calc(6rem+env(safe-area-inset-bottom))]');
  });

  describe('bấm "Ghi chú" khi form thêm mới ĐÃ mở sẵn: cuộn + focus lại form, không mất nháp', () => {
    const scrollIntoView = vi.fn();
    const typeDraft = (text: string) => fireEvent.change(screen.getByRole('textbox', { name: /Nội dung trao đổi/ }), { target: { value: text } });

    beforeEach(() => {
      scrollIntoView.mockClear();
      // jsdom không có scrollIntoView: gắn hàm giả để đếm số lần form được đưa vào vùng nhìn thấy.
      Element.prototype.scrollIntoView = scrollIntoView;
    });
    afterEach(() => {
      delete (Element.prototype as Partial<Element>).scrollIntoView;
    });

    it('mở lần đầu: form cuộn + focus đúng 1 lần (không bị gọi đôi)', () => {
      renderScreen();
      fireEvent.click(getFooterNoteButton());
      expect(scrollIntoView).toHaveBeenCalledTimes(1);
      expect(scrollIntoView.mock.contexts[0]).toBe(screen.getByRole('form', { name: 'Thêm nhật ký chăm sóc' }));
      expect(screen.getByRole('textbox', { name: /Nội dung trao đổi/ })).toHaveFocus();
    });

    it('nháp đang ẩn ở tab Thông tin: bấm Ghi chú ở thanh đáy -> sang tab Nhật ký, form cuộn + focus lại, nháp còn nguyên', () => {
      renderScreen();
      fireEvent.click(getFooterNoteButton());
      typeDraft('Khách hẹn xem nhà thứ bảy');
      fireEvent.click(screen.getByRole('tab', { name: 'Thông tin' }));
      expect(screen.queryByRole('form')).toBeNull();
      scrollIntoView.mockClear();

      fireEvent.click(getFooterNoteButton());

      expect(screen.getByRole('tab', { name: 'Nhật ký' })).toHaveAttribute('aria-selected', 'true');
      expect(scrollIntoView).toHaveBeenCalledTimes(1);
      expect(scrollIntoView.mock.contexts[0]).toBe(screen.getByRole('form', { name: 'Thêm nhật ký chăm sóc' }));
      const textbox = screen.getByRole('textbox', { name: /Nội dung trao đổi/ });
      expect(textbox).toHaveFocus();
      expect(textbox).toHaveValue('Khách hẹn xem nhà thứ bảy');
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('đang ở tab Nhật ký, form mở và focus đã rời ô nhập: bấm Ghi chú ở thanh đáy đưa focus về ô nội dung, nháp còn nguyên', () => {
      renderScreen();
      openLogsTab();
      fireEvent.click(getFooterNoteButton());
      typeDraft('Nháp đang gõ');
      getFooterNoteButton().focus();
      scrollIntoView.mockClear();

      fireEvent.click(getFooterNoteButton());

      expect(scrollIntoView).toHaveBeenCalledTimes(1);
      expect(screen.getByRole('textbox', { name: /Nội dung trao đổi/ })).toHaveFocus();
      expect(screen.getByRole('textbox', { name: /Nội dung trao đổi/ })).toHaveValue('Nháp đang gõ');
    });

    it('đang SỬA nhật ký có thay đổi: bấm Ghi chú ở thanh đáy chỉ hỏi lại (không cuộn/focus phía sau hộp xác nhận)', () => {
      renderScreen();
      openLogsTab();
      fireEvent.click(screen.getByRole('button', { name: /^Sửa nhật ký/ }));
      typeDraft('Đã sửa nội dung nhật ký');
      scrollIntoView.mockClear();

      fireEvent.click(getFooterNoteButton());

      expect(screen.getByRole('dialog')).toHaveTextContent('Bỏ thay đổi chưa lưu?');
      expect(scrollIntoView).not.toHaveBeenCalled();
    });
  });

  it('đang soạn có nội dung rồi bấm "Ghi chú" ở thanh đáy lần nữa: giữ nguyên bản nháp (không reset form)', () => {
    renderScreen();
    fireEvent.click(getFooterNoteButton());
    fireEvent.change(screen.getByRole('textbox', { name: /Nội dung trao đổi/ }), { target: { value: 'Bản nháp đang gõ' } });
    fireEvent.click(getFooterNoteButton());
    expect(screen.getByRole('textbox', { name: /Nội dung trao đổi/ })).toHaveValue('Bản nháp đang gõ');
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('Chi tiết khách (mobile) — PT-028: bấm "Ghi chú" ở thanh đáy khi bản nháp đã có ở tab khác', () => {
  it('soạn dở, sang tab Thông tin rồi bấm "Ghi chú" ở thanh đáy: về tab Nhật ký, bản nháp còn nguyên, không hỏi lại', () => {
    renderScreen();
    fireEvent.click(getFooterNoteButton());
    fireEvent.change(screen.getByRole('textbox', { name: /Nội dung trao đổi/ }), { target: { value: 'Nháp giữ qua tab' } });
    fireEvent.click(screen.getByRole('tab', { name: 'Thông tin' }));
    expect(screen.queryByRole('form')).toBeNull();
    fireEvent.click(getFooterNoteButton());
    expect(screen.getByRole('tab', { name: 'Nhật ký' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('textbox', { name: /Nội dung trao đổi/ })).toHaveValue('Nháp giữ qua tab');
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('Chi tiết khách (mobile) — PT-020: form ghi chú chỉ hiện khi bấm "Ghi chú"', () => {
  it('vào tab Nhật ký: chưa có form và danh sách nhật ký hiện ra; nút "Ghi chú" chỉ ở thẻ tóm tắt + thanh đáy (PT-028)', () => {
    renderScreen();
    openLogsTab();
    expect(screen.queryByRole('form')).toBeNull();
    expect(screen.getByText('Đã gọi tư vấn')).toBeInTheDocument();
    expect(getHeaderNoteButton()).toBeInTheDocument();
    expect(getFooterNoteButton()).toBeInTheDocument();
  });

  it('bấm "Ghi chú" ở thanh đáy khi đang ở tab Nhật ký: hiện form ĐẦY ĐỦ (nội dung, kênh, kết quả, nhắc việc, ảnh)', () => {
    renderScreen();
    openLogsTab();
    fireEvent.click(getFooterNoteButton());
    const form = screen.getByRole('form', { name: 'Thêm nhật ký chăm sóc' });
    expect(within(form).getByRole('textbox', { name: /Nội dung trao đổi/ })).toBeVisible();
    expect(within(form).getByRole('combobox', { name: 'Kênh liên hệ' })).toBeVisible();
    expect(within(form).getByRole('combobox', { name: 'Kết quả liên hệ' })).toBeVisible();
    expect(within(form).getByRole('group', { name: 'Nhắc việc tiếp theo' })).toBeVisible();
    expect(within(form).getByText('Thêm ảnh')).toBeVisible();
    // Thẻ tóm tắt + thanh đáy vẫn giữ nút "Ghi chú" (nút riêng trong tab Nhật ký không còn).
    expect(screen.getAllByRole('button', { name: 'Ghi chú' })).toHaveLength(2);
  });

  it('bấm "Ghi chú" ở thẻ tóm tắt khi đang ở tab Thông tin: tự sang tab Nhật ký và mở form đầy đủ (không mở hộp rút gọn)', () => {
    renderScreen();
    expect(screen.getByRole('tab', { name: 'Thông tin' })).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(getHeaderNoteButton());
    expect(screen.getByRole('tab', { name: 'Nhật ký' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('form', { name: 'Thêm nhật ký chăm sóc' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('Hủy: form đóng lại, không còn form nào và nút "Ghi chú" ở thanh đáy vẫn dùng được để mở lại', () => {
    renderScreen();
    fireEvent.click(getHeaderNoteButton());
    fireEvent.click(screen.getByRole('button', { name: 'Hủy' }));
    expect(screen.queryByRole('form')).toBeNull();
    fireEvent.click(getFooterNoteButton());
    expect(screen.getByRole('form', { name: 'Thêm nhật ký chăm sóc' })).toBeInTheDocument();
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
    fireEvent.click(getHeaderNoteButton());
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
    fireEvent.click(getFooterNoteButton());
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
    fireEvent.click(getFooterNoteButton());
    typeDraft('Bản nháp sẽ bị bỏ');
    fireEvent.click(screen.getByRole('button', { name: /^Sửa nhật ký/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Bỏ thay đổi' }));
    const form = screen.getByRole('form', { name: 'Sửa nhật ký chăm sóc' });
    expect(within(form).getByRole('textbox', { name: /Nội dung trao đổi/ })).toHaveValue('Đã gọi tư vấn');
  });

  it('form mới mở, chưa gõ gì: bấm "Sửa" chuyển thẳng, không hỏi', () => {
    renderScreen();
    openLogsTab();
    fireEvent.click(getFooterNoteButton());
    fireEvent.click(screen.getByRole('button', { name: /^Sửa nhật ký/ }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('form', { name: 'Sửa nhật ký chăm sóc' })).toBeInTheDocument();
  });

  it('có bản nháp mà bấm Hủy: hỏi lại; xác nhận thì đóng form, từ chối thì giữ nội dung', () => {
    renderScreen();
    fireEvent.click(getHeaderNoteButton());
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
    fireEvent.click(getHeaderNoteButton());
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('form', { name: 'Sửa nhật ký chăm sóc' })).toBeInTheDocument();
  });
});
