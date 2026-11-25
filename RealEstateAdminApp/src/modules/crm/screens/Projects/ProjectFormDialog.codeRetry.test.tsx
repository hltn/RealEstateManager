/**
 * Hồi quy: BE báo 409 `PROJECT_CODE_DUPLICATED` (mã trùng dự án đã xoá mềm mà danh sách FE không có) khi Thêm dự án.
 * Mã còn là mã tự điền từ tên -> tự sinh mã kế tiếp rồi gửi lại (tối đa 5 lần thử lại); mã người dùng tự gõ -> không tự đổi.
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
    useCatalogs: () => ({ catalogs: { statuses: [], leadSources: [], areas: [], projects: [project({})], tags: [], contactResults: [] }, personaFields: [], users: [] }),
  };
});

const onClose = vi.fn();
const duplicated = { ok: false, error: { statusCode: 409, errorCode: 'PROJECT_CODE_DUPLICATED', message: 'Mã dự án đã tồn tại' } };
const created = (code: string) => ({ ok: true, data: project({ id: 'p2', name: 'Sky Park', code }) });

const setup = () => {
  const store = createCrmStore({ initialData: createSeedDataState(FIXED_NOW), shouldPersist: false });
  return render(
    <MemoryRouter>
      <CrmProvider store={store}>
        <ProjectFormDialog project={null} onClose={onClose} />
      </CrmProvider>
    </MemoryRouter>,
  );
};

const nameInput = () => screen.getByLabelText(/Tên dự án/) as HTMLInputElement;
const codeInput = () => screen.getByLabelText(/Mã dự án/) as HTMLInputElement;
const typeName = (value: string) => fireEvent.change(nameInput(), { target: { value } });
const typeCode = (value: string) => fireEvent.change(codeInput(), { target: { value } });
const submit = () => fireEvent.click(screen.getByRole('button', { name: 'Thêm dự án' }));
const sentCodes = () => api.createProject.mock.calls.map(([body]) => (body as { code: string }).code);

beforeEach(() => {
  Object.values(api).forEach((fn) => fn.mockReset());
  [toastMock, toastMock.success, toastMock.error].forEach((fn) => fn.mockReset());
  onClose.mockReset();
});

describe('ProjectFormDialog: 409 trùng mã khi mã còn là mã tự điền', () => {
  it('tự sinh mã kế tiếp rồi gửi lại; thành công thì đóng dialog, không toast lỗi', async () => {
    api.createProject.mockResolvedValueOnce(duplicated).mockResolvedValueOnce(created('SKYPARK2'));
    setup();
    typeName('Sky Park');
    submit();
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(sentCodes()).toEqual(['SKYPARK', 'SKYPARK2']);
    expect(toastMock.success).toHaveBeenCalledWith('Đã thêm dự án "Sky Park"', expect.anything());
    expect(toastMock.error).not.toHaveBeenCalled();
  });

  it('trùng liên tiếp: thử SKYPARK, SKYPARK2, SKYPARK3 cho tới khi được', async () => {
    api.createProject.mockResolvedValueOnce(duplicated).mockResolvedValueOnce(duplicated).mockResolvedValueOnce(created('SKYPARK3'));
    setup();
    typeName('Sky Park');
    submit();
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(sentCodes()).toEqual(['SKYPARK', 'SKYPARK2', 'SKYPARK3']);
  });

  it('tên trùng mã dự án đang có trong danh sách: mã gợi ý đã có hậu tố, 409 tiếp theo vẫn bỏ qua cả mã trong danh sách', async () => {
    api.createProject.mockResolvedValueOnce(duplicated).mockResolvedValueOnce(created('QTERRA3'));
    setup();
    typeName('QTerra');
    expect(codeInput().value).toBe('QTERRA2');
    submit();
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(sentCodes()).toEqual(['QTERRA2', 'QTERRA3']);
  });

  it('tắt hoạt động: chỉ PATCH isActive=false sau khi tạo được bằng mã mới (không PATCH ở lần bị 409)', async () => {
    api.createProject.mockResolvedValueOnce(duplicated).mockResolvedValueOnce(created('SKYPARK2'));
    api.updateProject.mockResolvedValue({ ok: true, data: project({ id: 'p2', isActive: false }) });
    setup();
    typeName('Sky Park');
    fireEvent.click(screen.getByRole('switch', { name: 'Đang hoạt động' }));
    submit();
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(sentCodes()).toEqual(['SKYPARK', 'SKYPARK2']);
    expect(api.updateProject).toHaveBeenCalledTimes(1);
    expect(api.updateProject).toHaveBeenCalledWith('p2', { isActive: false });
  });

  it('tên không có chữ/số (fallback DUAN) cũng đi qua cơ chế thử lại', async () => {
    api.createProject.mockResolvedValueOnce(duplicated).mockResolvedValueOnce(created('DUAN2'));
    setup();
    typeName('---');
    expect(codeInput().value).toBe('DUAN');
    submit();
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(sentCodes()).toEqual(['DUAN', 'DUAN2']);
  });

  it('trùng mãi: dừng sau 1 lần gửi + 5 lần thử lại, báo lỗi ở ô Tên + ô Mã + toast, giữ form và dữ liệu, nút bấm lại được', async () => {
    api.createProject.mockResolvedValue(duplicated);
    setup();
    typeName('Sky Park');
    fireEvent.change(screen.getByLabelText(/Chủ đầu tư/), { target: { value: 'ABC Land' } });
    submit();
    expect(await screen.findByText(/Không tạo được mã dự án không trùng từ tên này/)).toBeInTheDocument();
    expect(sentCodes()).toEqual(['SKYPARK', 'SKYPARK2', 'SKYPARK3', 'SKYPARK4', 'SKYPARK5', 'SKYPARK6']);
    // Ô Mã được đặt sẵn mã kế tiếp CHƯA thử (không giữ lại mã vừa bị báo trùng).
    expect(sentCodes()).not.toContain(codeInput().value);
    expect(codeInput().value).toBe('SKYPARK7');
    expect(nameInput()).toHaveAttribute('aria-invalid', 'true');
    expect(toastMock.error).toHaveBeenCalledWith(expect.stringContaining('Không tạo được mã dự án'), expect.anything());
    expect(onClose).not.toHaveBeenCalled();
    expect(nameInput().value).toBe('Sky Park');
    expect((screen.getByLabelText(/Chủ đầu tư/) as HTMLInputElement).value).toBe('ABC Land');
    expect(screen.getByRole('button', { name: 'Thêm dự án' })).toBeEnabled();
  });

  it('sau khi hết lượt: gõ lại tên không sinh lại các mã đã bị báo trùng', async () => {
    api.createProject.mockResolvedValue(duplicated);
    setup();
    typeName('Sky Park');
    submit();
    await screen.findByText(/Không tạo được mã dự án không trùng/);
    typeName('Sky Parks');
    typeName('Sky Park');
    expect(codeInput().value).toBe('SKYPARK7');
  });

  it('sau khi hết lượt: bấm Thêm lại ngay (không gõ lại tên) gửi mã mới chưa thử, không lặp mã đã trùng', async () => {
    api.createProject.mockResolvedValue(duplicated);
    setup();
    typeName('Sky Park');
    submit();
    await screen.findByText(/Không tạo được mã dự án không trùng/);
    const firstRound = sentCodes();
    api.createProject.mockReset();
    api.createProject.mockResolvedValueOnce(created('SKYPARK7'));
    submit();
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(sentCodes()).toEqual(['SKYPARK7']);
    expect(firstRound).not.toContain('SKYPARK7');
  });

  it('lỗi mạng/5xx ở lần thử lại thứ 2: dừng ngay, toast lỗi của BE, không báo "hết lượt", giữ form', async () => {
    api.createProject
      .mockResolvedValueOnce(duplicated)
      .mockResolvedValueOnce(duplicated)
      .mockResolvedValueOnce({ ok: false, error: { statusCode: 503, errorCode: 'UNAVAILABLE', message: 'Mất kết nối máy chủ' } });
    setup();
    typeName('Sky Park');
    submit();
    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith('Mất kết nối máy chủ', expect.anything()));
    expect(sentCodes()).toEqual(['SKYPARK', 'SKYPARK2', 'SKYPARK3']);
    expect(screen.queryByText(/Không tạo được mã dự án không trùng/)).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(nameInput().value).toBe('Sky Park');
    expect(screen.getByRole('button', { name: 'Thêm dự án' })).toBeEnabled();
  });

  it('PATCH tắt hoạt động lỗi sau khi tạo: không toast "Đã thêm", toast cảnh báo "đã tạo nhưng chưa tắt", vẫn đóng dialog', async () => {
    api.createProject.mockResolvedValueOnce(created('SKYPARK'));
    api.updateProject.mockResolvedValue({ ok: false, error: { statusCode: 500, errorCode: 'INTERNAL', message: 'Lỗi máy chủ' } });
    setup();
    typeName('Sky Park');
    fireEvent.click(screen.getByRole('switch', { name: 'Đang hoạt động' }));
    submit();
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(toastMock).toHaveBeenCalledWith(expect.stringContaining('chưa tắt được hoạt động'), expect.anything());
    expect(toastMock.success).not.toHaveBeenCalled();
    expect(toastMock.error).not.toHaveBeenCalled();
  });
});

describe('ProjectFormDialog: đóng dialog giữa lúc đang lưu', () => {
  const deferred = () => {
    let resolve: (value: unknown) => void = () => undefined;
    const promise = new Promise((resolver) => {
      resolve = resolver;
    });
    return { promise, resolve };
  };

  it('đóng giữa lúc đang thử lại: không gửi thêm POST, không onClose, không toast', async () => {
    const first = deferred();
    api.createProject.mockReturnValueOnce(first.promise).mockResolvedValue(duplicated);
    const view = setup();
    typeName('Sky Park');
    submit();
    await waitFor(() => expect(api.createProject).toHaveBeenCalledTimes(1));
    view.unmount();
    first.resolve(duplicated);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(api.createProject).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
    expect(toastMock).not.toHaveBeenCalled();
    expect(toastMock.error).not.toHaveBeenCalled();
    expect(toastMock.success).not.toHaveBeenCalled();
  });

  it('đóng giữa lúc POST đang bay rồi POST thành công: không onClose, không toast, không PATCH tắt hoạt động', async () => {
    const first = deferred();
    api.createProject.mockReturnValueOnce(first.promise);
    const view = setup();
    typeName('Sky Park');
    fireEvent.click(screen.getByRole('switch', { name: 'Đang hoạt động' }));
    submit();
    await waitFor(() => expect(api.createProject).toHaveBeenCalledTimes(1));
    view.unmount();
    first.resolve(created('SKYPARK'));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(onClose).not.toHaveBeenCalled();
    expect(toastMock.success).not.toHaveBeenCalled();
    expect(api.updateProject).not.toHaveBeenCalled();
  });
});

describe('ProjectFormDialog: 409 / lỗi khác không tự thử lại', () => {
  it('mã tự gõ tay bị 409: gửi đúng 1 lần, báo lỗi ở ô Mã, không đổi mã', async () => {
    api.createProject.mockResolvedValue(duplicated);
    setup();
    typeName('Sky Park');
    typeCode('MYCODE');
    submit();
    expect(await screen.findByText('Mã dự án "MYCODE" đã tồn tại.')).toBeInTheDocument();
    expect(sentCodes()).toEqual(['MYCODE']);
    expect(codeInput().value).toBe('MYCODE');
    expect(toastMock.error).toHaveBeenCalledWith('Mã dự án đã tồn tại', expect.anything());
    expect(onClose).not.toHaveBeenCalled();
  });

  it('lỗi khác 409 mã trùng (vd 500): không tự thử lại, chỉ toast lỗi của BE', async () => {
    api.createProject.mockResolvedValue({ ok: false, error: { statusCode: 500, errorCode: 'INTERNAL', message: 'Máy chủ lỗi' } });
    setup();
    typeName('Sky Park');
    submit();
    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith('Máy chủ lỗi', expect.anything()));
    expect(api.createProject).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/Không tạo được mã dự án không trùng/)).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});
