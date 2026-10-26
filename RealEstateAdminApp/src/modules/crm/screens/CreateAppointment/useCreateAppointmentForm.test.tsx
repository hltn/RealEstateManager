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
// Danh mục dự án do ca test đặt (useCatalogs thật cần QueryClient).
const catalogProjects = vi.hoisted(() => ({ current: [] as { id: string; name: string; isActive: boolean; deletedAt: string | null }[] }));

// Toast loại "warning" đi qua `toast(content, options)`; success/error không dùng trong các ca dưới.
vi.mock('react-hot-toast', () => ({
  default: Object.assign((content: unknown, options: unknown) => toastDefault(content, options), { success: vi.fn(), error: vi.fn(), dismiss: vi.fn() }),
}));

vi.mock('@crm/api', async () => {
  const real = await vi.importActual<typeof import('@crm/api')>('@crm/api');
  return {
    ...real,
    useCrmApi: () => ({ createAppointment }),
    useCatalogs: () => ({ catalogs: { projects: catalogProjects.current } }),
    useCustomerDetail: (id: string | null) => useCustomerDetail(id),
    useCustomerList: (query: unknown) => useCustomerList(query),
  };
});

const CUSTOMER_ID = '6add87b88f689f6e6cd96833';
const OTHER_ID = '6add87b88f689f6e6cd96999';
const NO_DETAIL = { data: null, error: null, isLoading: false };
const detailOf = (id: string, interestedProjectIds: string[] = []) => ({
  data: { id, fullName: `Khách ${id.slice(-3)}`, careTeam: [], primaryAssignee: null, projects: interestedProjectIds.map((projectId) => ({ id: projectId, label: projectId })) },
  error: null,
  isLoading: false,
});

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
  catalogProjects.current = [];
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

  it('id sai định dạng: không chọn khách, không gọi API tải khách với id rác, báo nhẹ đúng một lần', () => {
    const { result, rerender } = setup('/crm/appointments/new?customerId=abc');
    rerender();
    expect(result.current.values.customerId).toBe('');
    expect(useCustomerDetail).not.toHaveBeenCalledWith('abc');
    expect(toastDefault).toHaveBeenCalledTimes(1);
    expect(String(toastDefault.mock.calls[0][0])).toContain('Mã khách trên đường dẫn không hợp lệ');
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

  it('hủy khi form đã gõ dở: hỏi xác nhận (chưa rời form); "Tiếp tục nhập" ở lại, "Bỏ thay đổi" mới rời đi', () => {
    const { result } = setup(`/crm/appointments/new?customerId=${CUSTOMER_ID}`);
    act(() => result.current.setField('location', 'Gõ dở'));
    act(() => result.current.cancel());
    expect(result.current.isConfirmingDiscard).toBe(true);
    expect(currentUrl.value).toContain('/crm/appointments/new');

    act(() => result.current.keepEditing());
    expect(result.current.isConfirmingDiscard).toBe(false);
    expect(result.current.values.location).toBe('Gõ dở');

    act(() => result.current.cancel());
    act(() => result.current.confirmDiscard());
    expect(currentUrl.value).toBe(`/crm/customers/${CUSTOMER_ID}`);
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

describe('G7: dự án của lịch', () => {
  const PROJECT_A = '6add87b88f689f6e6cd96aa1';
  const PROJECT_B = '6add87b88f689f6e6cd96aa2';
  const PROJECT_OFF = '6add87b88f689f6e6cd96aa3';
  const project = (id: string, isActive = true) => ({ id, name: `Dự án ${id.slice(-1)}`, isActive, deletedAt: null });

  const fillValidForm = (result: { current: ReturnType<typeof useCreateAppointmentForm> }) =>
    act(() => {
      result.current.setField('time', '15:00');
      result.current.setField('location', 'Văn phòng bán hàng');
    });

  beforeEach(() => {
    catalogProjects.current = [project(PROJECT_A), project(PROJECT_B), project(PROJECT_OFF, false)];
    createAppointment.mockResolvedValue({ ok: true, data: {} });
  });

  it('khách quan tâm đúng MỘT dự án: chọn sẵn dự án đó (khách gốc từ chi tiết khách)', () => {
    useCustomerDetail.mockImplementation((id: string | null) => (id ? detailOf(id, [PROJECT_A]) : NO_DETAIL));
    const { result } = setup(`/crm/appointments/new?customerId=${CUSTOMER_ID}`);
    expect(result.current.values.projectId).toBe(PROJECT_A);
  });

  it('khách quan tâm NHIỀU dự án hoặc chỉ dự án đã ngừng: không tự chọn', () => {
    useCustomerDetail.mockImplementation((id: string | null) => (id ? detailOf(id, [PROJECT_A, PROJECT_B]) : NO_DETAIL));
    expect(setup(`/crm/appointments/new?customerId=${CUSTOMER_ID}`).result.current.values.projectId).toBe('');

    useCustomerDetail.mockImplementation((id: string | null) => (id ? detailOf(id, [PROJECT_OFF]) : NO_DETAIL));
    expect(setup(`/crm/appointments/new?customerId=${CUSTOMER_ID}`).result.current.values.projectId).toBe('');
  });

  it('chọn khách bằng picker (mở từ Lịch hẹn): gợi ý theo khách vừa chọn, đổi sang khách nhiều dự án thì bỏ gợi ý', () => {
    useCustomerDetail.mockImplementation((id: string | null) => {
      if (id === CUSTOMER_ID) return detailOf(id, [PROJECT_A]);
      if (id === OTHER_ID) return detailOf(id, [PROJECT_A, PROJECT_B]);
      return NO_DETAIL;
    });
    const { result } = setup();
    expect(result.current.values.projectId).toBe('');
    act(() => result.current.changeCustomer(CUSTOMER_ID));
    expect(result.current.values.projectId).toBe(PROJECT_A);
    act(() => result.current.changeCustomer(OTHER_ID));
    expect(result.current.values.projectId).toBe('');
  });

  it('KHÔNG ghi đè lựa chọn tay: đổi khách/loại lịch vẫn giữ dự án đã chọn, kể cả "Không chọn"', () => {
    useCustomerDetail.mockImplementation((id: string | null) => (id ? detailOf(id, [PROJECT_A]) : NO_DETAIL));
    const { result } = setup();
    act(() => result.current.changeCustomer(CUSTOMER_ID)); // gợi ý A
    act(() => result.current.setField('projectId', PROJECT_B));
    act(() => result.current.changeCustomer(OTHER_ID));
    act(() => result.current.setField('type', 'MEETING'));
    expect(result.current.values.projectId).toBe(PROJECT_B);

    act(() => result.current.setField('projectId', ''));
    act(() => result.current.changeCustomer(CUSTOMER_ID));
    expect(result.current.values.projectId).toBe(''); // chủ động "Không chọn" thì không gợi ý lại
  });

  it('?projectId= từ màn Dự án: chọn sẵn dự án, khách chưa chọn (không khóa), loại mặc định Xem nhà mẫu; thắng gợi ý theo khách', () => {
    useCustomerDetail.mockImplementation((id: string | null) => (id ? detailOf(id, [PROJECT_A]) : NO_DETAIL));
    const { result } = setup(`/crm/appointments/new?projectId=${PROJECT_B}`);
    expect(result.current.values.projectId).toBe(PROJECT_B);
    expect(result.current.values.customerId).toBe('');
    expect(result.current.originCustomer).toBeNull();
    expect(result.current.values.type).toBe('SITE_VISIT');
    act(() => result.current.changeCustomer(CUSTOMER_ID)); // khách quan tâm A nhưng dự án mang sang B vẫn giữ
    expect(result.current.values.projectId).toBe(PROJECT_B);
  });

  it('?projectId= sai định dạng, không tồn tại hoặc đã ngừng: bỏ qua, không crash', () => {
    for (const bad of ['abc', '6add87b88f689f6e6cd96000', PROJECT_OFF]) {
      const { result } = setup(`/crm/appointments/new?projectId=${bad}`);
      expect(result.current.values.projectId).toBe('');
    }
  });

  it('kết hợp ?customerId=&projectId=: khách khóa + dự án chọn sẵn', () => {
    useCustomerDetail.mockImplementation((id: string | null) => (id ? detailOf(id) : NO_DETAIL));
    const { result } = setup(`/crm/appointments/new?customerId=${CUSTOMER_ID}&projectId=${PROJECT_A}`);
    expect(result.current.originCustomer?.id).toBe(CUSTOMER_ID);
    expect(result.current.values.projectId).toBe(PROJECT_A);
  });

  it('payload: gửi projectId đã chọn; "Không chọn" gửi null', async () => {
    useCustomerDetail.mockImplementation((id: string | null) => (id ? detailOf(id) : NO_DETAIL));
    const withProject = setup(`/crm/appointments/new?customerId=${CUSTOMER_ID}&projectId=${PROJECT_A}`);
    fillValidForm(withProject.result);
    await act(() => withProject.result.current.handleSubmit());
    expect(createAppointment).toHaveBeenLastCalledWith(expect.objectContaining({ projectId: PROJECT_A }));

    const withoutProject = setup(`/crm/appointments/new?customerId=${CUSTOMER_ID}`);
    fillValidForm(withoutProject.result);
    await act(() => withoutProject.result.current.handleSubmit());
    expect(createAppointment).toHaveBeenLastCalledWith(expect.objectContaining({ projectId: null }));
  });

  it('lỗi 400 của trường projectId: hiện cạnh ô dự án (không toast), ở lại form, gỡ lỗi khi đổi dự án', async () => {
    useCustomerDetail.mockImplementation((id: string | null) => (id ? detailOf(id) : NO_DETAIL));
    createAppointment.mockResolvedValue({ ok: false, error: { statusCode: 400, errorCode: 'VALIDATION_FAILED', message: 'Dự án không tồn tại hoặc đã ngừng hoạt động', details: { field: 'projectId' } } });
    const entry = `/crm/appointments/new?customerId=${CUSTOMER_ID}&projectId=${PROJECT_A}`;
    const { result } = setup(entry);
    fillValidForm(result);
    await act(() => result.current.handleSubmit());
    expect(result.current.errors.projectId).toBe('Dự án không tồn tại hoặc đã ngừng hoạt động');
    expect(toastDefault).not.toHaveBeenCalled();
    expect(currentUrl.value).toBe(entry);
    act(() => result.current.setField('projectId', PROJECT_B));
    expect(result.current.errors.projectId).toBeUndefined();
  });

  it('lỗi dự án của máy chủ tự hết khi dự án đổi do gợi ý (đổi khách), không cần sửa tay ô dự án', async () => {
    useCustomerDetail.mockImplementation((id: string | null) => {
      if (id === CUSTOMER_ID) return detailOf(id, [PROJECT_A]);
      if (id === OTHER_ID) return detailOf(id, [PROJECT_B]);
      return NO_DETAIL;
    });
    createAppointment.mockResolvedValue({ ok: false, error: { statusCode: 400, errorCode: 'VALIDATION_FAILED', message: 'Dự án không tồn tại hoặc đã ngừng hoạt động', details: { field: 'projectId' } } });
    const { result } = setup();
    act(() => result.current.changeCustomer(CUSTOMER_ID));
    fillValidForm(result);
    await act(() => result.current.handleSubmit());
    expect(result.current.errors.projectId).toBeDefined();
    act(() => result.current.changeCustomer(OTHER_ID));
    expect(result.current.values.projectId).toBe(PROJECT_B);
    expect(result.current.errors.projectId).toBeUndefined();
  });
});
