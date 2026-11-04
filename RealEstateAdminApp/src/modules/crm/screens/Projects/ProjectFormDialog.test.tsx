import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Project } from '@crm/types/crm';
import { CrmProvider } from '@crm/store/CrmProvider';
import { createCrmStore, createSeedDataState } from '@crm/store/crmStore';
import { FIXED_NOW } from '@crm/test/fixtures';
import { ProjectFormDialog } from './ProjectFormDialog';

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
const state = { projects: [] as Project[] };

vi.mock('@crm/api', async () => {
  const real = await vi.importActual<typeof import('@crm/api')>('@crm/api');
  return {
    ...real,
    useCrmApi: () => api,
    useCatalogs: () => ({ catalogs: { statuses: [], leadSources: [], areas: [], projects: state.projects, tags: [], contactResults: [] }, users: [] }),
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

const nameInput = () => screen.getByLabelText(/Tên dự án/) as HTMLInputElement;
const codeInput = () => screen.getByLabelText(/Mã dự án/) as HTMLInputElement;
const typeName = (value: string) => fireEvent.change(nameInput(), { target: { value } });
const typeCode = (value: string) => fireEvent.change(codeInput(), { target: { value } });

beforeEach(() => {
  Object.values(api).forEach((fn) => fn.mockReset());
  onClose.mockReset();
  state.projects = [project({})];
});

describe('ProjectFormDialog: tự điền mã khi Thêm', () => {
  it('gõ tên đến đâu thì mã cập nhật đến đó (bỏ dấu, bỏ khoảng trắng, viết HOA)', () => {
    setup();
    expect(codeInput().value).toBe('');
    typeName('Sky');
    expect(codeInput().value).toBe('SKY');
    typeName('Sky Park');
    expect(codeInput().value).toBe('SKYPARK');
    typeName('Căn hộ Đảo Kim Cương');
    expect(codeInput().value).toBe('CANHODAOKIMCUONG');
  });

  it('mã gợi ý trùng dự án đã có (không phân biệt hoa thường) thì thêm hậu tố số', () => {
    state.projects = [project({ code: 'skypark' })];
    setup();
    typeName('Sky Park');
    expect(codeInput().value).toBe('SKYPARK2');
  });

  it('xoá hết tên thì mã cũng trống (không để lại DUAN)', () => {
    setup();
    typeName('Sky');
    typeName('');
    expect(codeInput().value).toBe('');
  });

  it('tự sửa tay ô Mã rồi gõ tiếp tên thì mã KHÔNG bị ghi đè', () => {
    setup();
    typeName('Sky');
    typeCode('MYCODE');
    typeName('Sky Park');
    expect(codeInput().value).toBe('MYCODE');
    expect(nameInput().value).toBe('Sky Park');
  });

  it('xoá trống ô Mã thì bật lại tự điền ở lần gõ tên kế tiếp', () => {
    setup();
    typeName('Sky');
    typeCode('MYCODE');
    typeCode('');
    expect(codeInput().value).toBe('');
    typeName('Sky Park');
    expect(codeInput().value).toBe('SKYPARK');
  });

  it('gõ chữ thường vào ô Mã -> hiện chữ HOA, ký tự lạ không bị cắt khi gõ', () => {
    setup();
    typeCode('sky-park');
    expect(codeInput().value).toBe('SKY-PARK');
  });
});

describe('ProjectFormDialog: thuộc tính ô Mã (bàn phím di động)', () => {
  it('ô Mã hiển thị HOA, tự viết hoa chữ đầu, tắt sửa chữ/đoán chữ/lưu gợi ý', () => {
    setup();
    expect(codeInput()).toHaveClass('uppercase');
    expect(codeInput()).toHaveAttribute('autocapitalize', 'characters');
    expect(codeInput()).toHaveAttribute('autocorrect', 'off');
    expect(codeInput()).toHaveAttribute('autocomplete', 'off');
    expect(codeInput()).toHaveAttribute('spellcheck', 'false');
    expect(codeInput()).toHaveAttribute('maxlength', '30');
  });
});

describe('ProjectFormDialog: Sửa', () => {
  it('đổi tên KHÔNG tự đổi mã', () => {
    setup(project({ code: 'OLD_CODE-1' }));
    expect(codeInput().value).toBe('OLD_CODE-1');
    typeName('Tên hoàn toàn mới');
    expect(codeInput().value).toBe('OLD_CODE-1');
  });

  it('mã cũ có gạch dưới/ngang, không đổi mã: lưu được (không báo lỗi mẫu)', async () => {
    state.projects = [project({ code: 'OLD_CODE-1' })];
    api.updateProject.mockResolvedValue({ ok: true, data: project({ code: 'OLD_CODE-1', name: 'Tên mới' }) });
    setup(project({ code: 'OLD_CODE-1' }));
    typeName('Tên mới');
    fireEvent.click(screen.getByRole('button', { name: 'Lưu thay đổi' }));
    await waitFor(() => expect(api.updateProject).toHaveBeenCalledWith('p1', expect.objectContaining({ code: 'OLD_CODE-1', name: 'Tên mới' })));
    expect(screen.queryByText(/chỉ gồm chữ không dấu và số/)).toBeNull();
  });

  it('Sửa dự án mã cũ khi dự án KHÔNG có trong danh mục (catalogs): mã không đổi vẫn lưu được nhờ mã gốc tường minh', async () => {
    state.projects = [];
    api.updateProject.mockResolvedValue({ ok: true, data: project({ code: 'OLD_CODE-1' }) });
    setup(project({ code: 'OLD_CODE-1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Lưu thay đổi' }));
    await waitFor(() => expect(api.updateProject).toHaveBeenCalled());
    expect(screen.queryByText(/chỉ gồm chữ không dấu và số/)).toBeNull();
  });

  it('đổi mã sang giá trị có gạch ngang: báo lỗi inline và không gọi API', () => {
    state.projects = [project({ code: 'OLD_CODE-1' })];
    setup(project({ code: 'OLD_CODE-1' }));
    typeCode('NEW-CODE');
    fireEvent.click(screen.getByRole('button', { name: 'Lưu thay đổi' }));
    expect(screen.getByText(/chỉ gồm chữ không dấu và số/)).toBeInTheDocument();
    expect(api.updateProject).not.toHaveBeenCalled();
  });
});

describe('ProjectFormDialog: lưu', () => {
  it('Thêm: tên rồi mã tự điền (đã HOA) được gửi đúng và dialog đóng', async () => {
    api.createProject.mockResolvedValue({ ok: true, data: project({ id: 'p2', name: 'Sky Park', code: 'SKYPARK' }) });
    setup();
    typeName('Sky Park');
    fireEvent.click(screen.getByRole('button', { name: 'Thêm dự án' }));
    await waitFor(() => expect(api.createProject).toHaveBeenCalledWith(expect.objectContaining({ name: 'Sky Park', code: 'SKYPARK' })));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('Thêm: mã tự gõ chữ thường (ô nhận chữ thường qua change) -> giá trị gửi lên là HOA', async () => {
    api.createProject.mockResolvedValue({ ok: true, data: project({ id: 'p2', name: 'Sky Park', code: 'MYCODE9' }) });
    setup();
    typeName('Sky Park');
    typeCode('mycode9');
    fireEvent.click(screen.getByRole('button', { name: 'Thêm dự án' }));
    await waitFor(() => expect(api.createProject).toHaveBeenCalledWith(expect.objectContaining({ code: 'MYCODE9' })));
  });

  it('ký tự lạ trong mã: báo lỗi inline lúc Lưu, không gọi API', () => {
    setup();
    typeName('Sky Park');
    typeCode('sky_park');
    fireEvent.click(screen.getByRole('button', { name: 'Thêm dự án' }));
    expect(screen.getByText(/chỉ gồm chữ không dấu và số/)).toBeInTheDocument();
    expect(api.createProject).not.toHaveBeenCalled();
  });

  it('BE trả 409 PROJECT_CODE_DUPLICATED (trùng dự án đã xoá mềm): hiện lỗi ở ô Mã, giữ form và dữ liệu đã nhập, không đóng dialog', async () => {
    api.createProject.mockResolvedValue({ ok: false, error: { statusCode: 409, errorCode: 'PROJECT_CODE_DUPLICATED', message: 'Mã dự án đã tồn tại' } });
    setup();
    typeName('Sky Park');
    fireEvent.change(screen.getByLabelText(/Chủ đầu tư/), { target: { value: 'ABC Land' } });
    fireEvent.click(screen.getByRole('button', { name: 'Thêm dự án' }));
    expect(await screen.findByText('Mã dự án "SKYPARK" đã tồn tại.')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(nameInput().value).toBe('Sky Park');
    expect(codeInput().value).toBe('SKYPARK');
    expect((screen.getByLabelText(/Chủ đầu tư/) as HTMLInputElement).value).toBe('ABC Land');
    expect(screen.getByRole('button', { name: 'Thêm dự án' })).toBeEnabled();
  });

  it('sau 409 trùng mã: gõ tiếp tên KHÔNG tự gợi ý lại đúng mã vừa bị trùng; người dùng tự đổi mã rồi lưu được', async () => {
    api.createProject
      .mockResolvedValueOnce({ ok: false, error: { statusCode: 409, errorCode: 'PROJECT_CODE_DUPLICATED', message: 'Mã dự án đã tồn tại' } })
      .mockResolvedValueOnce({ ok: true, data: project({ id: 'p2', name: 'Sky Parks', code: 'SKYPARKVN' }) });
    setup();
    typeName('Sky Park');
    fireEvent.click(screen.getByRole('button', { name: 'Thêm dự án' }));
    await screen.findByText('Mã dự án "SKYPARK" đã tồn tại.');
    typeName('Sky Parks');
    expect(codeInput().value).toBe('SKYPARK');
    typeCode('SKYPARKVN');
    fireEvent.click(screen.getByRole('button', { name: 'Thêm dự án' }));
    await waitFor(() => expect(api.createProject).toHaveBeenLastCalledWith(expect.objectContaining({ code: 'SKYPARKVN' })));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});
