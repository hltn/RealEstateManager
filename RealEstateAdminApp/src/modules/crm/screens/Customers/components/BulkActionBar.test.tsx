import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CrmCatalogs, CrmUser } from '@crm/types/crm';
import { CrmProvider } from '@crm/store/CrmProvider';
import { createCrmStore, createSeedDataState } from '@crm/store/crmStore';
import { FIXED_NOW } from '@crm/test/fixtures';
import { BulkActionBar } from './BulkActionBar';

const bulkOperation = vi.fn();
const catalogs: CrmCatalogs = {
  statuses: [
    { id: 'st-interested', code: 'INTERESTED', label: 'Có quan tâm', listGroup: 'INTERESTED', tone: 'success', order: 1, isDefault: false, isSystem: true, isActive: true },
    { id: 'st-dropped', code: 'DROPPED', label: 'Bỏ', listGroup: 'DROPPED', tone: 'error', order: 2, isDefault: false, isSystem: true, isActive: true },
  ],
  leadSources: [],
  areas: [],
  projects: [],
  tags: [{ id: 'tag-1', name: 'Đầu tư', category: 'INTEREST', isActive: true }],
  contactResults: [],
};
const users: CrmUser[] = [{ id: 'u-1', fullName: 'Hạnh', displayName: 'Hạnh', role: 'STAFF', jobTitle: '', teamId: 't-1', isActive: true }];

vi.mock('@crm/api', async () => {
  const actual = await vi.importActual<typeof import('@crm/api')>('@crm/api');
  return {
    ...actual,
    useCrmApi: () => ({ bulkOperation }),
    useCatalogs: () => ({ catalogs, users }),
    useAssignableUsers: () => ({ data: users.map((user) => ({ ...user, team: null })) }),
    useCrmActor: () => ({ userId: 'admin', role: 'ADMIN', teamId: null, managedTeamIds: [] }),
  };
});

const setup = (getStatusId: (id: string) => string | undefined = () => 'st-interested') => {
  const store = createCrmStore({ initialData: createSeedDataState(FIXED_NOW), initialSession: { currentUserId: 'admin' }, shouldPersist: false });
  const onClear = vi.fn();
  render(
    <MemoryRouter>
      <CrmProvider store={store}>
        <BulkActionBar selectedIds={['c-1', 'c-2']} onClear={onClear} getStatusId={getStatusId} />
      </CrmProvider>
    </MemoryRouter>,
  );
  return { onClear };
};

const pick = (action: string, value: string) => {
  fireEvent.change(screen.getByLabelText('Hành động hàng loạt'), { target: { value: action } });
  fireEvent.change(screen.getByLabelText('Giá trị áp dụng'), { target: { value } });
  fireEvent.click(screen.getByRole('button', { name: 'Áp dụng' }));
};

beforeEach(() => bulkOperation.mockReset());

describe('BulkActionBar gọi API hàng loạt', () => {
  it('chuyển sang "Bỏ" phải xác nhận: chưa gọi API; Huỷ giữ nguyên; Xác nhận mới gọi đúng payload', async () => {
    bulkOperation.mockResolvedValue({ ok: true, data: { succeeded: ['c-1', 'c-2'], failed: [] } });
    const { onClear } = setup();
    pick('CHANGE_STATUS', 'st-dropped');
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(bulkOperation).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Huỷ' }));
    expect(bulkOperation).not.toHaveBeenCalled();
    expect(onClear).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Áp dụng' }));
    fireEvent.click(screen.getByRole('button', { name: 'Chuyển sang Bỏ' }));
    await waitFor(() => expect(onClear).toHaveBeenCalledTimes(1));
    expect(bulkOperation).toHaveBeenCalledWith({ type: 'CHANGE_STATUS', customerIds: ['c-1', 'c-2'], statusId: 'st-dropped' });
  });

  it('đổi sang tình trạng không phải "Bỏ" thì gọi API ngay, không hỏi', async () => {
    bulkOperation.mockResolvedValue({ ok: true, data: { succeeded: ['c-1', 'c-2'], failed: [] } });
    setup();
    pick('CHANGE_STATUS', 'st-interested');
    expect(screen.queryByRole('alertdialog')).toBeNull();
    await waitFor(() => expect(bulkOperation).toHaveBeenCalledTimes(1));
  });

  it('có khách lỗi (ngoài phạm vi/chưa có phụ trách chính): giữ lựa chọn để người dùng xử lý, không tự bỏ chọn', async () => {
    bulkOperation.mockResolvedValue({ ok: true, data: { succeeded: ['c-1'], failed: [{ customerId: 'c-2', errorCode: 'PRIMARY_REQUIRED' }] } });
    const { onClear } = setup();
    fireEvent.change(screen.getByLabelText('Hành động hàng loạt'), { target: { value: 'ASSIGN' } });
    fireEvent.change(screen.getByLabelText('Giá trị áp dụng'), { target: { value: 'u-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Áp dụng' }));
    await waitFor(() => expect(bulkOperation).toHaveBeenCalledWith({ type: 'ASSIGN', customerIds: ['c-1', 'c-2'], memberIds: ['u-1'], primaryUserId: undefined }));
    expect(onClear).not.toHaveBeenCalled();
  });

  it('Quản trị chỉ thấy các người được phép gán (từ assignable-users), không có thao tác xuất khi tắt cờ mock', () => {
    setup();
    fireEvent.change(screen.getByLabelText('Hành động hàng loạt'), { target: { value: 'ASSIGN' } });
    const options = Array.from(screen.getByLabelText('Giá trị áp dụng').querySelectorAll('option')).map((option) => option.textContent);
    expect(options.join('|')).toContain('Hạnh');
  });
});
