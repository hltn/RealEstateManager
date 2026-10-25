import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Project } from '@crm/types/crm';
import { CrmProvider } from '@crm/store/CrmProvider';
import { createCrmStore, createSeedDataState } from '@crm/store/crmStore';
import { FIXED_NOW } from '@crm/test/fixtures';
import { ProjectsView } from './ProjectsView';

const project = (overrides: Partial<Project>): Project => ({
  id: 'p1',
  code: 'QT',
  name: "Q'Terra",
  fullName: "Q'Terra",
  developer: '',
  location: '',
  areaId: null,
  propertyTypes: [],
  priceFrom: null,
  priceTo: null,
  priceUnit: 'TOTAL',
  status: 'SELLING',
  segment: '',
  isActive: true,
  deletedAt: null,
  ...overrides,
});

const api = { updateProject: vi.fn(), deleteProject: vi.fn(), restoreProject: vi.fn(), createProject: vi.fn() };
const state = {
  role: 'ADMIN' as 'ADMIN' | 'STAFF',
  projects: [] as Project[],
  deleted: [] as Project[],
  counts: new Map<string, number>(),
};

vi.mock('@crm/api', async () => {
  const real = await vi.importActual<typeof import('@crm/api')>('@crm/api');
  return {
    ...real,
    useCrmApi: () => api,
    useCrmActor: () => ({ userId: 'u', role: state.role, teamId: null, managedTeamIds: [] }),
    useCatalogs: () => ({ catalogs: { statuses: [], leadSources: [], areas: [], projects: state.projects, tags: [], contactResults: [] }, users: [] }),
    useProjectsWithCounts: () => ({ data: state.counts }),
    useDeletedProjects: () => ({ data: state.deleted }),
  };
});

const setup = () => {
  const store = createCrmStore({ initialData: createSeedDataState(FIXED_NOW), shouldPersist: false });
  render(
    <MemoryRouter>
      <CrmProvider store={store}>
        <ProjectsView variant="desktop" />
      </CrmProvider>
    </MemoryRouter>,
  );
};

beforeEach(() => {
  Object.values(api).forEach((fn) => fn.mockReset());
  state.role = 'ADMIN';
  state.projects = [project({})];
  state.deleted = [];
  state.counts = new Map();
});

describe('ProjectsView (API thật)', () => {
  it('Quản trị thấy Thêm/Sửa/Xoá; người khác không thấy nút quản lý', () => {
    setup();
    expect(screen.getByRole('button', { name: 'Thêm dự án' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Sửa dự án/ })).toBeInTheDocument();
  });

  it('Nhân viên chỉ xem', () => {
    state.role = 'STAFF';
    setup();
    expect(screen.queryByRole('button', { name: 'Thêm dự án' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Xoá dự án/ })).toBeNull();
  });

  it('dự án còn khách: xác nhận -> chuyển sang ngừng hoạt động (PATCH isActive=false), KHÔNG gọi xoá', async () => {
    state.counts = new Map([['p1', 3]]);
    api.updateProject.mockResolvedValue({ ok: true, data: project({ isActive: false }) });
    setup();
    fireEvent.click(screen.getByRole('button', { name: /Xoá dự án/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Ngừng hoạt động' }));
    await waitFor(() => expect(api.updateProject).toHaveBeenCalledWith('p1', { isActive: false }));
    expect(api.deleteProject).not.toHaveBeenCalled();
  });

  it('dự án không có khách: xác nhận -> xoá mềm (DELETE); Huỷ thì không gọi gì', async () => {
    api.deleteProject.mockResolvedValue({ ok: true, data: undefined });
    setup();
    fireEvent.click(screen.getByRole('button', { name: /Xoá dự án/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Huỷ' }));
    expect(api.deleteProject).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Xoá dự án/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Xoá dự án' }));
    await waitFor(() => expect(api.deleteProject).toHaveBeenCalledWith('p1'));
  });

  it('dự án đã xoá: chỉ hiện khi bật "Hiện dự án đã xoá" và khôi phục được', async () => {
    state.deleted = [project({ id: 'p2', name: 'Dự án cũ', code: 'OLD', isActive: false, deletedAt: '2026-10-01T00:00:00.000Z' })];
    api.restoreProject.mockResolvedValue({ ok: true, data: project({ id: 'p2' }) });
    setup();
    expect(screen.queryByText('Dự án cũ')).toBeNull();
    fireEvent.click(screen.getByLabelText(/Hiện dự án đã xoá/));
    fireEvent.click(screen.getByRole('button', { name: /Khôi phục dự án Dự án cũ/ }));
    await waitFor(() => expect(api.restoreProject).toHaveBeenCalledWith('p2'));
  });
});
