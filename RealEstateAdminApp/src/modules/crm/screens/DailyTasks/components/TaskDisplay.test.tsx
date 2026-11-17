import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { DailyTask } from '@crm/api';
import { CrmProvider } from '@crm/store/CrmProvider';
import { createCrmStore, createSeedDataState } from '@crm/store/crmStore';
import { FIXED_NOW } from '@crm/test/fixtures';
import { TaskCard } from './TaskCard';
import { TaskListTable } from './TaskListTable';

vi.mock('@crm/api', async () => {
  const real = await vi.importActual<typeof import('@crm/api')>('@crm/api');
  return { ...real, useCrmApi: () => ({}) };
});

const makeTask = (project: DailyTask['project']): DailyTask => ({
  id: 't1',
  kind: 'APPOINTMENT',
  dueAt: '2026-10-25T08:30:00.000Z',
  group: 'TODAY',
  customer: { id: 'c1', fullName: 'Nguyễn Văn An', phoneMasked: '0912 ••• 678', status: { id: 's', code: 'NEW', label: 'Mới', tone: 'brand', listGroup: 'NOT_CONTACTED' }, projects: [{ id: 'pa', label: "Q'Terra" }] },
  project,
  title: 'Xem nhà mẫu',
  lastCareLog: null,
  suggestion: '',
  appointmentId: 'a1',
  assignee: { id: 'u1', displayName: 'Hạnh' },
  assignees: [{ id: 'u1', displayName: 'Hạnh' }],
  isPrimary: true,
});

const renderWithProviders = (ui: React.ReactElement) => {
  const store = createCrmStore({ initialData: createSeedDataState(FIXED_NOW), shouldPersist: false });
  return render(
    <MemoryRouter>
      <CrmProvider store={store}>{ui}</CrmProvider>
    </MemoryRouter>,
  );
};

describe('Việc hôm nay hiện dự án của lịch (G7)', () => {
  it('thẻ: có dự án của lịch thì hiện "Dự án: <tên lịch>" thay vì dự án khách quan tâm; không có thì hiện dự án khách quan tâm', () => {
    const { unmount } = renderWithProviders(<TaskCard task={makeTask({ id: 'pb', label: 'Ecopark' })} />);
    expect(screen.getByText('Dự án: Ecopark')).toBeInTheDocument();
    expect(screen.queryByText("Q'Terra")).toBeNull();
    unmount();

    renderWithProviders(<TaskCard task={makeTask(null)} />);
    expect(screen.getByText("Q'Terra")).toBeInTheDocument();
    expect(screen.queryByText(/Dự án:/)).toBeNull();
  });

  it('bảng: cột dự án theo cùng quy tắc', () => {
    const { unmount } = renderWithProviders(<TaskListTable tasks={[makeTask({ id: 'pb', label: 'Ecopark' })]} />);
    expect(screen.getByText('Dự án: Ecopark')).toBeInTheDocument();
    unmount();

    renderWithProviders(<TaskListTable tasks={[makeTask(null)]} />);
    expect(screen.getByText("Q'Terra")).toBeInTheDocument();
  });
});

describe('Việc hôm nay hiện SĐT đã che (G4)', () => {
  it('thẻ và bảng đều hiện SĐT đã che', () => {
    const { unmount } = renderWithProviders(<TaskCard task={makeTask(null)} />);
    expect(screen.getByText('0912 ••• 678')).toBeInTheDocument();
    unmount();

    renderWithProviders(<TaskListTable tasks={[makeTask(null)]} />);
    expect(screen.getByText('0912 ••• 678')).toBeInTheDocument();
  });
});

describe('Việc lịch hẹn theo cờ backend (FR-30/FR-32, T-59)', () => {
  it('nhiều người thực hiện: thẻ và bảng hiện đủ tên, cách nhau dấu phẩy', () => {
    const task = { ...makeTask(null), assignees: [{ id: 'u1', displayName: 'Hạnh' }, { id: 'u2', displayName: 'Bình' }] };
    const { unmount } = renderWithProviders(<TaskCard task={task} />);
    expect(screen.getByText(/Hạnh, Bình/)).toBeInTheDocument();
    unmount();
    renderWithProviders(<TaskListTable tasks={[task]} />);
    expect(screen.getByText(/Hạnh, Bình/)).toBeInTheDocument();
  });

  it.each([
    [false, 0],
    [true, 1],
    [undefined, 1],
  ])('canEdit=%s: số nút "Hoàn thành" là %i (không suy từ vai trò Quản lý)', (canEdit, expectedCount) => {
    renderWithProviders(<TaskCard task={{ ...makeTask(null), ...(canEdit === undefined ? {} : { canEdit }) }} />);
    expect(screen.queryAllByRole('button', { name: 'Hoàn thành' })).toHaveLength(expectedCount);
  });

  it('việc "Bước tiếp theo" (không có cờ) vẫn có nút "Ghi nhật ký" dù canEdit=false được gán nhầm', () => {
    renderWithProviders(<TaskCard task={{ ...makeTask(null), kind: 'FOLLOW_UP', appointmentId: undefined, canEdit: false }} />);
    expect(screen.getByRole('button', { name: 'Ghi nhật ký' })).toBeInTheDocument();
  });
});
