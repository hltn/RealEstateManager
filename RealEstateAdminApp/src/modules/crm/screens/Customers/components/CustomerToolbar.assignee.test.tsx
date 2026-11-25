/** CustomerToolbar: ô lọc nhanh "Người phụ trách" (nhãn thống nhất với Việc hôm nay) liệt kê cả người đã khóa và vẫn chọn được. */
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_FILTERS } from '@crm/store';
import { CustomerToolbar } from './CustomerToolbar';

vi.mock('@crm/api', async () => {
  const actual = await vi.importActual<typeof import('@crm/api')>('@crm/api');
  return {
    ...actual,
    useCatalogs: () => ({ catalogs: { statuses: [], leadSources: [], areas: [], projects: [], tags: [], contactResults: [] }, users: [] }),
    useAssigneeFilterOptions: () => [
      { value: 'u1', label: 'Lan' },
      { value: 'u2', label: 'Minh (đã khóa)' },
    ],
    useProjectFilterOptions: () => [],
  };
});
vi.mock('@crm/store', async () => {
  const actual = await vi.importActual<typeof import('@crm/store')>('@crm/store');
  return { ...actual, useCrmActions: () => ({ openAdvancedFilter: vi.fn() }) };
});

type ToolbarScreen = Parameters<typeof CustomerToolbar>[0]['screen'];

const renderToolbar = (updateFilters = vi.fn()) => {
  render(<CustomerToolbar screen={{ filters: DEFAULT_FILTERS, sort: 'lastUpdatedAt', setSort: vi.fn(), updateFilters } as unknown as ToolbarScreen} />);
  return { updateFilters };
};

describe('CustomerToolbar - ô lọc người phụ trách', () => {
  it('nhãn là "Người phụ trách" (không còn "Người chăm sóc")', () => {
    renderToolbar();
    expect(screen.getByLabelText('Người phụ trách')).toBeInTheDocument();
    expect(screen.queryByLabelText('Người chăm sóc')).not.toBeInTheDocument();
  });

  it('hiện nhãn "(đã khóa)" cho người bị khóa; chọn người đó vẫn ghi đúng id vào assigneeIds', () => {
    const { updateFilters } = renderToolbar();
    const select = screen.getByLabelText('Người phụ trách');
    expect(within(select).getAllByRole('option').map((option) => option.textContent)).toEqual(['Tất cả', 'Lan', 'Minh (đã khóa)']);
    fireEvent.change(select, { target: { value: 'u2' } });
    expect(updateFilters).toHaveBeenCalledWith({ assigneeIds: ['u2'] });
  });
});
