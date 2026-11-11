import { screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { renderCrm, signOut } from '../../../../test/renderCrm';
import { composeMutations, withLockedUser, withoutPhone } from '../../../../test/crmHarness';
import DailyTasksDesktop from './DailyTasks.desktop';
import DailyTasksMobile from './DailyTasks.mobile';

afterEach(signOut);

describe('Việc hôm nay: khách chưa có SĐT', () => {
  it.each([
    ['desktop', DailyTasksDesktop],
    ['mobile', DailyTasksMobile],
  ] as const)('(%s) việc của khách chưa có SĐT vẫn hiện bình thường, không có nút Gọi/Zalo', (_name, Component) => {
    renderCrm(<Component />, { actAs: 'hanh', mutate: withoutPhone('CUST-001') });
    const cards = screen.getAllByText('Nguyễn Văn An');
    expect(cards.length).toBeGreaterThan(0);
    const card = cards[0].closest('article');
    expect(card).not.toBeNull();
    expect(within(card as HTMLElement).queryByRole('button', { name: /^Gọi$/ })).not.toBeInTheDocument();
    expect(within(card as HTMLElement).queryByRole('button', { name: /^Zalo$/ })).not.toBeInTheDocument();
    expect(within(card as HTMLElement).getByRole('button', { name: /Ghi chú/ })).toBeInTheDocument();
  });

  it('khách có SĐT: thẻ việc có nút Gọi và Zalo', () => {
    renderCrm(<DailyTasksDesktop />, { actAs: 'hanh' });
    const card = screen.getAllByText('Nguyễn Văn An')[0].closest('article') as HTMLElement;
    expect(within(card).getByRole('button', { name: /^Gọi$/ })).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: /^Zalo$/ })).toBeInTheDocument();
  });
});

describe('Việc hôm nay: ô lọc người phụ trách (nhãn "Người phụ trách" theo doc T-26, chế độ cả nhóm) lấy từ customer-assignees', () => {
  it('có đủ người trong nhóm chăm sóc của khách mình thấy, người bị khóa kèm "(đã khóa)"', () => {
    renderCrm(<DailyTasksDesktop />, { actAs: 'admin', mutate: composeMutations(withLockedUser('thao')) });
    const select = screen.getByLabelText('Người phụ trách');
    const labels = within(select).getAllByRole('option').map((option) => option.textContent ?? '');
    expect(labels.some((label) => label.endsWith('(đã khóa)'))).toBe(true);
    expect(labels.filter((label) => label.endsWith('(đã khóa)'))).toHaveLength(1);
    expect(labels[0]).toBe('Tất cả');
    expect(labels.length).toBeGreaterThan(2);
  });
});
