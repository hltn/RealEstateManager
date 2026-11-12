import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CrmCatalogs } from '@crm/types/crm';
import { CrmProvider } from '@crm/store/CrmProvider';
import { createCrmStore, createSeedDataState } from '@crm/store/crmStore';
import { FIXED_NOW } from '@crm/test/fixtures';
import { BulkActionBar } from './BulkActionBar';

const bulkOperation = vi.fn();
const catalogs: CrmCatalogs = {
  statuses: [],
  leadSources: [],
  areas: [],
  projects: [],
  tags: [
    { id: 't-golf', name: 'Golf', category: 'INTEREST', isActive: true },
    { id: 't-bs', name: 'Bác sĩ', category: 'OCCUPATION', isActive: true },
    { id: 't-vip', name: 'Khách VIP', category: 'OTHER', isActive: true },
    { id: 't-old', name: 'Thẻ đã tắt', category: 'OTHER', isActive: false },
  ],
  contactResults: [],
};

vi.mock('@crm/api', async () => {
  const actual = await vi.importActual<typeof import('@crm/api')>('@crm/api');
  return {
    ...actual,
    useCrmApi: () => ({ bulkOperation }),
    useCatalogs: () => ({ catalogs, users: [] }),
    useCareTeamInvitees: () => ({ data: { data: [], meta: { total: 0, page: 1, limit: 20, totalPages: 0 } } }),
    useCrmActor: () => ({ userId: 'admin', role: 'ADMIN', teamId: null, managedTeamIds: [] }),
  };
});

const setup = () => {
  const store = createCrmStore({ initialData: createSeedDataState(FIXED_NOW), initialSession: { currentUserId: 'admin' }, shouldPersist: false });
  render(
    <MemoryRouter>
      <CrmProvider store={store}>
        <BulkActionBar selectedIds={['c-1', 'c-2']} onClear={vi.fn()} onDeselect={vi.fn()} onDeleteResult={vi.fn()} getCustomer={() => undefined} />
      </CrmProvider>
    </MemoryRouter>,
  );
};

beforeEach(() => bulkOperation.mockReset());

describe('BulkActionBar: gắn thẻ hàng loạt theo nhóm (FR-48)', () => {
  it('thẻ OTHER nằm trong nhóm "Thẻ khác", thẻ đã tắt không có; mỗi thẻ ở đúng nhóm của nó', () => {
    setup();
    fireEvent.change(screen.getByLabelText('Hành động hàng loạt'), { target: { value: 'ADD_TAGS' } });
    const select = screen.getByLabelText('Giá trị áp dụng');
    const groups = Array.from(select.querySelectorAll('optgroup')).map((group) => [group.label, Array.from(group.querySelectorAll('option')).map((option) => option.textContent)]);
    expect(groups).toEqual([
      ['Thẻ sở thích', ['#Golf']],
      ['Thẻ nghề nghiệp', ['#Bác sĩ']],
      ['Thẻ khác', ['#Khách VIP']],
    ]);
    expect(within(select).queryByText(/Thẻ đã tắt/)).not.toBeInTheDocument();
  });

  it('chọn thẻ OTHER rồi Áp dụng: gọi ADD_TAGS với id thẻ đó', async () => {
    bulkOperation.mockResolvedValue({ ok: true, data: { succeeded: ['c-1', 'c-2'], failed: [] } });
    setup();
    fireEvent.change(screen.getByLabelText('Hành động hàng loạt'), { target: { value: 'ADD_TAGS' } });
    fireEvent.change(screen.getByLabelText('Giá trị áp dụng'), { target: { value: 't-vip' } });
    fireEvent.click(screen.getByRole('button', { name: 'Áp dụng' }));
    await waitFor(() => expect(bulkOperation).toHaveBeenCalledWith({ type: 'ADD_TAGS', customerIds: ['c-1', 'c-2'], tagIds: ['t-vip'] }));
  });
});
