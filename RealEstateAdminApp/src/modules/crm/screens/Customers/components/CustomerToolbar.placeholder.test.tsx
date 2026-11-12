/** CustomerToolbar: ô tìm gợi ý tìm theo mã khách (FR-04). */
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_FILTERS } from '@crm/store';
import { CustomerToolbar } from './CustomerToolbar';

vi.mock('@crm/api', async () => {
  const actual = await vi.importActual<typeof import('@crm/api')>('@crm/api');
  return {
    ...actual,
    useCatalogs: () => ({ catalogs: { statuses: [], leadSources: [], areas: [], projects: [], tags: [], contactResults: [] }, users: [] }),
    useAssigneeFilterOptions: () => [],
    useProjectFilterOptions: () => [],
  };
});
vi.mock('@crm/store', async () => {
  const actual = await vi.importActual<typeof import('@crm/store')>('@crm/store');
  return { ...actual, useCrmActions: () => ({ openAdvancedFilter: vi.fn() }) };
});

type ToolbarScreen = Parameters<typeof CustomerToolbar>[0]['screen'];

describe('CustomerToolbar - ô tìm kiếm', () => {
  it('placeholder "Tìm tên, SĐT, mã KH-…" (không còn nhắc email)', () => {
    render(<CustomerToolbar screen={{ filters: DEFAULT_FILTERS, sort: 'lastUpdatedAt', setSort: vi.fn(), updateFilters: vi.fn() } as unknown as ToolbarScreen} />);
    const input = screen.getByLabelText('Tìm kiếm');
    expect(input).toHaveAttribute('placeholder', 'Tìm tên, SĐT, mã KH-…');
  });
});
