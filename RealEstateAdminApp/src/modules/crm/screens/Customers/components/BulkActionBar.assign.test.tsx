/** "Thêm thành viên" hàng loạt (v1.0.5): chỉ mời MEMBER, không đặt PRIMARY hàng loạt, báo kết quả theo từng khách. */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CareTeamInvitee, CustomerListItem } from '@crm/api';
import type { CrmCatalogs } from '@crm/types/crm';
import { CrmProvider } from '@crm/store/CrmProvider';
import { createCrmStore, createSeedDataState } from '@crm/store/crmStore';
import { FIXED_NOW } from '@crm/test/fixtures';
import { BulkActionBar } from './BulkActionBar';

const bulkOperation = vi.fn();
const useCareTeamInvitees = vi.fn();
const actor = { current: { userId: 'admin', role: 'ADMIN' as 'ADMIN' | 'MANAGER' | 'STAFF', teamId: null as string | null, managedTeamIds: [] as string[] } };
const emptyCatalogs: CrmCatalogs = { statuses: [], leadSources: [], areas: [], projects: [], tags: [], contactResults: [] };

vi.mock('@crm/api', async () => {
  const real = await vi.importActual<typeof import('@crm/api')>('@crm/api');
  return {
    ...real,
    useCrmApi: () => ({ bulkOperation }),
    useCatalogs: () => ({ catalogs: emptyCatalogs, users: [] }),
    useCareTeamInvitees: (...args: unknown[]) => useCareTeamInvitees(...args),
    useCrmActor: () => actor.current,
  };
});

const invitees: CareTeamInvitee[] = [
  { id: 'u1', displayName: 'Hạnh', teamNames: ['Nhóm A'] },
  { id: 'u2', displayName: 'Minh', teamNames: [] },
];
const names: Record<string, string> = { 'c-1': 'Khách Một', 'c-2': 'Khách Hai', 'c-3': 'Khách Ba' };
const getCustomer = (id: string) => ({ id, fullName: names[id], status: { id: 'S', listGroup: 'INTERESTED' }, primaryAssignee: null }) as unknown as CustomerListItem;

const setup = (selectedIds = ['c-1', 'c-2', 'c-3']) => {
  const store = createCrmStore({ initialData: createSeedDataState(FIXED_NOW), initialSession: { currentUserId: 'admin' }, shouldPersist: false });
  const onClear = vi.fn();
  const onDeselect = vi.fn();
  const tree = (ids: string[]) => (
    <MemoryRouter>
      <CrmProvider store={store}>
        <BulkActionBar selectedIds={ids} onClear={onClear} onDeselect={onDeselect} onDeleteResult={vi.fn()} getCustomer={getCustomer} />
      </CrmProvider>
    </MemoryRouter>
  );
  const view = render(tree(selectedIds));
  return { onClear, onDeselect, changeSelection: (ids: string[]) => view.rerender(tree(ids)) };
};

const openAssign = () => fireEvent.change(screen.getByLabelText('Hành động hàng loạt'), { target: { value: 'ASSIGN' } });

beforeEach(() => {
  bulkOperation.mockReset();
  useCareTeamInvitees.mockReset();
  useCareTeamInvitees.mockReturnValue({ data: { data: invitees, meta: { total: 2, page: 1, limit: 20, totalPages: 1 } }, isLoading: false, isFetching: false, isError: false, error: null, refetch: vi.fn() });
  actor.current = { userId: 'admin', role: 'ADMIN', teamId: null, managedTeamIds: [] };
});

describe('BulkActionBar - Thêm thành viên', () => {
  it('nhãn "Thêm thành viên"; không còn lựa chọn đặt/đổi người chăm sóc chính', () => {
    setup();
    const labels = Array.from(screen.getByLabelText('Hành động hàng loạt').querySelectorAll('option')).map((option) => option.textContent ?? '');
    expect(labels).toContain('Thêm thành viên');
    expect(labels.join('|')).not.toMatch(/chính|phụ trách|PRIMARY|Thêm người chăm sóc/i);
    openAssign();
    expect(screen.queryByLabelText('Giá trị áp dụng')).toBeNull();
    expect(screen.queryByRole('radio')).toBeNull();
  });

  it('Staff không thấy "Thêm thành viên"', () => {
    actor.current = { userId: 'u1', role: 'STAFF', teamId: 't', managedTeamIds: [] };
    setup();
    const labels = Array.from(screen.getByLabelText('Hành động hàng loạt').querySelectorAll('option')).map((option) => option.textContent);
    expect(labels).not.toContain('Thêm thành viên');
  });

  it('picker bỏ customerId (hàng loạt) và gửi payload chỉ có memberIds (không primaryUserId)', async () => {
    bulkOperation.mockResolvedValue({ ok: true, data: { succeeded: ['c-1', 'c-2', 'c-3'], failed: [] } });
    const { onClear } = setup();
    openAssign();
    expect(useCareTeamInvitees).toHaveBeenCalledWith(undefined, '', 1);
    fireEvent.click(screen.getByRole('checkbox', { name: /Hạnh/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Minh/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Áp dụng' }));
    await waitFor(() => expect(bulkOperation).toHaveBeenCalledWith({ type: 'ASSIGN', customerIds: ['c-1', 'c-2', 'c-3'], memberIds: ['u1', 'u2'] }));
    expect(bulkOperation.mock.calls[0][0]).not.toHaveProperty('primaryUserId');
    await waitFor(() => expect(onClear).toHaveBeenCalledTimes(1));
  });

  it('kết quả theo từng khách: khách đủ 10 / chưa có PRIMARY được báo riêng, khách thành công bị bỏ chọn, khách lỗi giữ chọn', async () => {
    bulkOperation.mockResolvedValue({
      ok: true,
      data: { succeeded: ['c-1'], failed: [{ customerId: 'c-2', errorCode: 'CARE_TEAM_LIMIT_EXCEEDED' }, { customerId: 'c-3', errorCode: 'PRIMARY_REQUIRED' }] },
    });
    const { onClear, onDeselect } = setup();
    openAssign();
    fireEvent.click(screen.getByRole('checkbox', { name: /Hạnh/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Áp dụng' }));
    const report = await screen.findByRole('region', { name: 'Khách không thêm được thành viên' });
    expect(within(report).getByText('2 khách không thêm được thành viên:')).toBeInTheDocument();
    expect(within(report).getByText('Khách Hai').closest('li')).toHaveTextContent('nhóm đã đủ 10 thành viên phụ');
    expect(within(report).getByText('Khách Ba').closest('li')).toHaveTextContent('chưa có người chăm sóc chính');
    expect(onDeselect).toHaveBeenCalledWith(['c-1']);
    expect(onClear).not.toHaveBeenCalled();
  });

  it('khách không còn trong phạm vi (CUSTOMER_NOT_FOUND) cũng bị bỏ chọn', async () => {
    bulkOperation.mockResolvedValue({ ok: true, data: { succeeded: [], failed: [{ customerId: 'c-1', errorCode: 'CUSTOMER_NOT_FOUND' }] } });
    const { onDeselect } = setup(['c-1']);
    openAssign();
    fireEvent.click(screen.getByRole('checkbox', { name: /Minh/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Áp dụng' }));
    await waitFor(() => expect(onDeselect).toHaveBeenCalledWith(['c-1']));
  });

  it('đổi hành động xoá kết quả lỗi cũ', async () => {
    bulkOperation.mockResolvedValue({ ok: true, data: { succeeded: [], failed: [{ customerId: 'c-2', errorCode: 'PRIMARY_REQUIRED' }] } });
    setup();
    openAssign();
    fireEvent.click(screen.getByRole('checkbox', { name: /Hạnh/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Áp dụng' }));
    await screen.findByRole('region', { name: 'Khách không thêm được thành viên' });
    fireEvent.change(screen.getByLabelText('Hành động hàng loạt'), { target: { value: 'CHANGE_STATUS' } });
    expect(screen.queryByRole('region', { name: 'Khách không thêm được thành viên' })).toBeNull();
  });

  describe('báo cáo lỗi không bị sót lại', () => {
    const REGION = 'Khách không thêm được thành viên';
    const failOnce = () =>
      bulkOperation.mockResolvedValue({
        ok: true,
        data: { succeeded: [], failed: [{ customerId: 'c-2', errorCode: 'PRIMARY_REQUIRED' }, { customerId: 'c-3', errorCode: 'CUSTOMER_NOT_FOUND' }] },
      });

    it('đổi lựa chọn người trong picker xoá báo cáo cũ', async () => {
      failOnce();
      setup();
      openAssign();
      fireEvent.click(screen.getByRole('checkbox', { name: /Hạnh/ }));
      fireEvent.click(screen.getByRole('button', { name: 'Áp dụng' }));
      await screen.findByRole('region', { name: REGION });
      fireEvent.click(screen.getByRole('checkbox', { name: /Minh/ }));
      expect(screen.queryByRole('region', { name: REGION })).toBeNull();
    });

    it('bỏ chọn khách lỗi (đã sửa/bỏ tay) thì khách đó biến khỏi báo cáo; khách không còn trong phạm vi vẫn giữ', async () => {
      failOnce();
      const { changeSelection } = setup();
      openAssign();
      fireEvent.click(screen.getByRole('checkbox', { name: /Hạnh/ }));
      fireEvent.click(screen.getByRole('button', { name: 'Áp dụng' }));
      const report = await screen.findByRole('region', { name: REGION });
      expect(within(report).getByText('Khách Hai')).toBeInTheDocument();
      changeSelection(['c-1']);
      const after = screen.getByRole('region', { name: REGION });
      expect(within(after).queryByText('Khách Hai')).toBeNull();
      expect(within(after).getByText('Khách Ba')).toBeInTheDocument();
    });

    it('đổi hành động rồi quay lại "Thêm thành viên": không còn báo cáo cũ', async () => {
      failOnce();
      setup();
      openAssign();
      fireEvent.click(screen.getByRole('checkbox', { name: /Hạnh/ }));
      fireEvent.click(screen.getByRole('button', { name: 'Áp dụng' }));
      await screen.findByRole('region', { name: REGION });
      fireEvent.change(screen.getByLabelText('Hành động hàng loạt'), { target: { value: 'CHANGE_STATUS' } });
      openAssign();
      expect(screen.queryByRole('region', { name: REGION })).toBeNull();
    });
  });
});
