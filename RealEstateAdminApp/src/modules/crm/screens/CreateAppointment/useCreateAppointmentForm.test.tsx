import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter, useLocation, useNavigationType } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CrmProvider } from '@crm/store/CrmProvider';
import { createCrmStore, createSeedDataState } from '@crm/store/crmStore';
import { FIXED_NOW } from '@crm/test/fixtures';
import { CUSTOMER_PICKER_LIMIT, useCreateAppointmentForm } from './useCreateAppointmentForm';

const useCustomerList = vi.fn();
const useCustomerDetail = vi.fn();
const createAppointment = vi.fn();
const toastDefault = vi.fn();

// Toast loại "warning" đi qua `toast(content, options)`; success/error không dùng trong các ca dưới.
vi.mock('react-hot-toast', () => ({
  default: Object.assign((content: unknown, options: unknown) => toastDefault(content, options), { success: vi.fn(), error: vi.fn(), dismiss: vi.fn() }),
}));

vi.mock('@crm/api', async () => {
  const real = await vi.importActual<typeof import('@crm/api')>('@crm/api');
  return {
    ...real,
    useCrmApi: () => ({ createAppointment }),
    useCustomerDetail: (id: string | null) => useCustomerDetail(id),
    useCustomerList: (query: unknown) => useCustomerList(query),
  };
});

const CUSTOMER_ID = '6add87b88f689f6e6cd96833';
const OTHER_ID = '6add87b88f689f6e6cd96999';
const NO_DETAIL = { data: null, error: null, isLoading: false };
const detailOf = (id: string) => ({ data: { id, fullName: `Khách ${id.slice(-3)}`, careTeam: [], primaryAssignee: null }, error: null, isLoading: false });

beforeEach(() => {
  vi.useFakeTimers();
  // Cố định "bây giờ" để giờ hẹn mặc định/giờ test nhập không bị coi là quá khứ tuỳ giờ chạy.
  vi.setSystemTime(FIXED_NOW);
  useCustomerList.mockReset();
  useCustomerList.mockReturnValue({ data: { data: [], meta: { total: 120, page: 1, limit: 50, totalPages: 3 } } });
  useCustomerDetail.mockReset();
  useCustomerDetail.mockReturnValue(NO_DETAIL);
  createAppointment.mockReset();
  toastDefault.mockReset();
  // CrmProvider.goBack đọc `history.state.idx` của trình duyệt để biết còn lịch sử trong app hay không.
  window.history.replaceState(null, '');
});
afterEach(() => vi.useRealTimers());

/** Ghi lại URL hiện tại để kiểm tra điều hướng sau lưu/hủy. */
const currentUrl = { value: '', navigationType: '' };
const LocationProbe = () => {
  const { pathname, search } = useLocation();
  currentUrl.value = pathname + search;
  currentUrl.navigationType = useNavigationType();
  return null;
};

/** `previousEntries`: các mục lịch sử đứng TRƯỚC form (vd chi tiết khách đã bấm "Đặt lịch hẹn"). */
const setup = (entry = '/crm/appointments/new', previousEntries: string[] = []) => {
  const store = createCrmStore({ initialData: createSeedDataState(FIXED_NOW), shouldPersist: false });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={[...previousEntries, entry]} initialIndex={previousEntries.length}>
      <CrmProvider store={store}>
        <LocationProbe />
        {children}
      </CrmProvider>
    </MemoryRouter>
  );
  return renderHook(() => useCreateAppointmentForm(), { wrapper });
};

describe('chọn khách cho lịch hẹn: tìm qua API + debounce, mỗi lần một trang', () => {
  it('mặc định không có từ khóa, giới hạn 50 khách/lần; từ khóa chỉ gửi sau khi hết debounce', () => {
    const { result } = setup();
    expect(useCustomerList).toHaveBeenLastCalledWith(expect.objectContaining({ q: '', limit: CUSTOMER_PICKER_LIMIT, listGroup: 'ALL' }));
    expect(result.current.customerTotal).toBe(120);

    act(() => result.current.setCustomerSearch('zeta hiem'));
    expect(useCustomerList).toHaveBeenLastCalledWith(expect.objectContaining({ q: '' })); // chưa hết debounce
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(useCustomerList).toHaveBeenLastCalledWith(expect.objectContaining({ q: 'zeta hiem' }));
  });
});

describe('G5: khách mang sang từ chi tiết khách qua ?customerId=', () => {
  beforeEach(() => {
    useCustomerDetail.mockImplementation((id: string | null) => (id === CUSTOMER_ID || id === OTHER_ID ? detailOf(id) : NO_DETAIL));
  });

  it('id hợp lệ: khách được chọn sẵn ngay lần render đầu và BỊ KHÓA (changeCustomer không đổi được khách)', () => {
    const { result } = setup(`/crm/appointments/new?customerId=${CUSTOMER_ID}`);
    expect(result.current.values.customerId).toBe(CUSTOMER_ID);
    expect(result.current.selectedCustomer?.id).toBe(CUSTOMER_ID);
    expect(result.current.originCustomer?.id).toBe(CUSTOMER_ID);
    act(() => result.current.changeCustomer(OTHER_ID));
    expect(result.current.values.customerId).toBe(CUSTOMER_ID);
  });

  it('mở từ danh sách Lịch hẹn (không query): chưa chọn khách, không khóa, chọn khách tự do', () => {
    const { result } = setup();
    expect(result.current.values.customerId).toBe('');
    expect(result.current.originCustomer).toBeNull();
    act(() => result.current.changeCustomer(OTHER_ID));
    expect(result.current.values.customerId).toBe(OTHER_ID);
  });

  it('id sai định dạng: không chọn khách, không gọi API tải khách với id rác', () => {
    const { result } = setup('/crm/appointments/new?customerId=abc');
    expect(result.current.values.customerId).toBe('');
    expect(useCustomerDetail).not.toHaveBeenCalledWith('abc');
  });

  it('id đúng định dạng nhưng không tồn tại/không có quyền (404): về chưa chọn khách, báo nhẹ một lần, không còn khách gốc để quay về', () => {
    useCustomerDetail.mockImplementation((id: string | null) =>
      id === CUSTOMER_ID ? { data: null, error: { statusCode: 404, errorCode: 'RESOURCE_NOT_FOUND', message: 'x' }, isLoading: false } : NO_DETAIL,
    );
    const { result, rerender } = setup(`/crm/appointments/new?customerId=${CUSTOMER_ID}`);
    rerender();
    expect(result.current.values.customerId).toBe('');
    expect(result.current.originCustomer).toBeNull();
    expect(toastDefault).toHaveBeenCalledTimes(1);
    expect(String(toastDefault.mock.calls[0][0])).toContain('Khách không tồn tại hoặc bạn không có quyền xem');
    // Khách gốc không dùng được thì không khóa: người dùng chọn khách khác như bình thường.
    act(() => result.current.changeCustomer(OTHER_ID));
    expect(result.current.values.customerId).toBe(OTHER_ID);
  });
});

describe('G6: lưu/hủy xong về nơi bắt đầu', () => {
  const fillValidForm = (result: { current: ReturnType<typeof useCreateAppointmentForm> }) =>
    act(() => {
      result.current.setField('time', '15:00');
      result.current.setField('location', 'Văn phòng bán hàng');
    });

  beforeEach(() => {
    useCustomerDetail.mockImplementation((id: string | null) => (id ? detailOf(id) : NO_DETAIL));
    createAppointment.mockResolvedValue({ ok: true, data: {} });
  });

  it('có khách: lưu thành công về chi tiết đúng khách đó', async () => {
    const { result } = setup(`/crm/appointments/new?customerId=${CUSTOMER_ID}`);
    fillValidForm(result);
    await act(() => result.current.handleSubmit());
    expect(createAppointment).toHaveBeenCalledWith(expect.objectContaining({ customerId: CUSTOMER_ID }));
    expect(currentUrl.value).toBe(`/crm/customers/${CUSTOMER_ID}`);
  });

  it('không có khách (mở từ danh sách Lịch hẹn): lưu thành công về danh sách Lịch hẹn như cũ', async () => {
    const { result } = setup();
    act(() => result.current.changeCustomer(OTHER_ID));
    fillValidForm(result);
    await act(() => result.current.handleSubmit());
    expect(currentUrl.value).toBe('/crm/appointments');
  });

  it('lưu thất bại: ở lại form, không điều hướng', async () => {
    createAppointment.mockResolvedValue({ ok: false, error: { statusCode: 400, errorCode: 'X', message: 'Lỗi' } });
    const entry = `/crm/appointments/new?customerId=${CUSTOMER_ID}`;
    const { result } = setup(entry);
    fillValidForm(result);
    await act(() => result.current.handleSubmit());
    expect(currentUrl.value).toBe(entry);
    // Dữ liệu đã nhập còn nguyên để người dùng bấm lưu lại.
    expect(result.current.values.location).toBe('Văn phòng bán hàng');
    expect(result.current.isSubmitting).toBe(false);
  });

  it('khách gốc bị khóa: dù cố đổi sang khách khác, lịch vẫn tạo cho khách gốc và về chi tiết khách gốc', async () => {
    const { result } = setup(`/crm/appointments/new?customerId=${CUSTOMER_ID}`);
    act(() => result.current.changeCustomer(OTHER_ID));
    fillValidForm(result);
    await act(() => result.current.handleSubmit());
    expect(createAppointment).toHaveBeenCalledWith(expect.objectContaining({ customerId: CUSTOMER_ID }));
    expect(currentUrl.value).toBe(`/crm/customers/${CUSTOMER_ID}`);
  });

  it('khách gốc lỗi tạm thời -> người dùng chọn khách B -> khách gốc tự tải lại được: KHÔNG khóa lại trên B, lịch tạo cho B', async () => {
    const transientError = { data: null, error: { statusCode: 503, errorCode: 'SERVICE_UNAVAILABLE', message: 'x' }, isLoading: false };
    useCustomerDetail.mockImplementation((id: string | null) => (id === CUSTOMER_ID ? transientError : id ? detailOf(id) : NO_DETAIL));
    const { result, rerender } = setup(`/crm/appointments/new?customerId=${CUSTOMER_ID}`);
    expect(result.current.originCustomer).toBeNull(); // lỗi -> mở khóa
    act(() => result.current.changeCustomer(OTHER_ID));

    // Khách gốc hồi phục (react-query refetch thành công).
    useCustomerDetail.mockImplementation((id: string | null) => (id ? detailOf(id) : NO_DETAIL));
    rerender();
    expect(result.current.originCustomer).toBeNull();
    expect(result.current.values.customerId).toBe(OTHER_ID);

    fillValidForm(result);
    await act(() => result.current.handleSubmit());
    expect(createAppointment).toHaveBeenCalledWith(expect.objectContaining({ customerId: OTHER_ID }));
    expect(currentUrl.value).toBe('/crm/appointments'); // đã chọn khách khác khách gốc: về danh sách, không về chi tiết khách gốc
  });

  it('hủy khi mở thẳng URL (không có lịch sử trong app): thay form bằng chi tiết khách', () => {
    const { result } = setup(`/crm/appointments/new?customerId=${CUSTOMER_ID}`);
    act(() => result.current.cancel());
    expect(currentUrl.value).toBe(`/crm/customers/${CUSTOMER_ID}`);
    expect(currentUrl.navigationType).toBe('REPLACE');
  });

  it('hủy khi còn lịch sử trong app (đi từ chi tiết khách sang): lùi đúng 1 mục, không đẩy thêm mục chi tiết trùng', () => {
    window.history.replaceState({ idx: 1 }, '');
    const { result } = setup(`/crm/appointments/new?customerId=${CUSTOMER_ID}`, [`/crm/customers/${CUSTOMER_ID}`]);
    act(() => result.current.cancel());
    expect(currentUrl.value).toBe(`/crm/customers/${CUSTOMER_ID}`);
    expect(currentUrl.navigationType).toBe('POP');
  });

  it('hủy khi không có khách (mở từ danh sách Lịch hẹn): lùi về mục trước; mở thẳng URL thì về danh sách Lịch hẹn như cũ', () => {
    window.history.replaceState({ idx: 1 }, '');
    const withHistory = setup('/crm/appointments/new', ['/crm/projects']);
    act(() => withHistory.result.current.cancel());
    expect(currentUrl.value).toBe('/crm/projects');

    window.history.replaceState(null, '');
    const direct = setup();
    act(() => direct.result.current.cancel());
    expect(currentUrl.value).toBe('/crm/appointments');
  });
});
