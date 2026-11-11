import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CustomerListItem } from '@crm/api';
import type { CrmCatalogs, CrmUser } from '@crm/types/crm';
import { CrmProvider } from '@crm/store/CrmProvider';
import { createCrmStore, createSeedDataState } from '@crm/store/crmStore';
import { FIXED_NOW } from '@crm/test/fixtures';
import { BulkActionBar } from './BulkActionBar';

const bulkOperation = vi.fn();
const actorRef = { current: { userId: 'admin', role: 'ADMIN', teamId: null, managedTeamIds: [] as string[] } as { userId: string; role: 'ADMIN' | 'MANAGER' | 'STAFF'; teamId: string | null; managedTeamIds: string[] } };
const catalogs: CrmCatalogs = {
  statuses: [
    { id: 'INTERESTED', code: 'INTERESTED', label: 'Có quan tâm', listGroup: 'INTERESTED', tone: 'success', order: 1, isDefault: false, isSystem: true, isActive: true },
    { id: 'DROPPED', code: 'DROPPED', label: 'Bỏ', listGroup: 'DROPPED', tone: 'error', order: 2, isDefault: false, isSystem: true, isActive: true },
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
    useCareTeamInvitees: () => ({ data: { data: users.map((user) => ({ id: user.id, displayName: user.displayName, teamNames: [] })), meta: { total: users.length, page: 1, limit: 20, totalPages: 1 } } }),
    useCrmActor: () => actorRef.current,
  };
});

const customerOf = (statusId: string, listGroup: 'INTERESTED' | 'DROPPED', primaryUserId: string | null = null): CustomerListItem =>
  ({ id: 'c', fullName: 'Khách', status: { id: statusId, listGroup }, primaryAssignee: primaryUserId ? { id: primaryUserId, displayName: 'P' } : null }) as CustomerListItem;

const setup = (getCustomer: (id: string) => CustomerListItem | undefined = () => customerOf('INTERESTED', 'INTERESTED'), selectedIds = ['c-1', 'c-2']) => {
  const store = createCrmStore({ initialData: createSeedDataState(FIXED_NOW), initialSession: { currentUserId: 'admin' }, shouldPersist: false });
  const onClear = vi.fn();
  const onDeselect = vi.fn();
  const onDeleteResult = vi.fn();
  const tree = (getCustomerFn: typeof getCustomer) => (
    <MemoryRouter>
      <CrmProvider store={store}>
        <BulkActionBar selectedIds={selectedIds} onClear={onClear} onDeselect={onDeselect} onDeleteResult={onDeleteResult} getCustomer={getCustomerFn} />
      </CrmProvider>
    </MemoryRouter>
  );
  const { rerender } = render(tree(getCustomer));
  return { onClear, onDeselect, onDeleteResult, rerenderWith: (getCustomerFn: typeof getCustomer) => rerender(tree(getCustomerFn)) };
};

const pick = (action: string, value: string) => {
  fireEvent.change(screen.getByLabelText('Hành động hàng loạt'), { target: { value: action } });
  fireEvent.change(screen.getByLabelText('Giá trị áp dụng'), { target: { value } });
  fireEvent.click(screen.getByRole('button', { name: 'Áp dụng' }));
};

beforeEach(() => {
  bulkOperation.mockReset();
  actorRef.current = { userId: 'admin', role: 'ADMIN', teamId: null, managedTeamIds: [] };
});

describe('BulkActionBar gọi API hàng loạt', () => {
  it('chuyển sang "Bỏ" phải xác nhận: chưa gọi API; Huỷ giữ nguyên; Xác nhận mới gọi đúng payload', async () => {
    bulkOperation.mockResolvedValue({ ok: true, data: { succeeded: ['c-1', 'c-2'], failed: [] } });
    const { onClear } = setup();
    pick('CHANGE_STATUS', 'DROPPED');
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(bulkOperation).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Huỷ' }));
    expect(bulkOperation).not.toHaveBeenCalled();
    expect(onClear).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Áp dụng' }));
    fireEvent.click(screen.getByRole('button', { name: 'Chuyển sang Bỏ' }));
    await waitFor(() => expect(onClear).toHaveBeenCalledTimes(1));
    expect(bulkOperation).toHaveBeenCalledWith({ type: 'CHANGE_STATUS', customerIds: ['c-1', 'c-2'], statusId: 'DROPPED' });
  });

  it('đổi sang tình trạng không phải "Bỏ" thì gọi API ngay, không hỏi', async () => {
    bulkOperation.mockResolvedValue({ ok: true, data: { succeeded: ['c-1', 'c-2'], failed: [] } });
    setup();
    pick('CHANGE_STATUS', 'INTERESTED');
    expect(screen.queryByRole('alertdialog')).toBeNull();
    await waitFor(() => expect(bulkOperation).toHaveBeenCalledTimes(1));
  });

  it('có khách lỗi (ngoài phạm vi/chưa có người phụ trách chính): giữ lựa chọn để người dùng xử lý, không tự bỏ chọn', async () => {
    bulkOperation.mockResolvedValue({ ok: true, data: { succeeded: ['c-1'], failed: [{ customerId: 'c-2', errorCode: 'PRIMARY_REQUIRED' }] } });
    const { onClear } = setup();
    fireEvent.change(screen.getByLabelText('Hành động hàng loạt'), { target: { value: 'ASSIGN' } });
    fireEvent.change(screen.getByLabelText('Giá trị áp dụng'), { target: { value: 'u-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Áp dụng' }));
    await waitFor(() => expect(bulkOperation).toHaveBeenCalledWith({ type: 'ASSIGN', customerIds: ['c-1', 'c-2'], memberIds: ['u-1'] }));
    expect(onClear).not.toHaveBeenCalled();
  });

  it('Quản trị chỉ thấy các người được phép gán (từ care-team-invitees), không có thao tác xuất khi tắt cờ mock', () => {
    setup();
    fireEvent.change(screen.getByLabelText('Hành động hàng loạt'), { target: { value: 'ASSIGN' } });
    const options = Array.from(screen.getByLabelText('Giá trị áp dụng').querySelectorAll('option')).map((option) => option.textContent);
    expect(options.join('|')).toContain('Hạnh');
  });
});

const optionLabels = () => Array.from(screen.getByLabelText('Hành động hàng loạt').querySelectorAll('option')).map((option) => option.textContent);

describe('BulkActionBar - xóa khách "Bỏ" hàng loạt', () => {
  const droppedOf = (primaryUserId: string | null = null) => () => customerOf('DROPPED', 'DROPPED', primaryUserId);

  it('option "Xóa" chỉ hiện khi MỌI khách chọn thuộc "Bỏ"', () => {
    setup(() => customerOf('INTERESTED', 'INTERESTED'));
    expect(optionLabels()).not.toContain('Xóa');
  });

  it('Nhân viên chỉ thấy "Xóa" khi là phụ trách chính của mọi khách chọn', () => {
    actorRef.current = { userId: 'staff-1', role: 'STAFF', teamId: 't-1', managedTeamIds: [] };
    setup(droppedOf('khac'));
    expect(optionLabels()).not.toContain('Xóa');
  });

  it('Quản lý có quản lý nhóm thì thấy "Xóa" (backend kiểm nhóm từng khách)', () => {
    actorRef.current = { userId: 'mgr', role: 'MANAGER', teamId: 't-1', managedTeamIds: ['t-1'] };
    setup(droppedOf('khac'));
    expect(optionLabels()).toContain('Xóa');
  });

  it('Quản lý không quản lý nhóm nào thì không thấy "Xóa"', () => {
    actorRef.current = { userId: 'mgr', role: 'MANAGER', teamId: null, managedTeamIds: [] };
    setup(droppedOf('mgr'));
    expect(optionLabels()).not.toContain('Xóa');
  });

  it('đã chọn "Xóa" rồi mất quyền (bỏ chọn khách không Bỏ...) thì về "chưa chọn" và KHÔNG tự bật lại khi đủ điều kiện trở lại', async () => {
    const { rerenderWith } = setup(droppedOf());
    fireEvent.change(screen.getByLabelText('Hành động hàng loạt'), { target: { value: 'DELETE' } });
    expect(screen.getByRole('button', { name: 'Xóa' })).toBeEnabled();

    rerenderWith(() => customerOf('INTERESTED', 'INTERESTED'));
    await waitFor(() => expect(screen.getByLabelText('Hành động hàng loạt')).toHaveValue(''));
    rerenderWith(droppedOf());
    expect(screen.getByLabelText('Hành động hàng loạt')).toHaveValue('');
    expect(screen.queryByRole('button', { name: 'Xóa' })).not.toBeInTheDocument();
  });

  it('Nhân viên là phụ trách chính của khách Bỏ thì thấy "Xóa"', () => {
    actorRef.current = { userId: 'staff-1', role: 'STAFF', teamId: 't-1', managedTeamIds: [] };
    setup(droppedOf('staff-1'));
    expect(optionLabels()).toContain('Xóa');
  });

  it('chọn Xóa -> nút "Xóa" -> hộp bắt buộc lý do; chỉ gọi API sau khi nhập lý do; xóa trọn lô thì bỏ chọn và báo thành công', async () => {
    bulkOperation.mockResolvedValue({ ok: true, data: { succeeded: ['c-1', 'c-2'], failed: [] } });
    const { onClear } = setup(droppedOf());
    fireEvent.change(screen.getByLabelText('Hành động hàng loạt'), { target: { value: 'DELETE' } });
    fireEvent.click(screen.getByRole('button', { name: 'Xóa' }));
    const confirm = screen.getByRole('button', { name: 'Xóa 2 khách' });
    expect(confirm).toBeDisabled();
    expect(bulkOperation).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText(/Lý do xóa/), { target: { value: ' Khách trùng ' } });
    fireEvent.click(confirm);
    await waitFor(() => expect(onClear).toHaveBeenCalledTimes(1));
    expect(bulkOperation).toHaveBeenCalledWith({ type: 'DELETE', customerIds: ['c-1', 'c-2'], reason: 'Khách trùng' });
  });

  it('có khách lỗi: báo kết quả từng khách cho cấp danh sách; chỉ bỏ chọn khách đã xóa, khách lỗi vẫn được giữ chọn', async () => {
    bulkOperation.mockResolvedValue({ ok: true, data: { succeeded: ['c-1'], failed: [{ customerId: 'c-2', errorCode: 'INSUFFICIENT_ROLE' }] } });
    const { onClear, onDeselect, onDeleteResult } = setup(droppedOf());
    fireEvent.change(screen.getByLabelText('Hành động hàng loạt'), { target: { value: 'DELETE' } });
    fireEvent.click(screen.getByRole('button', { name: 'Xóa' }));
    fireEvent.change(screen.getByLabelText(/Lý do xóa/), { target: { value: 'Nhập nhầm' } });
    fireEvent.click(screen.getByRole('button', { name: 'Xóa 2 khách' }));

    await waitFor(() => expect(onDeleteResult).toHaveBeenCalledWith({ succeeded: ['c-1'], failed: [{ customerId: 'c-2', errorCode: 'INSUFFICIENT_ROLE' }] }));
    expect(onDeselect).toHaveBeenCalledWith(['c-1']);
    expect(onClear).not.toHaveBeenCalled();
  });

  it('khách lỗi CUSTOMER_NOT_FOUND (không còn trong phạm vi) cũng bị bỏ chọn', async () => {
    bulkOperation.mockResolvedValue({ ok: true, data: { succeeded: ['c-1'], failed: [{ customerId: 'c-2', errorCode: 'CUSTOMER_NOT_FOUND' }] } });
    const { onDeselect } = setup(droppedOf());
    fireEvent.change(screen.getByLabelText('Hành động hàng loạt'), { target: { value: 'DELETE' } });
    fireEvent.click(screen.getByRole('button', { name: 'Xóa' }));
    fireEvent.change(screen.getByLabelText(/Lý do xóa/), { target: { value: 'Nhập nhầm' } });
    fireEvent.click(screen.getByRole('button', { name: 'Xóa 2 khách' }));

    await waitFor(() => expect(onDeselect).toHaveBeenCalledWith(['c-1', 'c-2']));
  });

  it('lỗi cả lô (400) giữ hộp mở với lý do đã nhập để sửa/thử lại', async () => {
    bulkOperation.mockResolvedValue({ ok: false, error: { statusCode: 400, errorCode: 'VALIDATION_FAILED', message: 'payload.reason phải có ít nhất một ký tự nhìn thấy được' } });
    setup(droppedOf());
    fireEvent.change(screen.getByLabelText('Hành động hàng loạt'), { target: { value: 'DELETE' } });
    fireEvent.click(screen.getByRole('button', { name: 'Xóa' }));
    fireEvent.change(screen.getByLabelText(/Lý do xóa/), { target: { value: 'abc' } });
    fireEvent.click(screen.getByRole('button', { name: 'Xóa 2 khách' }));
    expect(await screen.findByText('Lý do cần có ít nhất một chữ hoặc ký tự nhìn thấy được.')).toBeInTheDocument();
    expect(screen.getByLabelText(/Lý do xóa/)).toHaveValue('abc');
  });

  it('quá 200 khách: nút Xóa bị vô hiệu kèm thông báo', () => {
    const ids = Array.from({ length: 201 }, (_, index) => `c-${index}`);
    setup(droppedOf(), ids);
    fireEvent.change(screen.getByLabelText('Hành động hàng loạt'), { target: { value: 'DELETE' } });
    expect(screen.getByRole('alert')).toHaveTextContent('tối đa 200 khách');
    expect(screen.getByRole('button', { name: 'Xóa' })).toBeDisabled();
    expect(bulkOperation).not.toHaveBeenCalled();
  });
});
