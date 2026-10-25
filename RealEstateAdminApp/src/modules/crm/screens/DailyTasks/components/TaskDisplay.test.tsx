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
  customer: { id: 'c1', fullName: 'Nguyễn Văn An', status: { id: 's', code: 'NEW', label: 'Mới', tone: 'brand', listGroup: 'NOT_CONTACTED' }, projects: [{ id: 'pa', label: "Q'Terra" }] },
  project,
  title: 'Xem nhà mẫu',
  lastCareLog: null,
  suggestion: '',
  appointmentId: 'a1',
  assignee: { id: 'u1', displayName: 'Hạnh' },
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
