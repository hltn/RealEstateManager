/**
 * FR-32 (T-59): nút Đánh dấu hoàn thành / Đổi giờ / Hủy của thẻ lịch hẹn theo cờ `canEdit` của backend
 * (người tạo lịch hoặc Quản trị), KHÔNG theo vai trò Quản lý.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { AppointmentView } from '@crm/api';
import { CrmProvider } from '@crm/store/CrmProvider';
import { createCrmStore, createSeedDataState } from '@crm/store/crmStore';
import { FIXED_NOW } from '@crm/test/fixtures';
import { AppointmentMoreMenu } from './AppointmentMoreMenu';

vi.mock('@crm/api', async () => {
  const real = await vi.importActual<typeof import('@crm/api')>('@crm/api');
  return { ...real, useCrmApi: () => ({}) };
});

const makeAppointment = (overrides: Partial<AppointmentView>): AppointmentView => ({
  id: 'a1',
  customer: { id: 'c1', fullName: 'Nguyễn Văn An', phoneMasked: '0912 ••• 678', status: { id: 's', code: 'NEW', label: 'Mới', tone: 'brand', listGroup: 'NOT_CONTACTED' } },
  type: 'SITE_VISIT',
  title: 'Xem căn tầng 15',
  startAt: '2026-10-26T02:00:00.000Z',
  endAt: null,
  location: 'Văn phòng bán hàng',
  note: '',
  project: null,
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
  ...overrides,
});

const openMenu = async (appointment: AppointmentView) => {
  const store = createCrmStore({ initialData: createSeedDataState(FIXED_NOW), shouldPersist: false });
  render(
    <MemoryRouter>
      <CrmProvider store={store}>
        <AppointmentMoreMenu appointment={appointment} />
      </CrmProvider>
    </MemoryRouter>,
  );
  await userEvent.click(screen.getByRole('button', { name: 'Thao tác khác' }));
};

describe('AppointmentMoreMenu theo cờ canEdit (FR-32)', () => {
  it('canEdit=true, lịch đang chờ: có Đánh dấu hoàn thành, Đổi giờ, Hủy lịch hẹn', async () => {
    await openMenu(makeAppointment({ canEdit: true }));
    expect(screen.getByText('Đánh dấu hoàn thành')).toBeInTheDocument();
    expect(screen.getByText('Đổi giờ')).toBeInTheDocument();
    expect(screen.getByText('Hủy lịch hẹn')).toBeInTheDocument();
  });

  it('canEdit=false (vd Manager nhóm chủ không phải người tạo lịch): ẩn cả ba, vẫn còn Xem hồ sơ / Ghi chú nhanh / Nhắn Zalo', async () => {
    await openMenu(makeAppointment({ canEdit: false }));
    expect(screen.queryByText('Đánh dấu hoàn thành')).toBeNull();
    expect(screen.queryByText('Đổi giờ')).toBeNull();
    expect(screen.queryByText('Hủy lịch hẹn')).toBeNull();
    expect(screen.getByText('Xem hồ sơ khách')).toBeInTheDocument();
    expect(screen.getByText('Ghi chú nhanh')).toBeInTheDocument();
    expect(screen.getByText('Nhắn Zalo')).toBeInTheDocument();
  });

  it('canEdit=true nhưng lịch đã xong: chỉ có Bỏ đánh dấu hoàn thành, không Đổi giờ/Hủy', async () => {
    await openMenu(makeAppointment({ canEdit: true, status: 'DONE' }));
    expect(screen.getByText('Bỏ đánh dấu hoàn thành')).toBeInTheDocument();
    expect(screen.queryByText('Đổi giờ')).toBeNull();
    expect(screen.queryByText('Hủy lịch hẹn')).toBeNull();
  });
});
