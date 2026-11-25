/** CustomerHeader: mã khách ở đầu chi tiết với mọi vai trò (FR-04) + khách chưa có SĐT (FR-02): ẩn dòng SĐT và nút Gọi/Zalo. */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CustomerDetail } from '@crm/api';
import { CrmProvider } from '@crm/store/CrmProvider';
import { createCrmStore, createSeedDataState } from '@crm/store/crmStore';
import { FIXED_NOW } from '@crm/test/fixtures';
import { useAuthStore } from '../../../../../stores/auth.store';
import { CustomerHeader } from './CustomerHeader';

vi.mock('@crm/hooks/useContactActions', () => ({ useContactActions: () => ({ callCustomer: vi.fn(), messageZalo: vi.fn(), openQuickNote: vi.fn() }) }));
const clipboardMock = vi.hoisted(() => ({ copyTextToClipboard: vi.fn() }));
vi.mock('@crm/lib/clipboard', () => ({ copyTextToClipboard: clipboardMock.copyTextToClipboard }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@crm/api', async () => {
  const real = await vi.importActual<typeof import('@crm/api')>('@crm/api');
  return { ...real, useCrmApi: () => ({ createPhoneView: vi.fn() }), useCatalogs: () => ({ catalogs: { statuses: [] }, users: [] }) };
});

const makeCustomer = (overrides: Partial<CustomerDetail> = {}): CustomerDetail =>
  ({
    id: 'c1',
    customerCode: 'KH-000123',
    fullName: 'Nguyễn Văn A',
    phoneMasked: '0912 ••• 678',
    version: 1,
    status: { id: 's', label: 'Mới', tone: 'brand' },
    primaryAssignee: { id: 'u1', displayName: 'Hạnh' },
    lastUpdatedAt: '2026-10-26T02:00:00.000Z',
    lastUpdatedBy: { id: 'u1', displayName: 'Hạnh' },
    permissions: { canDelete: false },
    careTeam: [],
    criteria: {},
    ...overrides,
  }) as unknown as CustomerDetail;

const renderHeader = (customer: CustomerDetail, variant: 'desktop' | 'mobile') => {
  const store = createCrmStore({ initialData: createSeedDataState(FIXED_NOW), shouldPersist: false });
  return render(
    <MemoryRouter>
      <CrmProvider store={store}>
        <CustomerHeader customer={customer} variant={variant} onAddNote={vi.fn()} />
      </CrmProvider>
    </MemoryRouter>,
  );
};

const signInAs = (role: string) =>
  useAuthStore.setState({ accessToken: 't', user: { _id: 'u1', email: 'a@b.vn', displayName: 'An', role, roles: [role] } as never, isInitialized: true });

beforeEach(() => clipboardMock.copyTextToClipboard.mockReset().mockResolvedValue(true));
afterEach(() => useAuthStore.setState({ accessToken: null, user: null, isInitialized: true }));

describe('CustomerHeader - mã khách (desktop, mọi vai trò)', () => {
  it.each(['STAFF', 'MANAGER', 'ADMIN'])('%s thấy mã KH cạnh tên khách', (role) => {
    signInAs(role);
    renderHeader(makeCustomer(), 'desktop');
    expect(screen.getByRole('button', { name: 'Sao chép mã khách KH-000123' })).toHaveTextContent('KH-000123');
  });

  it('desktop: mã là nút sao chép giữ kiểu chip xám của header (không chồng kiểu chip mặc định), bấm chép đúng mã', async () => {
    renderHeader(makeCustomer(), 'desktop');
    const button = screen.getByRole('button', { name: 'Sao chép mã khách KH-000123' });
    expect(button).toHaveClass('bg-gray-100', 'rounded-full', 'text-xs');
    expect(button).not.toHaveClass('min-h-8', 'border', 'bg-gray-50');
    fireEvent.click(button);
    await waitFor(() => expect(clipboardMock.copyTextToClipboard).toHaveBeenCalledExactlyOnceWith('KH-000123'));
  });

  it('mã null: không hiện gì, không lỗi', () => {
    renderHeader(makeCustomer({ customerCode: null }), 'desktop');
    expect(screen.queryByText(/Mã khách/)).not.toBeInTheDocument();
  });

  it('mã null (desktop): không có nút sao chép', () => {
    renderHeader(makeCustomer({ customerCode: null }), 'desktop');
    expect(screen.queryByRole('button', { name: /Sao chép mã khách/ })).not.toBeInTheDocument();
  });

  it('mobile: mã là nút chip sao chép NGAY DƯỚI tên khách (sau h1), chỉ hiện đúng 1 lần', async () => {
    renderHeader(makeCustomer(), 'mobile');
    const heading = screen.getByRole('heading', { level: 1, name: 'Nguyễn Văn A' });
    const button = screen.getByRole('button', { name: 'Sao chép mã khách KH-000123' });
    expect(screen.getAllByText('KH-000123')).toHaveLength(1);
    expect(heading.parentElement).toContainElement(button);
    expect(heading.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(button).toHaveClass('min-h-8');
    fireEvent.click(button);
    await waitFor(() => expect(clipboardMock.copyTextToClipboard).toHaveBeenCalledExactlyOnceWith('KH-000123'));
    expect(within(screen.getByRole('region', { name: 'Tóm tắt hồ sơ' })).getByRole('button', { name: 'Sao chép mã khách KH-000123' })).toBe(button);
  });

  it('mobile: mã null -> không có nút sao chép, không chừa khối thừa dưới tên', () => {
    renderHeader(makeCustomer({ customerCode: null }), 'mobile');
    expect(screen.queryByRole('button', { name: /Sao chép mã khách/ })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 }).parentElement?.children).toHaveLength(1);
  });
});

describe('CustomerHeader - khách chưa có SĐT (phoneMasked null)', () => {
  it.each(['desktop', 'mobile'] as const)('%s: render được, ẩn dòng SĐT và nút "Hiện số"', (variant) => {
    renderHeader(makeCustomer({ phoneMasked: null }), variant);
    expect(screen.getByRole('heading', { level: 1, name: 'Nguyễn Văn A' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Hiện số/ })).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/null|undefined/);
  });

  it('desktop: ẨN (không disable) nút Gọi và Zalo; vẫn còn Ghi chú / Đặt lịch hẹn', () => {
    renderHeader(makeCustomer({ phoneMasked: null }), 'desktop');
    expect(screen.queryByRole('button', { name: 'Gọi' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Zalo' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ghi chú' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Đặt lịch hẹn' })).toBeInTheDocument();
  });

  it('desktop có SĐT: vẫn đủ nút Gọi và Zalo (đối chứng)', () => {
    renderHeader(makeCustomer(), 'desktop');
    expect(screen.getByRole('button', { name: 'Gọi' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Zalo' })).toBeInTheDocument();
  });
});
