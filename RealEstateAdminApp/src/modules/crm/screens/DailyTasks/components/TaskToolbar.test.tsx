/** Thanh lọc Việc hôm nay: nhãn ô lọc người phụ trách (doc T-26) chỉ có ở chế độ cả nhóm. */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_TASK_FILTERS } from '../taskFilters';
import { TaskToolbar } from './TaskToolbar';

const renderToolbar = (scope: 'mine' | 'team', onFiltersChange = vi.fn()) =>
  render(
    <TaskToolbar
      filters={DEFAULT_TASK_FILTERS}
      onFiltersChange={onFiltersChange}
      onReset={vi.fn()}
      projects={[]}
      assignees={[{ value: 'u1', label: 'Hạnh' }]}
      scope={scope}
      canSeeTeam
      onScopeChange={vi.fn()}
      viewMode="list"
      onViewModeChange={vi.fn()}
    />,
  );

describe('TaskToolbar - ô lọc người phụ trách', () => {
  it('chế độ cả nhóm: nhãn "Người phụ trách" (không còn "Người thực hiện") và chọn được người', () => {
    const onFiltersChange = vi.fn();
    renderToolbar('team', onFiltersChange);
    const select = screen.getByLabelText('Người phụ trách');
    expect(screen.queryByText('Người thực hiện')).toBeNull();
    fireEvent.change(select, { target: { value: 'u1' } });
    expect(onFiltersChange).toHaveBeenCalledWith({ assigneeId: 'u1' });
  });

  it('chế độ "Việc của tôi": không có ô lọc người phụ trách', () => {
    renderToolbar('mine');
    expect(screen.queryByLabelText('Người phụ trách')).toBeNull();
  });
});
