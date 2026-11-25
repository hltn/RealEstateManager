import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { AppointmentView } from '@crm/api';
import { UpcomingAppointmentsSection } from './UpcomingAppointmentsSection';

const appointmentsState = vi.hoisted(() => ({ items: [] as unknown[] }));

vi.mock('@crm/api', async () => {
  const real = await vi.importActual<typeof import('@crm/api')>('@crm/api');
  return { ...real, useAppointments: () => ({ data: appointmentsState.items, isLoading: false, error: null }) };
});

const HANH = { id: 'u1', displayName: 'Hạnh' };
const MINH = { id: 'u2', displayName: 'Minh' };

/** Lịch SCHEDULED nằm trong tương lai (2 ngày tới) để chắc chắn qua bộ lọc "sắp tới". */
const makeUpcoming = (id: string, assignees: AppointmentView['assignees']) =>
  ({
    id,
    type: 'SITE_VISIT',
    status: 'SCHEDULED',
    startAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(),
    location: 'Văn phòng bán hàng',
    project: null,
    assignees,
  }) as unknown as AppointmentView;

describe('UpcomingAppointmentsSection: dòng "Phụ trách" bị cắt thì có title đủ (F-3, FR-30)', () => {
  it('title khớp đủ chuỗi cho 1 người, nhiều người, danh sách rỗng; vẫn giữ truncate', () => {
    appointmentsState.items = [makeUpcoming('a1', [HANH]), makeUpcoming('a2', [HANH, MINH, { id: 'u3', displayName: 'Nguyễn Thị Thanh Thảo Nguyên' }]), makeUpcoming('a3', [])];
    render(<UpcomingAppointmentsSection customerId="c1" />);

    const one = screen.getByText('Phụ trách: Hạnh');
    expect(one).toHaveAttribute('title', 'Phụ trách: Hạnh');
    expect(one).toHaveClass('truncate');

    const many = screen.getByText('Phụ trách: Hạnh, Minh, Nguyễn Thị Thanh Thảo Nguyên');
    expect(many).toHaveAttribute('title', 'Phụ trách: Hạnh, Minh, Nguyễn Thị Thanh Thảo Nguyên');

    const empty = screen.getByText('Phụ trách: —');
    expect(empty).toHaveAttribute('title', 'Phụ trách: —');
  });
});
