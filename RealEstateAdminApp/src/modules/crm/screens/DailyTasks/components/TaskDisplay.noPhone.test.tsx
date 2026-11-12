/** Thẻ/bảng việc hôm nay + thẻ lịch hẹn: khách chưa có SĐT hiển thị bình thường, ẩn Gọi/Zalo (FR-02). */
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { AppointmentView, DailyTask } from '@crm/api';
import { CrmProvider } from '@crm/store/CrmProvider';
import { createCrmStore, createSeedDataState } from '@crm/store/crmStore';
import { FIXED_NOW } from '@crm/test/fixtures';
import { AppointmentCardDesktop } from '../../Appointments/components/AppointmentCardDesktop';
import { AppointmentCardMobile } from '../../Appointments/components/AppointmentCardMobile';
import { TaskCard } from './TaskCard';
import { TaskListTable } from './TaskListTable';

vi.mock('@crm/api', async () => {
  const real = await vi.importActual<typeof import('@crm/api')>('@crm/api');
  return { ...real, useCrmApi: () => ({}) };
});

const status = { id: 's', code: 'NEW', label: 'Mới', tone: 'brand', listGroup: 'NOT_CONTACTED' } as const;

const makeTask = (phoneMasked: string | null): DailyTask => ({
  id: 't1',
  kind: 'APPOINTMENT',
  dueAt: '2026-10-25T08:30:00.000Z',
  group: 'TODAY',
  customer: { id: 'c1', fullName: 'Lê Thị B', phoneMasked, status, projects: [{ id: 'pa', label: "Q'Terra" }] },
  project: null,
  title: 'Xem nhà mẫu',
  lastCareLog: null,
  suggestion: '',
  appointmentId: 'a1',
  assignee: { id: 'u1', displayName: 'Hạnh' },
  isPrimary: true,
});

const makeAppointment = (phoneMasked: string | null): AppointmentView => ({
  id: 'a1',
  customer: { id: 'c1', fullName: 'Lê Thị B', phoneMasked, status },
  type: 'SITE_VISIT',
  title: 'Xem căn tầng 15',
  startAt: '2026-10-26T02:00:00.000Z',
  endAt: null,
  location: 'Văn phòng bán hàng',
  note: '',
  project: null,
  assignee: { id: 'u1', displayName: 'Hạnh' },
  remindBeforeMinutes: [60],
  status: 'SCHEDULED',
  completedAt: null,
  outcome: null,
  createdBy: { id: 'u1', displayName: 'Hạnh' },
  version: 1,
  canDelete: true,
});

const renderWithProviders = (ui: React.ReactElement) => {
  const store = createCrmStore({ initialData: createSeedDataState(FIXED_NOW), shouldPersist: false });
  return render(
    <MemoryRouter>
      <CrmProvider store={store}>{ui}</CrmProvider>
    </MemoryRouter>,
  );
};

describe('khách không SĐT trong Việc hôm nay', () => {
  it('thẻ việc: hiện tên, ẩn Gọi/Zalo, còn Ghi chú/Xem, không "null"', () => {
    const { container } = renderWithProviders(<TaskCard task={makeTask(null)} />);
    expect(screen.getByText('Lê Thị B')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Gọi' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Zalo' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ghi chú' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Xem' })).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/null|undefined/);
  });

  it.each(['', '   '])('thẻ việc: SĐT là chuỗi rỗng/khoảng trắng (%j) cũng ẩn Gọi/Zalo như không có SĐT', (phoneMasked) => {
    renderWithProviders(<TaskCard task={makeTask(phoneMasked)} />);
    expect(screen.queryByRole('button', { name: 'Gọi' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Zalo' })).not.toBeInTheDocument();
  });

  it.each(['', '   '])('bảng việc: SĐT là chuỗi rỗng/khoảng trắng (%j) cũng ẩn Gọi/Zalo', (phoneMasked) => {
    renderWithProviders(<TaskListTable tasks={[makeTask(phoneMasked)]} />);
    expect(screen.queryByRole('button', { name: 'Gọi' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Zalo' })).not.toBeInTheDocument();
  });

  it('thẻ việc có SĐT: vẫn đủ Gọi/Zalo (đối chứng)', () => {
    renderWithProviders(<TaskCard task={makeTask('0912 ••• 678')} />);
    expect(screen.getByRole('button', { name: 'Gọi' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Zalo' })).toBeInTheDocument();
  });

  it('bảng việc: hàng khách không SĐT ẩn Gọi/Zalo, vẫn có Ghi chú nhanh', () => {
    const { container } = renderWithProviders(<TaskListTable tasks={[makeTask(null)]} />);
    expect(screen.getByText('Lê Thị B')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Gọi' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Zalo' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Ghi chú nhanh cho Lê Thị B/ })).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/null|undefined/);
  });
});

describe('khách không SĐT trên thẻ lịch hẹn', () => {
  it.each([
    ['desktop', AppointmentCardDesktop],
    ['mobile', AppointmentCardMobile],
  ])('%s: hiện tên khách và địa điểm, không dòng SĐT, không "null"', (_name, Card) => {
    const { container } = renderWithProviders(<Card appointment={makeAppointment(null)} />);
    expect(screen.getByText(/Lê Thị B/)).toBeInTheDocument();
    expect(screen.getByText(/Văn phòng bán hàng/)).toBeInTheDocument();
    expect(screen.queryByText(/SĐT:/)).not.toBeInTheDocument();
    expect(container.textContent).not.toMatch(/null|undefined/);
  });

  it.each([
    ['desktop', AppointmentCardDesktop],
    ['mobile', AppointmentCardMobile],
  ])('%s: SĐT là chuỗi rỗng/khoảng trắng cũng không hiện dòng SĐT', (_name, Card) => {
    renderWithProviders(<Card appointment={makeAppointment('   ')} />);
    expect(screen.queryByText(/SĐT:/)).not.toBeInTheDocument();
  });
});
