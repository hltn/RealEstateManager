import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { AppointmentView } from '@crm/api';
import { CrmProvider } from '@crm/store/CrmProvider';
import { createCrmStore, createSeedDataState } from '@crm/store/crmStore';
import { FIXED_NOW } from '@crm/test/fixtures';
import { AppointmentCardDesktop } from './AppointmentCardDesktop';
import { AppointmentCardMobile } from './AppointmentCardMobile';
import { UpcomingAppointmentsCard } from './UpcomingAppointmentsCard';

const upcomingState = vi.hoisted(() => ({ items: [] as unknown[] }));

vi.mock('@crm/api', async () => {
  const real = await vi.importActual<typeof import('@crm/api')>('@crm/api');
  return { ...real, useCrmApi: () => ({}), useAppointments: () => ({ data: upcomingState.items }) };
});

const makeAppointment = (project: AppointmentView['project']): AppointmentView => ({
  id: 'a1',
  customer: { id: 'c1', fullName: 'Nguyễn Văn An', status: { id: 's', code: 'NEW', label: 'Mới', tone: 'brand', listGroup: 'NOT_CONTACTED' } },
  type: 'SITE_VISIT',
  title: 'Xem căn tầng 15',
  startAt: '2026-10-26T02:00:00.000Z',
  endAt: null,
  location: 'Văn phòng bán hàng',
  note: '',
  project,
  assignee: { id: 'u1', displayName: 'Hạnh' },
  remindBeforeMinutes: [60],
  status: 'SCHEDULED',
  completedAt: null,
  outcome: null,
  createdBy: { id: 'u1', displayName: 'Hạnh' },
  version: 1,
  canDelete: true,
});

const renderCard = (ui: React.ReactElement) => {
  const store = createCrmStore({ initialData: createSeedDataState(FIXED_NOW), shouldPersist: false });
  return render(
    <MemoryRouter>
      <CrmProvider store={store}>{ui}</CrmProvider>
    </MemoryRouter>,
  );
};

describe('thẻ lịch hẹn hiện dự án của lịch (G7)', () => {
  it.each([
    ['desktop', AppointmentCardDesktop],
    ['mobile', AppointmentCardMobile],
  ])('%s: có dự án thì hiện "Dự án: <tên>"; lịch cũ (null) thì không có dòng dự án', (_name, Card) => {
    const { unmount } = renderCard(<Card appointment={makeAppointment({ id: 'p1', label: "Q'Terra" })} />);
    expect(screen.getByText(/Dự án:/)).toHaveTextContent("Dự án: Q'Terra");
    unmount();

    renderCard(<Card appointment={makeAppointment(null)} />);
    expect(screen.queryByText(/Dự án:/)).toBeNull();
  });
});

describe('thẻ "Lịch sắp tới" (G7)', () => {
  it('hiện dự án của lịch; lịch không gắn dự án thì KHÔNG hiện dự án khách quan tâm', () => {
    const withProject = { ...makeAppointment({ id: 'p1', label: "Q'Terra" }), id: 'a1', startAt: '2026-10-28T02:00:00.000Z' };
    const withoutProject = {
      ...makeAppointment(null),
      id: 'a2',
      startAt: '2026-10-28T03:00:00.000Z',
      customer: { ...makeAppointment(null).customer, fullName: 'Trần Thị Bình', projects: [{ id: 'pz', label: 'Dự án quan tâm' }] },
    };
    upcomingState.items = [withProject, withoutProject];
    renderCard(<UpcomingAppointmentsCard todayIso="2026-10-26" />);
    expect(screen.getByText(/Dự án Q'Terra •/)).toBeInTheDocument();
    expect(screen.queryByText(/Dự án quan tâm/)).toBeNull();
    expect(screen.getByText('Trần Thị Bình')).toBeInTheDocument();
  });
});
