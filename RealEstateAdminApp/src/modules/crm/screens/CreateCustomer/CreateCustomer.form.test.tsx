/** Form Thêm khách (desktop + mobile): chỉ họ tên bắt buộc, dòng PRIMARY tự động, không banner trùng SĐT, điều hướng sau lưu. */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '../../../../stores/auth.store';
import type { CrmCatalogs } from '@crm/types/crm';
import { CreateCustomerDesktop } from './CreateCustomer.desktop';
import { CreateCustomerMobile } from './CreateCustomer.mobile';

const createCustomer = vi.fn();
const showToast = vi.fn();
const selectCustomer = vi.fn();
const goBack = vi.fn();

const catalogs = {
  statuses: [{ id: 'NOT_CONTACTED', code: 'NOT_CONTACTED', label: 'Chưa tiếp cận', listGroup: 'NOT_CONTACTED', tone: 'gray', order: 1, isActive: true, isDefault: true }],
  leadSources: [],
  areas: [],
  projects: [],
  tags: [],
  contactResults: [],
} as unknown as CrmCatalogs;

vi.mock('@crm/api', async () => {
  const real = await vi.importActual<typeof import('@crm/api')>('@crm/api');
  return { ...real, useCrmApi: () => ({ createCustomer }), useCatalogs: () => ({ catalogs }) };
});
vi.mock('@crm/store', async () => {
  const real = await vi.importActual<typeof import('@crm/store')>('@crm/store');
  return { ...real, useCrmActions: () => ({ goBack, selectCustomer, showToast }) };
});

const signIn = (role: string) =>
  useAuthStore.setState({ accessToken: 't', user: { _id: 'u1', email: 'a@b.vn', displayName: 'An', role, roles: [role] } as never, isInitialized: true });

beforeEach(() => {
  createCustomer.mockReset();
  showToast.mockReset();
  selectCustomer.mockReset();
  goBack.mockReset();
  createCustomer.mockResolvedValue({ ok: true, data: { id: 'c-new', fullName: 'Nguyễn Văn An' } });
});
afterEach(() => useAuthStore.setState({ accessToken: null, user: null, isInitialized: true }));

const VARIANTS = [
  { name: 'desktop', Screen: CreateCustomerDesktop },
  { name: 'mobile', Screen: CreateCustomerMobile },
] as const;

describe.each(VARIANTS)('form Thêm khách $name', ({ Screen }) => {
  const renderScreen = () =>
    render(
      <MemoryRouter>
        <Screen />
      </MemoryRouter>,
    );

  it('SĐT không đánh dấu bắt buộc (không dấu *); họ tên vẫn bắt buộc', () => {
    renderScreen();
    expect(screen.getByLabelText(/Số điện thoại/)).not.toBeRequired();
    expect(screen.queryByText(/Bắt buộc: họ tên, SĐT/)).not.toBeInTheDocument();
    expect(screen.getByText('Số điện thoại').parentElement?.textContent).not.toContain('*');
    expect(screen.getByText('Họ và tên khách hàng').parentElement?.textContent).toContain('*');
  });

  it('chỉ nhập họ tên rồi lưu -> thành công: payload phone null, KHÔNG có careTeam, điều hướng sang chi tiết (replace)', async () => {
    renderScreen();
    fireEvent.change(screen.getByLabelText(/Họ và tên khách hàng/), { target: { value: '  Nguyễn Văn An ' } });
    fireEvent.click(screen.getByRole('button', { name: /Lưu khách hàng/ }));

    await waitFor(() => expect(createCustomer).toHaveBeenCalledTimes(1));
    const payload = createCustomer.mock.calls[0][0];
    expect(payload.fullName).toBe('Nguyễn Văn An');
    expect(payload.phone).toBeNull();
    expect(Object.keys(payload)).not.toContain('careTeam');
    await waitFor(() => expect(selectCustomer).toHaveBeenCalledWith('c-new', { shouldReplace: true }));
    expect(showToast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Thêm khách hàng thành công' }));
  });

  it('để trống họ tên -> không gọi API, báo lỗi họ tên (không lỗi SĐT)', async () => {
    renderScreen();
    fireEvent.click(screen.getByRole('button', { name: /Lưu khách hàng/ }));
    await waitFor(() => expect(showToast).toHaveBeenCalledWith(expect.objectContaining({ type: 'error', message: expect.stringMatching(/họ và tên/i) })));
    expect(createCustomer).not.toHaveBeenCalled();
    expect(screen.queryByText(/Vui lòng nhập số điện thoại/)).not.toBeInTheDocument();
  });

  it('SĐT sai định dạng -> chặn lưu; SĐT hợp lệ -> gửi nguyên chuỗi nhập', async () => {
    renderScreen();
    fireEvent.change(screen.getByLabelText(/Họ và tên khách hàng/), { target: { value: 'An' } });
    fireEvent.change(screen.getByLabelText(/Số điện thoại/), { target: { value: '123' } });
    fireEvent.click(screen.getByRole('button', { name: /Lưu khách hàng/ }));
    await waitFor(() => expect(showToast).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' })));
    expect(createCustomer).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText(/Số điện thoại/), { target: { value: '0912 345 678' } });
    fireEvent.click(screen.getByRole('button', { name: /Lưu khách hàng/ }));
    await waitFor(() => expect(createCustomer).toHaveBeenCalledTimes(1));
    expect(createCustomer.mock.calls[0][0].phone).toBe('0912 345 678');
  });

  it('API lỗi -> toast lỗi, không điều hướng', async () => {
    createCustomer.mockResolvedValue({ ok: false, error: { statusCode: 400, errorCode: 'INVALID_PHONE', message: 'SĐT sai' } });
    renderScreen();
    fireEvent.change(screen.getByLabelText(/Họ và tên khách hàng/), { target: { value: 'An' } });
    fireEvent.click(screen.getByRole('button', { name: /Lưu khách hàng/ }));
    await waitFor(() => expect(showToast).toHaveBeenCalledWith(expect.objectContaining({ type: 'error', message: 'SĐT sai' })));
    expect(selectCustomer).not.toHaveBeenCalled();
  });

  it.each(['STAFF', 'MANAGER', 'ADMIN'])('dòng chỉ đọc "Người chăm sóc chính: bạn (tự động)" hiện cho %s; không còn bộ chọn người phụ trách / banner trùng SĐT', (role) => {
    signIn(role);
    renderScreen();
    expect(screen.getByText('Người chăm sóc chính: bạn (tự động)')).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: /phụ trách/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/Người cùng chăm sóc/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Đã có trên hệ thống|đề nghị tham gia|Gửi đề nghị/i)).not.toBeInTheDocument();
  });
});
