import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { renderCrm, signOut } from '../../../../test/renderCrm';
import NotificationsScreen from './index';

afterEach(signOut);

describe('Thông báo: thông báo cũ về đề nghị tham gia nhóm (đã bỏ ở v1.0.5)', () => {
  it('vẫn hiện nhãn và nội dung, không có liên kết, không có nút duyệt/từ chối, bấm vào không điều hướng', async () => {
    const user = userEvent.setup();
    renderCrm(<NotificationsScreen />, { actAs: 'admin', route: '/notifications' });
    const item = (await screen.findByText('Có đề nghị tham gia nhóm chăm sóc')).closest('li') as HTMLElement;
    expect(within(item).getByText('Đề nghị tham gia')).toBeInTheDocument();
    expect(within(item).queryByRole('link')).not.toBeInTheDocument();
    expect(within(item).queryByRole('button', { name: /duyệt|từ chối|chấp nhận|xem/i })).not.toBeInTheDocument();
    await user.click(within(item).getByRole('button'));
    // Chờ thao tác đánh dấu đã đọc xong (tiêu đề hết in đậm) rồi mới kiểm không điều hướng.
    await waitFor(() => expect(within(item).getByText('Có đề nghị tham gia nhóm chăm sóc')).not.toHaveClass('font-semibold'));
    expect(screen.getByTestId('location')).toHaveTextContent('/notifications');
  });

  it('thông báo còn dùng (lịch hẹn, có khách) vẫn điều hướng khi bấm', async () => {
    const user = userEvent.setup();
    renderCrm(<NotificationsScreen />, { actAs: 'hanh', route: '/notifications' });
    await user.click(await screen.findByRole('button', { name: /Lịch hẹn hôm nay/ }));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/crm/customers/CUST-007'));
  });
});
