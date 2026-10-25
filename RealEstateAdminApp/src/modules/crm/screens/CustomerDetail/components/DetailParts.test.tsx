import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { StrictMode, type ReactElement } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CustomerDetail } from '@crm/api';
import { CrmProvider } from '@crm/store/CrmProvider';
import { createCrmStore, createSeedDataState } from '@crm/store/crmStore';
import { FIXED_NOW } from '@crm/test/fixtures';
import { NationalIdField, PhoneDisplay } from './DetailParts';

const createPhoneView = vi.fn();
const createNationalIdView = vi.fn();
const actor = { current: { userId: 'u1', role: 'STAFF' as 'ADMIN' | 'MANAGER' | 'STAFF', teamId: null, managedTeamIds: [] as string[] } };

vi.mock('@crm/api', async () => {
  const real = await vi.importActual<typeof import('@crm/api')>('@crm/api');
  return {
    ...real,
    useCrmApi: () => ({ createPhoneView, createNationalIdView }),
    useCrmActor: () => actor.current,
    useNationalIdViews: () => ({ data: [] }),
    useCatalogs: () => ({ catalogs: { statuses: [] }, users: [] }),
  };
});

const makeCustomer = (id: string, phoneMasked: string, canRevealNationalId: boolean): CustomerDetail =>
  ({ id, fullName: `Khách ${id}`, phoneMasked, hasNationalId: true, nationalIdMasked: '••••1234', version: 1, status: { id: 's', label: 'Mới' }, criteria: {}, careTeam: [], permissions: { canRevealNationalId } }) as unknown as CustomerDetail;

const render_ = (ui: ReactElement) => {
  const store = createCrmStore({ initialData: createSeedDataState(FIXED_NOW), shouldPersist: false });
  const tree = (node: ReactElement) => (
    <StrictMode>
      <MemoryRouter>
        <CrmProvider store={store}>{node}</CrmProvider>
      </MemoryRouter>
    </StrictMode>
  );
  const view = render(tree(ui));
  return { rerender: (node: ReactElement) => view.rerender(tree(node)) };
};

beforeEach(() => {
  createPhoneView.mockReset();
  createNationalIdView.mockReset();
  actor.current = { userId: 'u1', role: 'STAFF', teamId: null, managedTeamIds: [] };
});

describe('PhoneDisplay: xem số đầy đủ qua API có ghi log (server ghi PHONE_VIEWED, không lưu số)', () => {
  it('mặc định che; "Hiện số" gọi API ĐÚNG 1 lần (kể cả StrictMode) rồi hiện số đầy đủ; "Ẩn số" không gọi thêm', async () => {
    createPhoneView.mockResolvedValue({ ok: true, data: { phone: '+84912345678', viewedAt: 't' } });
    render_(<PhoneDisplay customer={makeCustomer('c1', '0912 ••• 678', false)} />);
    expect(screen.getByText(/0912 ••• 678/)).toBeInTheDocument();
    expect(screen.queryByText('0912 345 678')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Hiện số/ }));
    await waitFor(() => expect(screen.getByText('0912 345 678')).toBeInTheDocument());
    expect(createPhoneView).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: /Ẩn số/ }));
    expect(createPhoneView).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('0912 345 678')).toBeNull();
  });

  it('404 ngoài phạm vi / 429: báo lỗi, KHÔNG hiện số', async () => {
    createPhoneView.mockResolvedValue({ ok: false, error: { statusCode: 429, errorCode: 'RATE_LIMITED', message: 'Bạn thao tác quá nhanh. Vui lòng thử lại sau 5 giây.' } });
    render_(<PhoneDisplay customer={makeCustomer('c1', '0912 ••• 678', false)} />);
    fireEvent.click(screen.getByRole('button', { name: /Hiện số/ }));
    await waitFor(() => expect(createPhoneView).toHaveBeenCalled());
    expect(screen.queryByText('0912 345 678')).toBeNull();
    expect(screen.getByRole('button', { name: /Hiện số/ })).toHaveAttribute('aria-pressed', 'false');
  });

  it('đổi khách trên cùng component: không giữ số đã hiện của khách cũ', async () => {
    createPhoneView.mockResolvedValue({ ok: true, data: { phone: '+84912345678', viewedAt: 't' } });
    const { rerender } = render_(<PhoneDisplay customer={makeCustomer('c1', '0912 ••• 678', false)} />);
    fireEvent.click(screen.getByRole('button', { name: /Hiện số/ }));
    await waitFor(() => expect(screen.getByText('0912 345 678')).toBeInTheDocument());
    rerender(<PhoneDisplay customer={makeCustomer('c2', '0988 ••• 222', false)} />);
    expect(screen.queryByText('0912 345 678')).toBeNull();
    expect(screen.getByText(/0988 ••• 222/)).toBeInTheDocument();
    expect(createPhoneView).toHaveBeenCalledTimes(1);
  });
});

describe('NationalIdField: CCCD chỉ hiện cho người được phép (server vẫn kiểm: 403 NATIONAL_ID_FORBIDDEN)', () => {
  it('không có quyền: không có nút "Hiện"', () => {
    render_(<NationalIdField customer={makeCustomer('c1', '', false)} />);
    expect(screen.queryByRole('button', { name: /Hiện/ })).toBeNull();
  });

  it('có quyền: 1 lần bấm = đúng 1 lần gọi API (StrictMode); bấm "Ẩn" không gọi thêm', async () => {
    createNationalIdView.mockResolvedValue({ ok: true, data: { nationalId: '079092001234', viewedAt: 't' } });
    render_(<NationalIdField customer={makeCustomer('c1', '', true)} />);
    fireEvent.click(screen.getByRole('button', { name: /Hiện/ }));
    await waitFor(() => expect(screen.getByText('079092001234')).toBeInTheDocument());
    expect(createNationalIdView).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: /Ẩn/ }));
    expect(createNationalIdView).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('079092001234')).toBeNull();
  });

  it('CCCD khách A không hiện sang khách B', async () => {
    createNationalIdView.mockResolvedValue({ ok: true, data: { nationalId: '079092001234', viewedAt: 't' } });
    const { rerender } = render_(<NationalIdField customer={makeCustomer('c1', '', true)} />);
    fireEvent.click(screen.getByRole('button', { name: /Hiện/ }));
    await waitFor(() => expect(screen.getByText('079092001234')).toBeInTheDocument());
    rerender(<NationalIdField customer={makeCustomer('c2', '', true)} />);
    expect(screen.queryByText('079092001234')).toBeNull();
  });
});
