/**
 * QA bổ sung cho ProjectFormDialog: bộ gõ (IME composition), vị trí con trỏ khi tự viết hoa, giới hạn độ dài, a11y lỗi inline,
 * ca biên của tự điền mã (tên toàn ký tự lạ, hậu tố số ở 30 ký tự) và luồng Sửa mã cũ.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

beforeEach(() => {
  Object.values(api).forEach((fn) => fn.mockReset());
  onClose.mockReset();
  state.projects = [project({})];
});

describe('ô Mã: tự viết hoa, con trỏ, bộ gõ', () => {
  it('chèn chữ thường vào GIỮA chuỗi: chuyển HOA và con trỏ ở lại sau ký tự vừa gõ (gõ tiếp không nhảy về cuối)', async () => {
    const user = userEvent.setup();
    setup();
    fireEvent.change(codeInput(), { target: { value: 'AC' } });
    await user.type(codeInput(), 'x', { initialSelectionStart: 1, initialSelectionEnd: 1 });
    expect(codeInput().value).toBe('AXC');
    expect(codeInput().selectionStart).toBe(2);
    await user.keyboard('y');
    expect(codeInput().value).toBe('AXYC');
  });

  it('đang gõ dở bộ gõ (isComposing): giữ nguyên, KHÔNG cắt ký tự lạ; kết thúc composition mới chuyển HOA', () => {
    setup();
    fireEvent.compositionStart(codeInput());
    fireEvent.input(codeInput(), { target: { value: 'ấ' }, isComposing: true });
    expect(codeInput().value).toBe('ấ');
    fireEvent.compositionEnd(codeInput());
    expect(codeInput().value).toBe('Ấ');
  });

  it('dán chuỗi dài: ô chỉ nhận tối đa 30 ký tự (maxLength)', async () => {
    const user = userEvent.setup();
    setup();
    expect(codeInput()).toHaveAttribute('maxlength', '30');
    await user.click(codeInput());
    await user.paste('a'.repeat(45));
    expect(codeInput().value).toBe('A'.repeat(30));
  });

  it('dán chuỗi có khoảng trắng/ký tự lạ: giữ nguyên (HOA) và báo lỗi lúc Lưu, không gọi API', async () => {
    const user = userEvent.setup();
    setup();
    await user.type(nameInput(), 'Sky');
    await user.clear(codeInput());
    await user.click(codeInput());
    await user.paste('sky park.1');
    expect(codeInput().value).toBe('SKY PARK.1');
    await user.click(screen.getByRole('button', { name: 'Thêm dự án' }));
    expect(api.createProject).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('chỉ gồm chữ không dấu và số');
  });
});

describe('tự điền mã: ca biên', () => {
  it('tên chỉ gồm ký tự lạ -> mã DUAN', async () => {
    const user = userEvent.setup();
    setup();
    await user.type(nameInput(), '!!!');
    expect(codeInput().value).toBe('DUAN');
  });

  it('mã gốc đã đủ 30 ký tự và bị trùng: hậu tố số làm tổng vẫn đúng 30', async () => {
    const base = 'A'.repeat(30);
    state.projects = [project({ code: base.toLowerCase() })];
    const user = userEvent.setup();
    setup();
    await user.type(nameInput(), base);
    expect(codeInput().value).toBe(`${'A'.repeat(29)}2`);
  });

  it('gõ tên từng ký tự (gõ nhanh): mã luôn khớp với tên hiện tại, không trễ một nhịp', async () => {
    const user = userEvent.setup();
    setup();
    await user.type(nameInput(), 'Sky Park 2');
    expect(codeInput().value).toBe('SKYPARK2');
    await user.keyboard('{Backspace}{Backspace}');
    expect(codeInput().value).toBe('SKYPARK');
  });

  it('đã sửa tay mã: đổi/xoá toàn bộ tên không đụng tới mã', async () => {
    const user = userEvent.setup();
    setup();
    await user.type(nameInput(), 'Sky');
    await user.type(codeInput(), '9');
    expect(codeInput().value).toBe('SKY9');
    await user.clear(nameInput());
    await user.type(nameInput(), 'Khác hẳn');
    expect(codeInput().value).toBe('SKY9');
  });

  it('Thêm: mã gõ chữ thường được gửi lên đã viết HOA', async () => {
    api.createProject.mockResolvedValue({ ok: true, data: project({ id: 'p2', name: 'Sky', code: 'ABC9' }) });
    const user = userEvent.setup();
    setup();
    await user.type(nameInput(), 'Sky');
    await user.clear(codeInput());
    await user.type(codeInput(), 'abc9');
    await user.click(screen.getByRole('button', { name: 'Thêm dự án' }));
    await waitFor(() => expect(api.createProject).toHaveBeenCalledWith(expect.objectContaining({ code: 'ABC9' })));
  });

  it('mã sửa tay trùng dự án đã có (khác hoa/thường): báo trùng, không gọi API', async () => {
    const user = userEvent.setup();
    setup();
    await user.type(nameInput(), 'Dự án mới');
    await user.clear(codeInput());
    await user.type(codeInput(), 'qterra');
    await user.click(screen.getByRole('button', { name: 'Thêm dự án' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Mã dự án "QTERRA" đã tồn tại.');
    expect(api.createProject).not.toHaveBeenCalled();
  });
});

describe('Sửa: mã cũ', () => {
  const legacy = () => project({ code: 'OLD_CODE-1' });

  it('mã cũ không đổi mà trùng dự án khác vẫn bị chặn (miễn lỗi mẫu không miễn lỗi trùng)', async () => {
    state.projects = [legacy(), project({ id: 'p2', name: 'Khác', code: 'old_code-1' })];
    setup(legacy());
    fireEvent.click(screen.getByRole('button', { name: 'Lưu thay đổi' }));
    expect(await screen.findByText('Mã dự án "OLD_CODE-1" đã tồn tại.')).toBeInTheDocument();
    expect(api.updateProject).not.toHaveBeenCalled();
  });

  it('đổi mã rồi gõ lại đúng mã cũ (khác hoa thường): vẫn lưu được', async () => {
    state.projects = [legacy()];
    api.updateProject.mockResolvedValue({ ok: true, data: legacy() });
    const user = userEvent.setup();
    setup(legacy());
    await user.clear(codeInput());
    await user.type(codeInput(), 'old_code-1');
    await user.click(screen.getByRole('button', { name: 'Lưu thay đổi' }));
    await waitFor(() => expect(api.updateProject).toHaveBeenCalledWith('p1', expect.objectContaining({ code: 'OLD_CODE-1' })));
  });

  it('xoá trống ô Mã khi Sửa: báo bắt buộc và KHÔNG tự điền theo tên', async () => {
    state.projects = [legacy()];
    const user = userEvent.setup();
    setup(legacy());
    await user.clear(codeInput());
    await user.type(nameInput(), ' mới');
    expect(codeInput().value).toBe('');
    await user.click(screen.getByRole('button', { name: 'Lưu thay đổi' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Vui lòng nhập mã dự án.');
    expect(api.updateProject).not.toHaveBeenCalled();
  });
});

describe('a11y lỗi ô Mã', () => {
  it('lỗi mẫu: aria-invalid + aria-describedby trỏ tới phần tử role=alert chứa thông báo', async () => {
    const user = userEvent.setup();
    setup();
    await user.type(nameInput(), 'Sky');
    await user.clear(codeInput());
    await user.type(codeInput(), 'A_B');
    await user.click(screen.getByRole('button', { name: 'Thêm dự án' }));
    const alert = screen.getByRole('alert');
    expect(codeInput()).toHaveAttribute('aria-invalid', 'true');
    expect(codeInput().getAttribute('aria-describedby')).toBe(alert.id);
    expect(alert).toHaveTextContent('Mã chỉ gồm chữ không dấu và số');
  });

  it('lỗi 409 từ BE cũng gắn đúng aria cho ô Mã', async () => {
    api.createProject.mockResolvedValue({ ok: false, error: { statusCode: 409, errorCode: 'PROJECT_CODE_DUPLICATED', message: 'Mã dự án đã tồn tại' } });
    const user = userEvent.setup();
    setup();
    await user.type(nameInput(), 'Sky');
    await user.click(screen.getByRole('button', { name: 'Thêm dự án' }));
    const alert = await screen.findByRole('alert');
    expect(codeInput()).toHaveAttribute('aria-invalid', 'true');
    expect(codeInput().getAttribute('aria-describedby')).toBe(alert.id);
  });
});
