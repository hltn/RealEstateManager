import { act, fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { CrmProvider } from '@crm/store/CrmProvider';
import { createCrmStore, createSeedDataState } from '@crm/store/crmStore';
import { FIXED_NOW } from '@crm/test/fixtures';
import { ReportsView } from '../Reports/ReportsView';
import { SettingsView } from './SettingsView';

const renderWithStore = (ui: ReactElement, userId = 'admin') => {
  const store = createCrmStore({ initialData: createSeedDataState(FIXED_NOW), initialSession: { currentUserId: userId }, shouldPersist: false });
  render(
    <MemoryRouter initialEntries={['/crm/settings']}>
      <CrmProvider store={store}>{ui}</CrmProvider>
    </MemoryRouter>,
  );
  return store;
};

describe('SettingsView (X7) — dựng với store + API mock thật', () => {
  it('thêm nguồn khách mới -> có trong danh mục dùng chung của store', () => {
    const store = renderWithStore(<SettingsView variant="desktop" />);
    fireEvent.click(screen.getByRole('tab', { name: 'Nguồn khách' }));
    fireEvent.click(screen.getByRole('button', { name: 'Thêm' }));
    fireEvent.change(screen.getByLabelText(/^Tên/), { target: { value: 'Hội chợ BĐS' } });
    fireEvent.click(within(screen.getByRole('form', { name: 'Thêm mục danh mục' })).getByRole('button', { name: 'Thêm' }));
    expect(store.getState().state.catalogs.leadSources.some((source) => source.label === 'Hội chợ BĐS')).toBe(true);
    expect(screen.getByText('Hội chợ BĐS')).toBeInTheDocument();
  });

  it('báo lỗi khi trùng tên và không lưu', () => {
    const store = renderWithStore(<SettingsView variant="mobile" />);
    fireEvent.click(screen.getByRole('tab', { name: 'Khu vực' }));
    const existing = store.getState().state.catalogs.areas[0].name;
    const before = store.getState().state.catalogs.areas.length;
    fireEvent.click(screen.getByRole('button', { name: 'Thêm' }));
    fireEvent.change(screen.getByLabelText(/^Tên/), { target: { value: existing.toLowerCase() } });
    fireEvent.click(within(screen.getByRole('form', { name: 'Thêm mục danh mục' })).getByRole('button', { name: 'Thêm' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Đã có mục');
    expect(store.getState().state.catalogs.areas).toHaveLength(before);
  });

  it('không ẩn được tình trạng duy nhất của danh sách "Có quan tâm"', () => {
    const store = renderWithStore(<SettingsView variant="desktop" />);
    fireEvent.click(screen.getByRole('button', { name: 'Ẩn Có quan tâm' }));
    expect(store.getState().state.catalogs.statuses.find((status) => status.id === 'st-interested')?.isActive).toBe(true);
  });

  it('ẩn tình trạng "Có quan tâm" (khi còn tình trạng khác cùng danh sách) giữ nguyên số khách đang dùng', () => {
    const store = renderWithStore(<SettingsView variant="desktop" />);
    const interested = store.getState().state.catalogs.statuses.find((status) => status.id === 'st-interested')!;
    act(() => {
      store.getState().dispatch({ type: 'catalogs/upsert', kind: 'statuses', item: { ...interested, id: 'st-spare', code: 'SPARE', label: 'Quan tâm cao', isSystem: false } });
    });
    fireEvent.click(screen.getByRole('button', { name: 'Ẩn Có quan tâm' }));
    expect(store.getState().state.catalogs.statuses.find((status) => status.id === 'st-interested')?.isActive).toBe(false);
    expect(store.getState().state.customers.filter((customer) => customer.statusId === 'st-interested').length).toBeGreaterThan(0);
    // Mục ẩn vẫn liệt kê kèm số khách đang dùng (không mất dữ liệu lịch sử) và có thể dùng lại.
    const row = screen.getByRole('button', { name: 'Dùng lại Có quan tâm' }).closest('li') as HTMLElement;
    expect(row).toHaveTextContent('Đã ẩn');
    expect(row).toHaveTextContent(/\d+ khách/);
    fireEvent.click(within(row).getByRole('button', { name: 'Dùng lại Có quan tâm' }));
    expect(store.getState().state.catalogs.statuses.find((status) => status.id === 'st-interested')?.isActive).toBe(true);
  });
});

describe('ReportsView (X6)', () => {
  it('hiển thị tổng khách theo phạm vi và lọc theo người chăm sóc', () => {
    renderWithStore(<ReportsView variant="desktop" />);
    const totalCard = screen.getByText('Tổng khách').closest('div')!.parentElement!;
    expect(within(totalCard).getByText('11')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Người chăm sóc'), { target: { value: 'thao' } });
    expect(within(totalCard).getByText('1')).toBeInTheDocument();
  });
});
