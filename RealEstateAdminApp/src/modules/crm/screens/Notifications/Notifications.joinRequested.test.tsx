/** Thông báo cũ CARE_TEAM_JOIN_REQUESTED (luồng xin tham gia đã bỏ ở v1.0.5): vẫn hiện, nhưng không link, không nút hành động, bấm không điều hướng. */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NotificationItem } from '@crm/api/http/schedulingApi';
import NotificationsScreen from './index';

const fetchNotifications = vi.fn();

vi.mock('@crm/api/http/schedulingApi', async () => {
  const real = await vi.importActual<typeof import('@crm/api/http/schedulingApi')>('@crm/api/http/schedulingApi');
  return { ...real, fetchNotifications: (...args: unknown[]) => fetchNotifications(...args) };
});

const oldItem: NotificationItem = {
  id: 'n-old',
  type: 'CARE_TEAM_JOIN_REQUESTED',
  title: 'Hạnh xin tham gia chăm sóc khách',
  body: 'Có đề nghị tham gia nhóm chăm sóc',
  deepLink: '/crm/care-team-requests',
  customerId: 'abc123',
  priority: 'NORMAL',
  isRead: true,
  createdAt: '2026-11-01T03:00:00.000Z',
};

const Probe = () => <p data-testid="path">{useLocation().pathname}</p>;

beforeEach(() => {
  fetchNotifications.mockReset();
  fetchNotifications.mockResolvedValue({ data: [oldItem], meta: { total: 1, page: 1, limit: 20, totalPages: 1 } });
});

describe('thông báo đề nghị tham gia cũ', () => {
  it('vẫn hiển thị với nhãn cũ, không có link tới màn duyệt và không có nút Duyệt/Từ chối', async () => {
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={['/crm/notifications']}>
          <NotificationsScreen />
          <Probe />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(await screen.findByText('Hạnh xin tham gia chăm sóc khách')).toBeInTheDocument();
    expect(screen.getByText('Đề nghị tham gia')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Hạnh xin tham gia/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /duyệt|từ chối|chấp nhận/i })).toBeNull();

    await userEvent.click(screen.getByText('Hạnh xin tham gia chăm sóc khách'));
    await waitFor(() => expect(screen.getByTestId('path')).toHaveTextContent('/crm/notifications'));
  });
});
