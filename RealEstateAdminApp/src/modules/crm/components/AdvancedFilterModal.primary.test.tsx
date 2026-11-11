/** AdvancedFilterModal: nhóm "Phụ trách chính" chỉ khi `isShowingPrimaryFilter` (Quản trị/Quản lý, FR-17). */
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_FILTERS } from '@crm/store/crmReducer';
import { AdvancedFilterModal } from './AdvancedFilterModal';

vi.mock('@crm/api', () => ({
  useCatalogs: () => ({ catalogs: { statuses: [], leadSources: [], areas: [], projects: [], tags: [], contactResults: [] }, users: [], personaFields: [] }),
  useAssigneeFilterOptions: () => [
    { value: 'u1', label: 'Lan' },
    { value: 'u2', label: 'Minh' },
  ],
  useProjectFilterOptions: () => [],
}));

const setup = (isShowingPrimaryFilter?: boolean) => {
  const onApply = vi.fn();
  render(
    <AdvancedFilterModal filters={DEFAULT_FILTERS} variant="sheet" isShowingPrimaryFilter={isShowingPrimaryFilter} onApply={onApply} onReset={vi.fn()} onClose={vi.fn()} />,
  );
  return { onApply };
};

describe('AdvancedFilterModal: bộ lọc "Phụ trách chính"', () => {
  it('mặc định (Nhân viên): không có nhóm "Phụ trách chính"; vẫn có nhóm "Người chăm sóc"', () => {
    setup();
    expect(screen.queryByRole('group', { name: 'Phụ trách chính' })).not.toBeInTheDocument();
    expect(screen.getByRole('group', { name: /Người chăm sóc/ })).toBeInTheDocument();
  });

  it('Quản trị/Quản lý: có nhóm "Phụ trách chính" với danh sách từ customer-assignees; chọn rồi Áp dụng gửi primaryAssigneeIds', () => {
    const { onApply } = setup(true);
    const group = screen.getByRole('group', { name: 'Phụ trách chính' });
    fireEvent.click(within(group).getByRole('button', { name: 'Minh' }));
    fireEvent.click(screen.getByRole('button', { name: /Áp dụng/ }));
    expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ primaryAssigneeIds: ['u2'], assigneeIds: [] }));
  });
});
