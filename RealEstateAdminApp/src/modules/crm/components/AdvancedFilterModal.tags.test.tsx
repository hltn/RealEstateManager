import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { CrmCatalogs } from '@crm/types/crm';
import { DEFAULT_FILTERS } from '@crm/store/crmReducer';
import { AdvancedFilterModal } from './AdvancedFilterModal';

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

vi.mock('@crm/api', () => ({
  useCatalogs: () => ({ catalogs, users: [], personaFields: [] }),
  useAssigneeFilterOptions: () => [],
  useProjectFilterOptions: () => [],
}));

const setup = (tagIds: string[] = []) => {
  const onApply = vi.fn();
  render(<AdvancedFilterModal filters={{ ...DEFAULT_FILTERS, tagIds }} variant="sheet" onApply={onApply} onReset={vi.fn()} onClose={vi.fn()} />);
  return { onApply };
};

describe('AdvancedFilterModal: nhóm thẻ (FR-48)', () => {
  it('thẻ OTHER hiện trong nhóm "Thẻ khác"; thẻ đã tắt không hiện', () => {
    setup();
    const other = screen.getByRole('group', { name: /Thẻ khác/ });
    expect(within(other).getByRole('button', { name: /Khách VIP/ })).toBeInTheDocument();
    expect(screen.queryByText(/Thẻ đã tắt/)).not.toBeInTheDocument();
    expect(within(screen.getByRole('group', { name: /Thẻ sở thích/ })).getByRole('button', { name: /Golf/ })).toBeInTheDocument();
    expect(within(screen.getByRole('group', { name: /Thẻ nghề nghiệp/ })).getByRole('button', { name: /Bác sĩ/ })).toBeInTheDocument();
  });

  it('chọn thẻ OTHER rồi Áp dụng: tagIds gồm thẻ đó', () => {
    const { onApply } = setup(['t-golf']);
    fireEvent.click(within(screen.getByRole('group', { name: /Thẻ khác/ })).getByRole('button', { name: /Khách VIP/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Áp dụng' }));
    expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ tagIds: ['t-golf', 't-vip'] }));
  });
});
