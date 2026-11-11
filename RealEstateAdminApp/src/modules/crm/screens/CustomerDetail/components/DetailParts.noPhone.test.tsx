/** PhoneDisplay / CustomerInfoCard: null-safe khi khách chưa có SĐT (FR-02). */
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { CustomerDetail } from '@crm/api';
import { CrmProvider } from '@crm/store/CrmProvider';
import { createCrmStore, createSeedDataState } from '@crm/store/crmStore';
import { FIXED_NOW } from '@crm/test/fixtures';
import { CustomerInfoCard } from './CustomerInfoCard';
import { PhoneDisplay } from './DetailParts';

const createPhoneView = vi.fn();

vi.mock('@crm/api', async () => {
  const real = await vi.importActual<typeof import('@crm/api')>('@crm/api');
  return {
    ...real,
    useCrmApi: () => ({ createPhoneView, createNationalIdView: vi.fn() }),
    useCrmActor: () => ({ userId: 'u1', role: 'STAFF', teamId: null, managedTeamIds: [] }),
    useNationalIdViews: () => ({ data: [] }),
  };
});

const makeCustomer = (phoneMasked: string | null): CustomerDetail =>
  ({
    id: 'c1',
    fullName: 'Nguyễn Văn A',
    phoneMasked,
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
  }) as unknown as CustomerDetail;

const renderInStore = (ui: React.ReactElement) => {
  const store = createCrmStore({ initialData: createSeedDataState(FIXED_NOW), shouldPersist: false });
  return render(
    <MemoryRouter>
      <CrmProvider store={store}>{ui}</CrmProvider>
    </MemoryRouter>,
  );
};

describe('PhoneDisplay khi phoneMasked null', () => {
  it('không render gì (ẩn cả nút "Hiện số"), không gọi API xem số', () => {
    const { container } = renderInStore(<PhoneDisplay customer={makeCustomer(null)} />);
    expect(container).toBeEmptyDOMElement();
    expect(createPhoneView).not.toHaveBeenCalled();
  });

  it('có SĐT: vẫn hiện số che + nút "Hiện số" (đối chứng)', () => {
    renderInStore(<PhoneDisplay customer={makeCustomer('0912 ••• 678')} />);
    expect(screen.getByText('0912 ••• 678')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Hiện số/ })).toBeInTheDocument();
  });
});

describe('CustomerInfoCard khi khách chưa có SĐT', () => {
  it('render bình thường, không hàng SĐT, không chữ "null"', () => {
    renderInStore(<CustomerInfoCard customer={makeCustomer(null)} />);
    expect(screen.getByRole('region', { name: 'Thông tin khách hàng' })).toBeInTheDocument();
    expect(screen.queryByText(/Số điện thoại|SĐT/)).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/null|undefined/);
  });
});
