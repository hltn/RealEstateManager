import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { CrmProvider } from '@crm/store/CrmProvider';
import { createCrmStore, createSeedDataState } from '@crm/store/crmStore';
import { FIXED_NOW } from '@crm/test/fixtures';
import { BulkActionBar } from './BulkActionBar';

const setup = (userId = 'hanh', selectedIds = ['CUST-001']) => {
  const store = createCrmStore({ initialData: createSeedDataState(FIXED_NOW), initialSession: { currentUserId: userId }, shouldPersist: false });
  const onClear = vi.fn();
  render(
    <MemoryRouter>
      <CrmProvider store={store}>
        <BulkActionBar selectedIds={selectedIds} onClear={onClear} />
      </CrmProvider>
    </MemoryRouter>,
  );
  const statusOf = (id: string) => store.getState().state.customers.find((customer) => customer.id === id)?.statusId;
  return { store, onClear, statusOf };
};

const pick = (action: string, value: string) => {
  fireEvent.change(screen.getByLabelText('Hành động hàng loạt'), { target: { value: action } });
  fireEvent.change(screen.getByLabelText('Giá trị áp dụng'), { target: { value } });
  fireEvent.click(screen.getByRole('button', { name: 'Áp dụng' }));
};

describe('C2 BulkActionBar: chuyển sang "Bỏ" phải xác nhận', () => {
  it('chưa xác nhận thì chưa đổi; Huỷ giữ nguyên; Xác nhận mới đổi', () => {
    const { statusOf, onClear } = setup();
    const before = statusOf('CUST-001');
    pick('CHANGE_STATUS', 'st-dropped');
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(statusOf('CUST-001')).toBe(before);

    fireEvent.click(screen.getByRole('button', { name: 'Huỷ' }));
    expect(statusOf('CUST-001')).toBe(before);
    expect(onClear).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Áp dụng' }));
    fireEvent.click(screen.getByRole('button', { name: 'Chuyển sang Bỏ' }));
    expect(statusOf('CUST-001')).toBe('st-dropped');
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it('đổi sang tình trạng không phải "Bỏ" thì áp dụng ngay, không hỏi', () => {
    const { statusOf } = setup();
    const target = statusOf('CUST-001') === 'st-net' ? 'st-interested' : 'st-net';
    pick('CHANGE_STATUS', target);
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(statusOf('CUST-001')).toBe(target);
  });
});

describe('TB3 BulkActionBar chỉ liệt kê người được phép gán', () => {
  it('Quản lý nhóm 1 không thấy nhân viên nhóm 2 trong danh sách người chăm sóc', () => {
    setup('hanh');
    fireEvent.change(screen.getByLabelText('Hành động hàng loạt'), { target: { value: 'ASSIGN' } });
    const options = Array.from(screen.getByLabelText('Giá trị áp dụng').querySelectorAll('option')).map((option) => option.textContent);
    expect(options.join('|')).toContain('Thảo');
    expect(options.join('|')).not.toContain('Tùng');
  });
});
