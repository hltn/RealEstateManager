/** CustomersMobile: cờ hiện người chăm sóc chính truyền xuống thẻ khách theo vai trò (FR-17) + placeholder ô tìm có mã KH (FR-04). */
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CustomerListItem } from '@crm/api';

const currentRole = vi.hoisted(() => ({ value: 'STAFF' as 'ADMIN' | 'MANAGER' | 'STAFF' }));
const customers = ['c1', 'c2'].map((id) => ({ id, fullName: `Khách ${id}` }) as unknown as CustomerListItem);

vi.mock('@crm/api', async () => {
  const actual = await vi.importActual<typeof import('@crm/api')>('@crm/api');
  return {
    ...actual,
    usePersonaFieldMap: () => new Map(),
    useCrmActor: () => ({ userId: 'u1', role: currentRole.value, teamId: null, managedTeamIds: [] }),
  };
});
vi.mock('@crm/store', () => ({ useCrmActions: () => ({ navigate: vi.fn(), openAdvancedFilter: vi.fn(), resetFilters: vi.fn() }) }));
vi.mock('../../../../components/common/Pagination', () => ({ Pagination: () => null }));
vi.mock('./components/CustomerStatusPills', () => ({ CustomerStatusPills: () => null }));
vi.mock('./components/CustomerCard', () => ({
  CustomerCard: ({ customer, isShowingPrimaryAssignee }: { customer: CustomerListItem; isShowingPrimaryAssignee?: boolean }) => (
    <article data-testid={`card-${customer.id}`} data-primary={String(Boolean(isShowingPrimaryAssignee))} />
  ),
}));
vi.mock('./useCustomerListScreen', async () => {
  const { DEFAULT_FILTERS } = await import('@crm/store/crmReducer');
  return {
    useCustomerListScreen: () => ({
      list: { data: customers, meta: { total: 2, page: 1, limit: 10, totalPages: 1 } },
      counts: { ALL: 2 },
      filters: DEFAULT_FILTERS,
      sort: '-lastUpdatedAt',
      setSort: vi.fn(),
      updateFilters: vi.fn(),
      setPage: vi.fn(),
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    }),
  };
});

import { CustomersMobile } from './Customers.mobile';

beforeEach(() => {
  currentRole.value = 'STAFF';
});

describe('CustomersMobile theo vai trò', () => {
  it.each([
    ['ADMIN', 'true'],
    ['MANAGER', 'true'],
    ['STAFF', 'false'],
  ] as const)('%s: thẻ khách nhận isShowingPrimaryAssignee=%s', (role, expected) => {
    currentRole.value = role;
    render(<CustomersMobile />);
    expect(screen.getByTestId('card-c1')).toHaveAttribute('data-primary', expected);
    expect(screen.getByTestId('card-c2')).toHaveAttribute('data-primary', expected);
  });

  it('ô tìm kiếm gợi ý tìm theo tên, SĐT, mã KH-…', () => {
    render(<CustomersMobile />);
    expect(screen.getByPlaceholderText('Tìm tên, SĐT, mã KH-…')).toBeInTheDocument();
  });
});
