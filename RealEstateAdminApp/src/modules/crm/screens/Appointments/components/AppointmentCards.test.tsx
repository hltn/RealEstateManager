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
  customer: { id: 'c1', fullName: 'Nguyễn Văn An', phoneMasked: '0912 ••• 678', status: { id: 's', code: 'NEW', label: 'Mới', tone: 'brand', listGroup: 'NOT_CONTACTED' } },
  type: 'SITE_VISIT',
  title: 'Xem căn tầng 15',
  startAt: '2026-10-26T02:00:00.000Z',
  endAt: null,
  location: 'Văn phòng bán hàng',
  note: '',
  project,
  assignee: { id: 'u1', displayName: 'Hạnh' },
  assignees: [{ id: 'u1', displayName: 'Hạnh' }],
  remindBeforeMinutes: [60],
  status: 'SCHEDULED',
  completedAt: null,
  outcome: null,
  createdBy: { id: 'u1', displayName: 'Hạnh' },
  version: 1,
  canEdit: true,
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

describe('thẻ lịch hẹn hiện SĐT đã che (G4)', () => {
  it.each([
    ['desktop', AppointmentCardDesktop],
    ['mobile', AppointmentCardMobile],
  ])('%s: hiện SĐT đã che; chuỗi rỗng (khách dữ liệu cũ) thì ẩn dòng SĐT', (_name, Card) => {
    const { unmount } = renderCard(<Card appointment={makeAppointment(null)} />);
    expect(screen.getByText('0912 ••• 678')).toBeInTheDocument();
    unmount();

    const noPhone = makeAppointment(null);
    renderCard(<Card appointment={{ ...noPhone, customer: { ...noPhone.customer, phoneMasked: '' } }} />);
    expect(screen.queryByText(/SĐT:/)).toBeNull();
  });
});

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

describe('thẻ lịch hẹn: nút đổi trạng thái hoàn thành theo cờ canEdit (FR-32)', () => {
  const COMPLETE_BUTTON_NAME = /Xác nhận hoàn thành|Hoàn tác xác nhận|Đã liên hệ xong|Hoàn tác liên hệ/;
  const withEdit = (type: AppointmentView['type'], canEdit: boolean, status: AppointmentView['status'] = 'SCHEDULED'): AppointmentView => ({
    ...makeAppointment(null),
    type,
    status,
    canEdit,
    canDelete: canEdit,
    // Người tạo lịch KHÔNG liên quan tới việc hiện nút: nút chỉ theo cờ BE (kiểm bằng cùng createdBy ở cả hai ca).
    createdBy: { id: 'u1', displayName: 'Hạnh' },
  });

  it.each([
    ['desktop', AppointmentCardDesktop, 'DEPOSIT_CONTRACT', 'Xác nhận hoàn thành'],
    ['desktop', AppointmentCardDesktop, 'CALLBACK', 'Đã liên hệ xong'],
    ['mobile', AppointmentCardMobile, 'DEPOSIT_CONTRACT', 'Xác nhận hoàn thành'],
  ] as const)('%s, loại %s: canEdit=false thì KHÔNG có nút "%s"; canEdit=true thì có', (_name, Card, type, label) => {
    const denied = renderCard(<Card appointment={withEdit(type, false)} />);
    expect(screen.queryByRole('button', { name: COMPLETE_BUTTON_NAME })).toBeNull();
    denied.unmount();

    renderCard(<Card appointment={withEdit(type, true)} />);
    expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
  });

  it.each([
    ['desktop', AppointmentCardDesktop, 'DEPOSIT_CONTRACT', 'Hoàn tác xác nhận'],
    ['desktop', AppointmentCardDesktop, 'CALLBACK', 'Hoàn tác liên hệ'],
    ['mobile', AppointmentCardMobile, 'DEPOSIT_CONTRACT', 'Hoàn tác xác nhận'],
  ] as const)('%s, loại %s đã hoàn thành: nút "%s" cũng theo canEdit', (_name, Card, type, label) => {
    const denied = renderCard(<Card appointment={withEdit(type, false, 'DONE')} />);
    expect(screen.queryByRole('button', { name: COMPLETE_BUTTON_NAME })).toBeNull();
    denied.unmount();

    renderCard(<Card appointment={withEdit(type, true, 'DONE')} />);
    expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
  });

  it.each([
    ['desktop', AppointmentCardDesktop, 'DEPOSIT_CONTRACT', /Ghi chú cọc/],
    ['desktop', AppointmentCardDesktop, 'CALLBACK', /Gọi ngay cho khách/],
    ['mobile', AppointmentCardMobile, 'DEPOSIT_CONTRACT', /Xem chi tiết/],
    ['mobile', AppointmentCardMobile, 'CALLBACK', /Gọi ngay cho khách/],
  ] as const)('%s, loại %s: người không có quyền sửa vẫn thấy nút xem/gọi %s', (_name, Card, type, label) => {
    renderCard(<Card appointment={withEdit(type, false)} />);
    expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
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
