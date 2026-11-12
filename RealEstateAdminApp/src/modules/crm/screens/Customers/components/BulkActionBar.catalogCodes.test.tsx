/**
 * FR-40 (tiêu chí T-15): tình trạng do MAPPER trả về (response có `id` ObjectId + `code`) -> ô "Giá trị áp dụng" của thao tác
 * hàng loạt có `<option value>` là code. Mapper quay về id ObjectId thì test đỏ.
 */
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { toStatusItem } from '../../../api/http/catalogMappers';
import type { CustomerStatusDto } from '../../../api/http/dto';
import type { CrmCatalogs } from '@crm/types/crm';
import { CrmProvider } from '@crm/store/CrmProvider';
import { createCrmStore, createSeedDataState } from '@crm/store/crmStore';
import { FIXED_NOW } from '@crm/test/fixtures';
import { BulkActionBar } from './BulkActionBar';

const statusDto = (n: number, code: string, label: string): CustomerStatusDto => ({
  id: `66f1a2b3c4d5e6f7081900${String(n).padStart(2, '0')}`, code, label, listGroup: code as CustomerStatusDto['listGroup'], color: null, order: n, isDefault: false, isSystem: true, isActive: true,
});

const catalogs: CrmCatalogs = {
  statuses: [statusDto(1, 'INTERESTED', 'Có quan tâm'), statusDto(2, 'DROPPED', 'Bỏ')].map(toStatusItem),
  leadSources: [],
  areas: [],
  projects: [],
  tags: [],
  contactResults: [],
};

vi.mock('@crm/api', async () => {
  const actual = await vi.importActual<typeof import('@crm/api')>('@crm/api');
  return {
    ...actual,
    useCrmApi: () => ({ bulkOperation: vi.fn() }),
    useCatalogs: () => ({ catalogs, users: [] }),
    useCareTeamInvitees: () => ({ data: { data: [], meta: { total: 0, page: 1, limit: 20, totalPages: 0 } } }),
    useCrmActor: () => ({ userId: 'admin', role: 'ADMIN', teamId: null, managedTeamIds: [] }),
  };
});

describe('thao tác hàng loạt dùng tình trạng từ mapper (FR-40)', () => {
  it('FR-40: "Đổi tình trạng": <option value> là code của tình trạng, không phải ObjectId', () => {
    const store = createCrmStore({ initialData: createSeedDataState(FIXED_NOW), initialSession: { currentUserId: 'admin' }, shouldPersist: false });
    render(
      <MemoryRouter>
        <CrmProvider store={store}>
          <BulkActionBar selectedIds={['c-1']} onClear={vi.fn()} onDeselect={vi.fn()} onDeleteResult={vi.fn()} getCustomer={() => undefined} />
        </CrmProvider>
      </MemoryRouter>,
    );
    fireEvent.change(screen.getByLabelText('Hành động hàng loạt'), { target: { value: 'CHANGE_STATUS' } });
    const values = within(screen.getByLabelText('Giá trị áp dụng')).getAllByRole('option').map((option) => (option as HTMLOptionElement).value);
    expect(values).toEqual(['', 'INTERESTED', 'DROPPED']);
  });
});
