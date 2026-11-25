/** Dòng "Phụ trách" bị `truncate` thì phải có `title` đủ chuỗi để rê chuột xem (F-3, FR-30): 2 thẻ lịch hẹn, "Lịch sắp tới", khối lịch trong chi tiết khách. */
import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppointmentView } from '@crm/api';
import { renderCrm, signOut } from '../../../../../test/renderCrm';
import { UpcomingAppointmentsSection } from '../../CustomerDetail/components/UpcomingAppointmentsSection';
import { AppointmentCardDesktop } from './AppointmentCardDesktop';
import { AppointmentCardMobile } from './AppointmentCardMobile';
import { UpcomingAppointmentsCard } from './UpcomingAppointmentsCard';

const state = vi.hoisted(() => ({ items: [] as unknown[] }));

vi.mock('@crm/api', async () => {
  const real = await vi.importActual<typeof import('@crm/api')>('@crm/api');
  return { ...real, useAppointments: () => ({ data: state.items, isLoading: false, error: null }) };
});

afterEach(signOut);

const HANH = { id: 'u1', displayName: 'Hạnh' };
const MINH = { id: 'u2', displayName: 'Minh' };
const LONG_NAMES = [HANH, MINH, { id: 'u3', displayName: 'Nguyễn Thị Thanh Thảo Nguyên' }];
const LONG_LINE = 'Phụ trách: Hạnh, Minh, Nguyễn Thị Thanh Thảo Nguyên';

const makeAppointment = (overrides: Partial<AppointmentView> = {}): AppointmentView =>
  ({
    id: 'a1',
    customer: { id: 'c1', fullName: 'Nguyễn Văn An', phoneMasked: '0912 ••• 678', status: { id: 's', code: 'NEW', label: 'Mới', tone: 'brand', listGroup: 'NOT_CONTACTED' } },
    type: 'SITE_VISIT',
    title: 'Xem căn tầng 15',
    startAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(),
    endAt: null,
    location: 'Văn phòng bán hàng',
    note: '',
    project: null,
    assignees: [HANH],
    status: 'SCHEDULED',
    canEdit: true,
    canDelete: true,
    ...overrides,
  }) as unknown as AppointmentView;

describe.each([
  ['desktop', AppointmentCardDesktop],
  ['mobile', AppointmentCardMobile],
])('Thẻ lịch hẹn (%s): title của dòng "Phụ trách"', (_name, Card) => {
  it.each([
    ['1 người', [HANH], 'Phụ trách: Hạnh'],
    ['nhiều người, tên dài', LONG_NAMES, LONG_LINE],
    ['danh sách rỗng', [], 'Phụ trách: —'],
  ] as const)('%s: title khớp đủ chuỗi, vẫn giữ truncate', (_label, assignees, expected) => {
    renderCrm(<Card appointment={makeAppointment({ assignees: [...assignees] })} />, { actAs: 'hanh' });
    const line = screen.getByText(/Phụ trách:/);
    expect(line).toHaveAttribute('title', expected);
    expect(line).toHaveClass('truncate');
  });
});

describe('"Lịch sắp tới" (UpcomingAppointmentsCard)', () => {
  it('title là cả dòng: có tiền tố dự án khi lịch gắn dự án, không có khi không gắn', () => {
    // Ngày cố định (không theo đồng hồ máy) để lịch luôn nằm trong tuần của "hôm nay".
    const startAt = '2026-10-28T02:00:00.000Z';
    state.items = [
      makeAppointment({ id: 'a1', startAt, project: { id: 'p1', label: "Q'Terra" }, assignees: LONG_NAMES }),
      makeAppointment({ id: 'a2', startAt, assignees: [] }),
    ];
    renderCrm(<UpcomingAppointmentsCard todayIso="2026-10-26" />, { actAs: 'hanh' });
    const withProject = screen.getByText(/Dự án Q'Terra •/);
    expect(withProject).toHaveAttribute('title', `Dự án Q'Terra • ${LONG_LINE}`);
    expect(withProject).toHaveTextContent(`Dự án Q'Terra • ${LONG_LINE}`);
    const withoutProject = screen.getByText('Phụ trách: —');
    expect(withoutProject).toHaveAttribute('title', 'Phụ trách: —');
    expect(withoutProject).toHaveClass('truncate');
  });
});

describe('Khối "Lịch hẹn sắp tới" trong chi tiết khách (UpcomingAppointmentsSection)', () => {
  it('title khớp đủ chuỗi cho 1 người, nhiều người, danh sách rỗng; vẫn giữ truncate', () => {
    state.items = [makeAppointment({ id: 'a1', assignees: [HANH] }), makeAppointment({ id: 'a2', assignees: LONG_NAMES }), makeAppointment({ id: 'a3', assignees: [] })];
    renderCrm(<UpcomingAppointmentsSection customerId="c1" />, { actAs: 'hanh' });
    const one = screen.getByText('Phụ trách: Hạnh');
    expect(one).toHaveAttribute('title', 'Phụ trách: Hạnh');
    expect(one).toHaveClass('truncate');
    expect(screen.getByText(LONG_LINE)).toHaveAttribute('title', LONG_LINE);
    expect(screen.getByText('Phụ trách: —')).toHaveAttribute('title', 'Phụ trách: —');
  });
});
