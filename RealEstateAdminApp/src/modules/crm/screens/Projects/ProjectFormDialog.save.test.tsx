/**
 * Hồi quy cho luồng lưu của ProjectFormDialog (hàm `saveProject` tách khỏi `handleSubmit`):
 * POST không có `isActive`, tắt hoạt động khi Thêm = tạo xong PATCH `{ isActive: false }`, toast, trạng thái đang lưu, thời điểm đóng dialog.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Project } from '@crm/types/crm';
import { CrmProvider } from '@crm/store/CrmProvider';
import { createCrmStore, createSeedDataState } from '@crm/store/crmStore';
import { FIXED_NOW } from '@crm/test/fixtures';
import { ProjectFormDialog } from './ProjectFormDialog';

const toastMock = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }));
vi.mock('react-hot-toast', () => ({ default: toastMock }));

const project = (overrides: Partial<Project>): Project => ({
  id: 'p1',
  code: 'QTERRA',
  name: 'QTerra Residence',
  fullName: 'QTerra Residence',
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

const api = { createProject: vi.fn(), updateProject: vi.fn() };

vi.mock('@crm/api', async () => {
  const real = await vi.importActual<typeof import('@crm/api')>('@crm/api');
  return {
    ...real,
    useCrmApi: () => api,
    useCatalogs: () => ({ catalogs: { statuses: [], leadSources: [], areas: [], projects: [], tags: [], contactResults: [] }, personaFields: [], users: [] }),
  };
});

const onClose = vi.fn();

const setup = (editing: Project | null = null) => {
  const store = createCrmStore({ initialData: createSeedDataState(FIXED_NOW), shouldPersist: false });
  render(
    <MemoryRouter>
      <CrmProvider store={store}>
        <ProjectFormDialog project={editing} onClose={onClose} />
      </CrmProvider>
    </MemoryRouter>,
  );
};

const typeName = (value: string) => fireEvent.change(screen.getByLabelText(/Tên dự án/), { target: { value } });
const submit = (name: string) => fireEvent.click(screen.getByRole('button', { name }));

beforeEach(() => {
  Object.values(api).forEach((fn) => fn.mockReset());
  [toastMock, toastMock.success, toastMock.error].forEach((fn) => fn.mockReset());
  onClose.mockReset();
});

describe('ProjectFormDialog: luồng lưu (Thêm)', () => {
  it('Thêm (đang hoạt động): POST không có isActive, không PATCH thêm, toast thành công rồi đóng', async () => {
    api.createProject.mockResolvedValue({ ok: true, data: project({ id: 'p2', name: 'Sky Park', code: 'SKYPARK' }) });
    setup();
    typeName('Sky Park');
    submit('Thêm dự án');
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(api.createProject).toHaveBeenCalledTimes(1);
    expect(api.createProject.mock.calls[0][0]).not.toHaveProperty('isActive');
    expect(api.updateProject).not.toHaveBeenCalled();
    expect(toastMock.success).toHaveBeenCalledWith('Đã thêm dự án "Sky Park"', expect.anything());
  });

  it('Thêm + tắt "Đang hoạt động": tạo xong mới PATCH { isActive: false } theo id vừa tạo, rồi mới đóng', async () => {
    const order: string[] = [];
    api.createProject.mockImplementation(async () => {
      order.push('create');
      return { ok: true, data: project({ id: 'p-new', name: 'Sky Park', code: 'SKYPARK' }) };
    });
    api.updateProject.mockImplementation(async () => {
      order.push('patch');
      return { ok: true, data: project({ id: 'p-new', isActive: false }) };
    });
    onClose.mockImplementation(() => order.push('close'));
    setup();
    typeName('Sky Park');
    fireEvent.click(screen.getByRole('switch', { name: 'Đang hoạt động' }));
    submit('Thêm dự án');
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(api.createProject.mock.calls[0][0]).not.toHaveProperty('isActive');
    expect(api.updateProject).toHaveBeenCalledTimes(1);
    expect(api.updateProject).toHaveBeenCalledWith('p-new', { isActive: false });
    expect(order).toEqual(['create', 'patch', 'close']);
  });

  it('Thêm lỗi (không phải 409): không PATCH, toast lỗi, giữ dialog, nút Lưu bật lại', async () => {
    api.createProject.mockResolvedValue({ ok: false, error: { statusCode: 500, message: 'Máy chủ lỗi' } });
    setup();
    typeName('Sky Park');
    fireEvent.click(screen.getByRole('switch', { name: 'Đang hoạt động' }));
    submit('Thêm dự án');
    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith('Máy chủ lỗi', expect.anything()));
    expect(api.updateProject).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(toastMock.success).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Thêm dự án' })).toBeEnabled();
  });

  it('Thêm: đang lưu thì nút bị khoá và bấm lần hai không gửi thêm (chống click đúp); xong thì đóng', async () => {
    let resolveCreate: (value: unknown) => void = () => undefined;
    api.createProject.mockReturnValue(new Promise((resolve) => { resolveCreate = resolve; }));
    setup();
    typeName('Sky Park');
    submit('Thêm dự án');
    const busy = await screen.findByRole('button', { name: 'Đang lưu…' });
    expect(busy).toBeDisabled();
    fireEvent.submit(busy.closest('form') ?? document.forms[0]);
    expect(api.createProject).toHaveBeenCalledTimes(1);
    resolveCreate({ ok: true, data: project({ id: 'p2', name: 'Sky Park', code: 'SKYPARK' }) });
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });
});

describe('ProjectFormDialog: luồng lưu (Sửa)', () => {
  it('Sửa: chỉ PATCH (kèm isActive), không POST, toast "Đã lưu", đóng', async () => {
    const editing = project({ isActive: false });
    api.updateProject.mockResolvedValue({ ok: true, data: { ...editing, name: 'Tên mới' } });
    setup(editing);
    typeName('Tên mới');
    submit('Lưu thay đổi');
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(api.createProject).not.toHaveBeenCalled();
    expect(api.updateProject).toHaveBeenCalledTimes(1);
    expect(api.updateProject).toHaveBeenCalledWith('p1', expect.objectContaining({ name: 'Tên mới', isActive: false }));
    expect(toastMock.success).toHaveBeenCalledWith('Đã lưu dự án "Tên mới"', expect.anything());
  });

  it('Sửa lỗi: toast lỗi, không đóng, nút Lưu bật lại', async () => {
    api.updateProject.mockResolvedValue({ ok: false, error: { statusCode: 500, message: 'Máy chủ lỗi' } });
    setup(project({}));
    typeName('Tên mới');
    submit('Lưu thay đổi');
    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith('Máy chủ lỗi', expect.anything()));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Lưu thay đổi' })).toBeEnabled();
  });
});
