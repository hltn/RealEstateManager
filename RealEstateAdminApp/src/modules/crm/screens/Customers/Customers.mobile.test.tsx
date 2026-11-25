/**
 * `CustomersMobile` tra cấu hình trường "Mục đích mua" theo khóa dùng chung rồi truyền xuống từng thẻ khách.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { CustomerListItem } from '@crm/api';
import { PURCHASE_PURPOSES_FIELD_KEY } from '@crm/data/personaFields';

const purposeField = { key: PURCHASE_PURPOSES_FIELD_KEY, optionItems: [{ value: 'LIVING', label: 'Để ở', isActive: true }] };
const requestedKeys: string[] = [];
const customers = ['c1', 'c2'].map((id) => ({ id, fullName: `Khách ${id}` }) as unknown as CustomerListItem);

vi.mock('@crm/api', async () => {
  const actual = await vi.importActual<typeof import('@crm/api')>('@crm/api');
  return {
    ...actual,
    usePersonaFieldMap: () => ({
      get: (key: string) => {
        requestedKeys.push(key);
        return key === PURCHASE_PURPOSES_FIELD_KEY ? purposeField : undefined;
      },
    }),
  };
});
vi.mock('@crm/store', () => ({ useCrmActions: () => ({ navigate: vi.fn(), openAdvancedFilter: vi.fn(), resetFilters: vi.fn() }) }));
vi.mock('../../../../components/common/Pagination', () => ({ Pagination: () => null }));
vi.mock('./components/CustomerStatusPills', () => ({ CustomerStatusPills: () => null }));
vi.mock('./components/CustomerCard', () => ({
  CustomerCard: ({ customer, purchasePurposeField }: { customer: CustomerListItem; purchasePurposeField?: typeof purposeField }) => (
    <article data-testid={`card-${customer.id}`}>{purchasePurposeField?.optionItems[0]?.label ?? 'không có cấu hình'}</article>
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

describe('CustomersMobile - mục đích mua', () => {
  it('tra đúng khóa trường "Mục đích mua" và truyền cùng một cấu hình xuống mọi thẻ', () => {
    render(<CustomersMobile />);
    expect(requestedKeys).toContain(PURCHASE_PURPOSES_FIELD_KEY);
    expect(screen.getByTestId('card-c1')).toHaveTextContent('Để ở');
    expect(screen.getByTestId('card-c2')).toHaveTextContent('Để ở');
  });
});
