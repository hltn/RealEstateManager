import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { CustomerDetail } from '@crm/api';
import { CriteriaBoard } from './CriteriaBoard';

vi.mock('../useCustomerDetailActions', () => ({
  useCustomerDetailActions: () => ({ toggleCriterion: vi.fn(), saveCriterionDescription: vi.fn() }),
}));

const emptyCriterion = { isDone: false, description: '', updatedAt: null, updatedBy: null };
const customer = {
  id: 'c1',
  progress: 0,
  criteriaDone: 0,
  criteria: { demand: emptyCriterion, motivation: emptyCriterion, finance: emptyCriterion, timing: emptyCriterion },
} as unknown as CustomerDetail;

describe('CriteriaBoard: hàng tiêu đề "Tiến độ" giữ nguyên một hàng (F-2 chỉ áp cho Nhật ký chăm sóc)', () => {
  it('chấm tiến độ nằm CÙNG hàng bên phải tiêu đề và hàng không bật flex-wrap', () => {
    render(<CriteriaBoard customer={customer} />);
    const heading = screen.getByRole('heading', { name: 'Tiến độ' });
    const row = heading.closest('div.flex.justify-between') as HTMLElement;
    expect(row).not.toHaveClass('flex-wrap');
    expect(row).toHaveClass('gap-3');
    expect(row).toHaveTextContent('0%');
  });
});
