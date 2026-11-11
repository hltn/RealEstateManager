/** AdvancedFilterModal: nhóm "Người phụ trách" (cả dialog desktop lẫn sheet mobile) hiện nhãn "(đã khóa)" và vẫn chọn được người đó để lọc. */
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_FILTERS } from '@crm/store/crmReducer';
import { AdvancedFilterModal, type AdvancedFilterVariant } from './AdvancedFilterModal';

vi.mock('@crm/api', () => ({
  useCatalogs: () => ({ catalogs: { statuses: [], leadSources: [], areas: [], projects: [], tags: [], contactResults: [] }, users: [], personaFields: [] }),
  useAssigneeFilterOptions: () => [
    { value: 'u1', label: 'Lan' },
    { value: 'u2', label: 'Minh (đã khóa)' },
  ],
  useProjectFilterOptions: () => [],
}));

describe.each<AdvancedFilterVariant>(['dialog', 'sheet'])('AdvancedFilterModal (%s) - người phụ trách', (variant) => {
  const setup = () => {
    const onApply = vi.fn();
    render(<AdvancedFilterModal filters={DEFAULT_FILTERS} variant={variant} isShowingPrimaryFilter onApply={onApply} onReset={vi.fn()} onClose={vi.fn()} />);
    return { onApply };
  };

  it('nhóm có tên "Người phụ trách (chính hoặc hỗ trợ)", không còn "Người chăm sóc (chính hoặc hỗ trợ)"', () => {
    setup();
    expect(screen.getByRole('group', { name: 'Người phụ trách (chính hoặc hỗ trợ)' })).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: /Người chăm sóc/ })).not.toBeInTheDocument();
  });

  it('chip người bị khóa mang nhãn "(đã khóa)" và bấm chọn được; Áp dụng gửi đúng id', () => {
    const { onApply } = setup();
    const group = screen.getByRole('group', { name: 'Người phụ trách (chính hoặc hỗ trợ)' });
    const lockedChip = within(group).getByRole('button', { name: 'Minh (đã khóa)' });
    expect(lockedChip).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(lockedChip);
    expect(within(group).getByRole('button', { name: 'Minh (đã khóa)' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(group).getByRole('button', { name: 'Lan' })).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(screen.getByRole('button', { name: /Áp dụng/ }));
    expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ assigneeIds: ['u2'], primaryAssigneeIds: [] }));
  });
});
