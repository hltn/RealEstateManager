/**
 * `CustomerCard` (thẻ khách trên điện thoại): dòng "Mục đích mua" nằm ngay sau SĐT; không có mục đích thì không render dòng.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { CustomerListItem } from '@crm/api';

vi.mock('@crm/store', () => ({ useCrmActions: () => ({ selectCustomer: vi.fn() }) }));
vi.mock('@crm/components/ContactActionGrid', () => ({ ContactActionGrid: () => null }));

import { CustomerCard } from './CustomerCard';

const customer = (overrides: Partial<CustomerListItem> = {}): CustomerListItem => ({
  id: 'c1',
  fullName: 'Nguyễn Văn An',
  phoneMasked: '0912 ••• 678',
  purchasePurposes: [],
  status: { id: 'NOT_CONTACTED', code: 'NOT_CONTACTED', label: 'Chưa tiếp cận', listGroup: 'NOT_CONTACTED', tone: 'gray' },
  source: null,
  projects: [],
  area: null,
  tags: [],
  progress: 0,
  criteriaDone: { demand: false, motivation: false, finance: false, timing: false },
  primaryAssignee: null,
  careTeamSize: 0,
  nextAppointmentAt: null,
  lastCareLogAt: null,
  lastUpdatedAt: '2026-10-24T01:00:00.000Z',
  personaCompleteness: 0,
  ...overrides,
});

describe('CustomerCard - mục đích mua dưới SĐT', () => {
  it('hiện nhãn theo cấu hình trường ngay sau dòng SĐT, cùng khối với tên khách', () => {
    render(<CustomerCard customer={customer({ purchasePurposes: ['LIVING'] })} purchasePurposeField={{ optionItems: [{ value: 'LIVING', label: 'Để ở', isActive: true }] }} />);
    const phone = screen.getByText('0912 ••• 678');
    const purposes = screen.getByText('Để ở');
    expect(phone.nextElementSibling).toBe(purposes.closest('p'));
    expect(phone.parentElement).toContainElement(screen.getByText('Nguyễn Văn An'));
  });

  it('thiếu cấu hình trường -> dùng nhãn mặc định, vẫn nằm ngay sau SĐT', () => {
    render(<CustomerCard customer={customer({ purchasePurposes: ['LIVING', 'INVEST_RENT'] })} />);
    const purposes = screen.getByText('Ở thực, Đầu tư cho thuê');
    expect(screen.getByText('0912 ••• 678').nextElementSibling).toBe(purposes.closest('p'));
  });

  it('không có mục đích -> không render dòng mục đích (không phần tử nào sau SĐT)', () => {
    render(<CustomerCard customer={customer()} purchasePurposeField={{ optionItems: [{ value: 'LIVING', label: 'Để ở', isActive: true }] }} />);
    expect(screen.getByText('0912 ••• 678').nextElementSibling).toBeNull();
    expect(screen.queryByTitle(/Mục đích mua/)).not.toBeInTheDocument();
    expect(screen.queryByText('Để ở')).not.toBeInTheDocument();
  });
});
