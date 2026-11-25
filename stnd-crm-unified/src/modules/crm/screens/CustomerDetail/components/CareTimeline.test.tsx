import { screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { renderCrm, signOut } from '../../../../../test/renderCrm';
import { CareTimeline } from './CareTimeline';

afterEach(signOut);

describe('CareTimeline: hàng tiêu đề ở cột hẹp (F-2)', () => {
  it('hàng tiêu đề cho phép xuống dòng (flex-wrap), số mục không bị ngắt, tiêu đề cùng hàng với số mục', () => {
    renderCrm(<CareTimeline careLogs={[]} customerId="CUST-001" />, { actAs: 'hanh' });
    const card = screen.getByRole('region', { name: 'Nhật ký chăm sóc' });
    const heading = within(card).getByRole('heading', { level: 3, name: 'Nhật ký chăm sóc' });
    const row = heading.closest('div.flex.justify-between') as HTMLElement;
    expect(row).toHaveClass('flex-wrap');
    const count = within(row).getByText('0 mục');
    expect(count).toHaveClass('whitespace-nowrap');
  });
});
