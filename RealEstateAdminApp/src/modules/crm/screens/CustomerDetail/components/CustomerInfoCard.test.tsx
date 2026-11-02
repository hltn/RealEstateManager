import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { CustomerDetail } from '@crm/api';
import { CrmProvider } from '@crm/store/CrmProvider';
import { createCrmStore, createSeedDataState } from '@crm/store/crmStore';
import { FIXED_NOW } from '@crm/test/fixtures';
import { CustomerInfoCard } from './CustomerInfoCard';

vi.mock('@crm/api', async () => {
  const real = await vi.importActual<typeof import('@crm/api')>('@crm/api');
  return {
    ...real,
    useCrmApi: () => ({ createPhoneView: vi.fn(), createNationalIdView: vi.fn() }),
    useCrmActor: () => ({ userId: 'u1', role: 'STAFF', teamId: null, managedTeamIds: [] }),
    useNationalIdViews: () => ({ data: [] }),
  };
});

const makeCustomer = (overrides: Partial<CustomerDetail> = {}): CustomerDetail =>
  ({
    id: 'c1',
    fullName: 'Nguyễn Văn A',
    phoneMasked: '0912 ••• 678',
    email: '',
    area: null,
    source: null,
    projects: [],
    tags: [],
    hasNationalId: false,
    nationalIdMasked: null,
    createdAt: '2026-10-20T03:00:00.000Z',
    createdBy: { id: 'u1', displayName: 'Trần B' },
    permissions: { canRevealNationalId: false },
    version: 1,
    careTeam: [],
    status: { id: 's', label: 'Mới' },
    criteria: {},
    ...overrides,
  }) as unknown as CustomerDetail;

const renderCard = (customer: CustomerDetail) => {
  const store = createCrmStore({ initialData: createSeedDataState(FIXED_NOW), shouldPersist: false });
  return render(
    <MemoryRouter>
      <CrmProvider store={store}>
        <CustomerInfoCard customer={customer} />
      </CrmProvider>
    </MemoryRouter>,
  );
};

describe('CustomerInfoCard (PT-018): tab Thông tin', () => {
  it('KHÔNG hiện SĐT (cả số che lẫn nút "Hiện số") trong section Thông tin', () => {
    renderCard(makeCustomer({ area: { id: 'a', label: 'Quận 7' } }));
    const section = screen.getByRole('region', { name: 'Thông tin khách hàng' });
    expect(within(section).queryByText(/Số điện thoại/)).toBeNull();
    expect(within(section).queryByText(/0912/)).toBeNull();
    expect(within(section).queryByRole('button', { name: /Hiện số/ })).toBeNull();
  });

  it('khách ít dữ liệu: chỉ còn "Tạo lúc"; các trường trống (khu vực, nguồn, dự án, thẻ, CCCD, email) bị ẩn, không có chữ "Chưa cập nhật"', () => {
    renderCard(makeCustomer());
    for (const label of ['Khu vực (nơi ở)', 'Nguồn khách', 'Dự án quan tâm', 'Thẻ sở thích / nghề nghiệp', 'CCCD', 'Email']) {
      expect(screen.queryByText(label)).toBeNull();
    }
    expect(screen.queryByText(/Chưa cập nhật|Chưa gắn thẻ/)).toBeNull();
    expect(screen.getByText('Tạo lúc')).toBeInTheDocument();
  });

  it('email toàn khoảng trắng coi là trống và ẩn', () => {
    renderCard(makeCustomer({ email: '   ' }));
    expect(screen.queryByText('Email')).toBeNull();
  });

  it('trường có dữ liệu thì hiện đủ: khu vực, nguồn, dự án (chip), thẻ, CCCD che, email', () => {
    renderCard(
      makeCustomer({
        area: { id: 'a', label: 'Quận 7' },
        source: { id: 's', label: 'Facebook' },
        projects: [{ id: 'p1', label: 'Q Terra' }],
        tags: [{ id: 't1', label: 'Golf' }],
        hasNationalId: true,
        nationalIdMasked: '••••1234',
        email: 'a@example.com',
      }),
    );
    expect(screen.getByText('Quận 7')).toBeInTheDocument();
    expect(screen.getByText('Facebook')).toBeInTheDocument();
    expect(screen.getByText('Q Terra')).toBeInTheDocument();
    expect(screen.getByText('#Golf')).toBeInTheDocument();
    expect(screen.getByText('••••1234')).toBeInTheDocument();
    expect(screen.getByText('a@example.com')).toBeInTheDocument();
  });

  it('vẫn có nút "Sửa" để vào màn sửa (nơi nhập đủ trường)', () => {
    renderCard(makeCustomer());
    expect(screen.getByRole('button', { name: 'Sửa thông tin khách hàng' })).toBeInTheDocument();
  });
});
