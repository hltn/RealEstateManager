/** Màn Dự án: Thêm / Sửa / Xoá (chỉ Quản trị) dựng với store + API mock thật. */
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { CrmProvider } from '@crm/store/CrmProvider';
import { createCrmStore, createSeedDataState } from '@crm/store/crmStore';
import { FIXED_NOW } from '@crm/test/fixtures';
import { ProjectsView } from './ProjectsView';

// Dựng nguyên màn + dialog trong jsdom khá nặng: nới thời gian chờ để không flaky.
vi.setConfig({ testTimeout: 30_000 });

const renderProjects = (userId: string) => {
  const store = createCrmStore({ initialData: createSeedDataState(FIXED_NOW), initialSession: { currentUserId: userId }, shouldPersist: false });
  render(
    <MemoryRouter initialEntries={['/crm/projects']}>
      <CrmProvider store={store}>
        <ProjectsView variant="desktop" />
      </CrmProvider>
    </MemoryRouter>,
  );
  return store;
};

const projectsOf = (store: ReturnType<typeof renderProjects>) => store.getState().state.catalogs.projects;
const customersUsing = (store: ReturnType<typeof renderProjects>, projectId: string) =>
  store.getState().state.customers.filter((customer) => customer.interestedProjectIds.includes(projectId)).length;

const fill = (label: RegExp, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe('ProjectsView — quyền', () => {
  it('Quản trị thấy nút Thêm / Sửa / Xoá', () => {
    renderProjects('admin');
    expect(screen.getByRole('button', { name: 'Thêm dự án' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: "Sửa dự án Q'Terra" })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: "Xoá dự án Q'Terra" })).toBeInTheDocument();
  });

  it('người không phải Quản trị không thấy nút quản lý', () => {
    renderProjects('hanh');
    expect(screen.queryByRole('button', { name: 'Thêm dự án' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Sửa dự án/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Xoá dự án/ })).toBeNull();
  });
});

describe('ProjectsView — thêm dự án', () => {
  it('điền đủ thông tin tối thiểu -> dự án mới vào danh mục và hiện trên màn', () => {
    const store = renderProjects('admin');
    fireEvent.click(screen.getByRole('button', { name: 'Thêm dự án' }));
    fill(/^Tên dự án/, 'Sky Park');
    fill(/^Mã dự án/, 'skypark');
    fill(/^Chủ đầu tư/, 'ABC Land');
    fill(/^Loại hình/, 'Căn hộ');
    fill(/^Giá từ/, '3500');
    fill(/^Giá đến/, '6000');
    fireEvent.change(screen.getByLabelText(/^Trạng thái bán hàng/), { target: { value: 'UPCOMING' } });
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Thêm dự án' }));
    const created = projectsOf(store).find((project) => project.code === 'SKYPARK');
    expect(created).toMatchObject({ name: 'Sky Park', developer: 'ABC Land', propertyTypes: ['Căn hộ'], priceFrom: 3_500_000_000, priceTo: 6_000_000_000, status: 'UPCOMING', isActive: true });
    expect(screen.getByText('Sky Park')).toBeInTheDocument();
  });

  it('giá từ lớn hơn giá đến: báo lỗi ở ô "Giá đến", không lưu', () => {
    const store = renderProjects('admin');
    const before = projectsOf(store).length;
    fireEvent.click(screen.getByRole('button', { name: 'Thêm dự án' }));
    const dialog = screen.getByRole('dialog');
    fill(/^Tên dự án/, 'Dự án giá sai');
    fill(/^Mã dự án/, 'GIASAI');
    fill(/^Giá từ/, '6000');
    fill(/^Giá đến/, '3500');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Thêm dự án' }));
    expect(within(dialog).getByText(/lớn hơn hoặc bằng/)).toBeInTheDocument();
    expect(projectsOf(store)).toHaveLength(before);
  });

  it('thiếu tên/mã và trùng mã: hiện lỗi theo trường, không lưu, dialog vẫn mở', () => {
    const store = renderProjects('admin');
    const before = projectsOf(store).length;
    fireEvent.click(screen.getByRole('button', { name: 'Thêm dự án' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Thêm dự án' }));
    expect(within(dialog).getByText('Vui lòng nhập tên dự án.')).toBeInTheDocument();
    expect(within(dialog).getByText('Vui lòng nhập mã dự án.')).toBeInTheDocument();
    fill(/^Tên dự án/, 'Dự án hoàn toàn mới');
    fill(/^Mã dự án/, 'qterra');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Thêm dự án' }));
    expect(within(dialog).getByText(/đã tồn tại/)).toBeInTheDocument();
    expect(projectsOf(store)).toHaveLength(before);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});

describe('ProjectsView — sửa dự án', () => {
  it('sửa chủ đầu tư và lưu', () => {
    const store = renderProjects('admin');
    fireEvent.click(screen.getByRole('button', { name: "Sửa dự án Q'Terra" }));
    expect(screen.getByLabelText(/^Mã dự án/)).toHaveValue('QTERRA');
    fill(/^Chủ đầu tư/, 'Chủ đầu tư mới');
    fireEvent.click(screen.getByRole('button', { name: 'Lưu thay đổi' }));
    expect(projectsOf(store).find((project) => project.id === 'proj-1')?.developer).toBe('Chủ đầu tư mới');
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('ProjectsView — xoá dự án', () => {
  it('dự án đang có khách quan tâm: cảnh báo rõ, xác nhận -> chuyển sang ngừng hoạt động (không xoá cứng, khách giữ tham chiếu)', () => {
    const store = renderProjects('admin');
    const usage = customersUsing(store, 'proj-1');
    expect(usage).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: "Xoá dự án Q'Terra" }));
    const dialog = screen.getByRole('alertdialog');
    expect(dialog).toHaveTextContent(`${usage} khách quan tâm`);
    expect(dialog).toHaveTextContent('chuyển sang ngừng hoạt động');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Ngừng hoạt động' }));
    expect(projectsOf(store).find((project) => project.id === 'proj-1')?.isActive).toBe(false);
    expect(customersUsing(store, 'proj-1')).toBe(usage);
    // Dự án ngừng hoạt động ẩn mặc định; bật checkbox để thấy lại + có nhãn.
    expect(screen.queryByRole('button', { name: "Sửa dự án Q'Terra" })).toBeNull();
    fireEvent.click(screen.getByRole('checkbox', { name: /Hiện cả dự án ngừng hoạt động/ }));
    expect(screen.getByRole('button', { name: "Sửa dự án Q'Terra" })).toBeInTheDocument();
    expect(screen.getByText('Ngừng hoạt động')).toBeInTheDocument();
  });

  it('dự án đã ngừng sẵn mà còn khách: hộp thoại nói rõ không thể xoá, KHÔNG báo "đã chuyển sang ngừng hoạt động"', () => {
    const store = renderProjects('admin');
    fireEvent.click(screen.getByRole('button', { name: "Xoá dự án Q'Terra" }));
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Ngừng hoạt động' }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Hiện cả dự án ngừng hoạt động/ }));
    fireEvent.click(screen.getByRole('button', { name: "Xoá dự án Q'Terra" }));
    const dialog = screen.getByRole('alertdialog');
    expect(dialog).toHaveTextContent('đã ngừng hoạt động sẵn');
    expect(dialog).toHaveTextContent('không thể xoá');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Đã hiểu' }));
    expect(projectsOf(store).find((project) => project.id === 'proj-1')).toMatchObject({ isActive: false, deletedAt: null });
    expect(store.getState().state.auditLogs.filter((log) => log.action === 'PROJECT_DEACTIVATED')).toHaveLength(1);
  });

  it('dự án không ai quan tâm: Huỷ thì không đổi gì; xác nhận -> xoá mềm (ẩn khỏi màn), hiện lại ở mục "dự án đã xoá" và khôi phục được', () => {
    const store = renderProjects('admin');
    // Tạo dự án chưa có khách qua dialog rồi xoá.
    fireEvent.click(screen.getByRole('button', { name: 'Thêm dự án' }));
    fill(/^Tên dự án/, 'Dự án tạm');
    fill(/^Mã dự án/, 'TAM');
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Thêm dự án' }));
    const temp = projectsOf(store).find((project) => project.code === 'TAM')!;
    fireEvent.click(screen.getByRole('button', { name: 'Xoá dự án Dự án tạm' }));
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Huỷ' }));
    expect(projectsOf(store).some((project) => project.id === temp.id)).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Xoá dự án Dự án tạm' }));
    expect(screen.getByRole('alertdialog')).toHaveTextContent('xoá mềm');
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Xoá dự án' }));
    // Xoá mềm: vẫn nằm trong danh mục (deletedAt), biến mất khỏi danh sách.
    expect(projectsOf(store).find((project) => project.id === temp.id)).toMatchObject({ isActive: false, deletedAt: expect.any(String) });
    expect(screen.queryByRole('button', { name: 'Sửa dự án Dự án tạm' })).toBeNull();
    fireEvent.click(screen.getByRole('checkbox', { name: /Hiện dự án đã xoá/ }));
    expect(screen.getByText('Đã xoá')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sửa dự án Dự án tạm' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Khôi phục dự án Dự án tạm' }));
    expect(projectsOf(store).find((project) => project.id === temp.id)).toMatchObject({ isActive: true, deletedAt: null });
    expect(screen.getByRole('button', { name: 'Sửa dự án Dự án tạm' })).toBeInTheDocument();
  });
});
