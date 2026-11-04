import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CustomerDetail } from '@crm/api';
import { CrmProvider } from '@crm/store/CrmProvider';
import { createCrmStore, createSeedDataState } from '@crm/store/crmStore';
import { FIXED_NOW } from '@crm/test/fixtures';
import { CustomerHeader } from './CustomerHeader';

const callCustomer = vi.fn();
const messageZalo = vi.fn();
const openQuickNote = vi.fn();

vi.mock('@crm/hooks/useContactActions', () => ({ useContactActions: () => ({ callCustomer, messageZalo, openQuickNote }) }));
vi.mock('@crm/api', async () => {
  const real = await vi.importActual<typeof import('@crm/api')>('@crm/api');
  return {
    ...real,
    useCrmApi: () => ({ createPhoneView: vi.fn() }),
    useCatalogs: () => ({ catalogs: { statuses: [] }, users: [] }),
  };
});

const customer = {
  id: 'c1',
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
} as unknown as CustomerDetail;

const renderHeader = (variant: 'desktop' | 'mobile') => {
  const onAddNote = vi.fn();
  const store = createCrmStore({ initialData: createSeedDataState(FIXED_NOW), shouldPersist: false });
  render(
    <MemoryRouter>
      <CrmProvider store={store}>
        <CustomerHeader customer={customer} variant={variant} onAddNote={onAddNote} />
      </CrmProvider>
    </MemoryRouter>,
  );
  return onAddNote;
};

beforeEach(() => {
  callCustomer.mockReset();
  messageZalo.mockReset();
  openQuickNote.mockReset();
});

describe('CustomerHeader: nút "Ghi chú" mở form đầy đủ (PT-020), không còn hộp "Ghi chú nhanh" rút gọn', () => {
  it('mobile: bấm "Ghi chú" gọi onAddNote, KHÔNG mở QuickNote', () => {
    const onAddNote = renderHeader('mobile');
    fireEvent.click(screen.getByRole('button', { name: 'Ghi chú' }));
    expect(onAddNote).toHaveBeenCalledTimes(1);
    expect(openQuickNote).not.toHaveBeenCalled();
  });

  it('desktop: nút biểu tượng "Ghi chú" gọi onAddNote, KHÔNG mở QuickNote', () => {
    const onAddNote = renderHeader('desktop');
    fireEvent.click(screen.getByRole('button', { name: 'Ghi chú' }));
    expect(onAddNote).toHaveBeenCalledTimes(1);
    expect(openQuickNote).not.toHaveBeenCalled();
  });
});

describe('PT-017/PT-018: đường xem/gọi số vẫn còn ở đầu hồ sơ sau khi bỏ SĐT khỏi section "Thông tin"', () => {
  it.each(['desktop', 'mobile'] as const)('%s: còn SĐT che + nút "Hiện số" (C14, ghi PHONE_VIEWED qua createPhoneView)', (variant) => {
    renderHeader(variant);
    expect(screen.getByText(/0912 ••• 678/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Hiện số/ })).toBeInTheDocument();
  });

  it('desktop: còn nút Gọi và Zalo; bấm gọi callCustomer/messageZalo với đúng id', () => {
    renderHeader('desktop');
    fireEvent.click(screen.getByRole('button', { name: 'Gọi' }));
    fireEvent.click(screen.getByRole('button', { name: 'Zalo' }));
    expect(callCustomer).toHaveBeenCalledWith('c1');
    expect(messageZalo).toHaveBeenCalledWith('c1');
  });

  it('desktop: breadcrumb có tên khách (hiện từ md trở lên); mục tên khách mang lớp ẩn dưới md', () => {
    renderHeader('desktop');
    const nameCrumb = screen.getByRole('navigation', { name: 'Breadcrumb' }).querySelector('[aria-current="page"]')?.closest('li');
    expect(nameCrumb).toHaveTextContent('Nguyễn Văn A');
    expect(nameCrumb).toHaveClass('hidden', 'md:flex');
  });

  it('mobile: tên khách là tiêu đề h1 của thẻ tóm tắt (đầu màn chỉ còn nhãn "Quản lý khách hàng")', () => {
    renderHeader('mobile');
    expect(screen.getByRole('heading', { level: 1, name: 'Nguyễn Văn A' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Breadcrumb' })).toBeNull();
  });
});
