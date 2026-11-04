import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { AdminUser } from '@crm/types/crm';
import { peekQueuedRedirectNotice } from '../../../../../components/auth/RedirectWithNotice';
import { useAuthStore } from '../../../../../stores/auth.store';
import { UsersSection } from './UsersSection';

const api = {
  createUser: vi.fn(),
  updateUserRoles: vi.fn(),
  updateUserTeams: vi.fn(),
  updateUserStatus: vi.fn(),
};
const showToast = vi.fn();
let users: AdminUser[] = [];

vi.mock('@crm/api', () => ({
  useAdminUsers: () => ({ data: users, isLoading: false, error: null, refetch: vi.fn() }),
  useCatalogs: () => ({
    teams: [
      { id: 't1', name: 'Nhóm Một', managerIds: [], code: 'T1', memberCount: 1, isActive: true },
      { id: 't2', name: 'Nhóm Hai', managerIds: [], code: 'T2', memberCount: 0, isActive: true },
      { id: 't3', name: 'Nhóm Cũ', managerIds: [], code: 'T3', memberCount: 1, isActive: false },
    ],
  }),
  useCrmApi: () => api,
}));
vi.mock('@crm/store', () => ({ useCrmActions: () => ({ showToast }) }));

const make = (patch: Partial<AdminUser>): AdminUser => ({ id: 'u1', fullName: 'An', displayName: 'An', role: 'STAFF', jobTitle: '', teamId: 't1', isActive: true, roles: ['STAFF'], teamIds: ['t1'], ...patch });

/** Máy chủ giả: mỗi bước ghi cập nhật tài khoản rồi trả bản mới (như API thật) để test được lưu dở dang và lưu lại. */
const respond = (id: string, patch: Partial<AdminUser>) => {
  const next = { ...users.find((user) => user.id === id)!, ...patch };
  users = users.map((user) => (user.id === id ? next : user));
  return Promise.resolve({ ok: true, data: next });
};
const failure = (statusCode: number, errorCode: string, message: string) => ({ ok: false, error: { statusCode, errorCode, message } });

const openEdit = (name: string) => fireEvent.click(screen.getByRole('button', { name: `Sửa ${name}` }));
const form = () => screen.getByRole('form', { name: 'Sửa người dùng' });
const chip = (name: string) => within(form()).getByRole('checkbox', { name });

describe('UsersSection - nhiều vai trò và nhiều nhóm', () => {
  beforeEach(() => {
    api.createUser.mockReset().mockResolvedValue({ ok: true, data: { displayName: 'An' } });
    api.updateUserRoles.mockReset().mockImplementation((id: string, roles: AdminUser['roles']) => respond(id, { roles, role: roles[0] === 'EDITOR' ? 'STAFF' : (roles[0] as AdminUser['role']) }));
    api.updateUserTeams.mockReset().mockImplementation((id: string, teamIds: string[]) => respond(id, { teamIds, teamId: teamIds[0] ?? null }));
    api.updateUserStatus.mockReset().mockImplementation((id: string, status: string) => respond(id, { isActive: status === 'ACTIVE' }));
    useAuthStore.setState({ accessToken: null, user: null, isInitialized: true });
    showToast.mockReset();
    users = [make({ id: 'u1', displayName: 'An', role: 'MANAGER', roles: ['MANAGER', 'STAFF', 'EDITOR'], teamIds: ['t1', 't2'] }), make({ id: 'u2', displayName: 'Boss', role: 'ADMIN', roles: ['ADMIN'], teamId: null, teamIds: [] })];
  });

  it('hiện mọi vai trò và mọi nhóm của người dùng; Quản trị thuần không hiện nhóm', () => {
    render(<UsersSection />);
    const [anRow, bossRow] = screen.getAllByRole('listitem');
    expect(within(anRow).getByText('Quản lý')).toBeInTheDocument();
    expect(within(anRow).getByText('Nhân viên')).toBeInTheDocument();
    expect(within(anRow).getByText('Biên tập')).toBeInTheDocument();
    expect(within(anRow).getByText('Nhóm Một')).toBeInTheDocument();
    expect(within(anRow).getByText('Nhóm Hai')).toBeInTheDocument();
    expect(within(bossRow).getByText('Quản trị')).toBeInTheDocument();
    expect(within(bossRow).queryByText(/Nhóm/)).not.toBeInTheDocument();
  });

  it('thêm vai trò + nhóm: gọi /roles trước rồi /teams (nhóm chọn đầu = nhóm chính), giữ role EDITOR sẵn có', async () => {
    users = [make({ id: 'u1', displayName: 'An', role: 'STAFF', roles: ['STAFF', 'EDITOR'], teamIds: ['t1'] })];
    render(<UsersSection />);
    openEdit('An');
    fireEvent.click(chip('Quản lý'));
    fireEvent.click(chip('Nhóm Hai'));
    fireEvent.click(within(form()).getByRole('button', { name: 'Lưu' }));

    await waitFor(() => expect(api.updateUserTeams).toHaveBeenCalledWith('u1', ['t1', 't2']));
    expect(api.updateUserRoles).toHaveBeenCalledWith('u1', ['MANAGER', 'STAFF', 'EDITOR']);
    expect(api.updateUserRoles.mock.invocationCallOrder[0]).toBeLessThan(api.updateUserTeams.mock.invocationCallOrder[0]);
    expect(showToast).toHaveBeenCalledWith({ title: 'Đã lưu người dùng An' });
    await waitFor(() => expect(screen.queryByRole('form', { name: 'Sửa người dùng' })).not.toBeInTheDocument());
  });

  it('bỏ cả Quản lý lẫn Nhân viên: ẩn ô chọn nhóm, cảnh báo gỡ nhóm và KHÔNG gọi /teams', async () => {
    users = [make({ id: 'u1', displayName: 'An', role: 'STAFF', roles: ['STAFF'], teamIds: ['t1'] })];
    render(<UsersSection />);
    openEdit('An');
    expect(chip('Nhóm Một')).toBeChecked();

    fireEvent.click(chip('Quản trị'));
    fireEvent.click(chip('Nhân viên'));
    expect(within(form()).queryByRole('checkbox', { name: 'Nhóm Một' })).not.toBeInTheDocument();
    expect(within(form()).getByText(/mới thuộc nhóm/)).toBeInTheDocument();
    expect(within(form()).getByRole('note')).toHaveTextContent('gỡ tài khoản này khỏi mọi nhóm');
    fireEvent.click(within(form()).getByRole('button', { name: 'Lưu' }));

    await waitFor(() => expect(api.updateUserRoles).toHaveBeenCalledWith('u1', ['ADMIN']));
    expect(api.updateUserTeams).not.toHaveBeenCalled();
  });

  it('lỗi 400 từ /teams hiện ngay trong form và giữ nguyên lựa chọn đang nhập (không đóng form)', async () => {
    users = [make({ id: 'u1', displayName: 'An', role: 'STAFF', roles: ['STAFF'], teamIds: ['t1'] })];
    api.updateUserTeams.mockResolvedValue({ ok: false, error: { statusCode: 400, errorCode: 'VALIDATION_FAILED', message: 'Nhóm không tồn tại hoặc đã ngừng hoạt động' } });
    render(<UsersSection />);
    openEdit('An');
    fireEvent.click(chip('Nhóm Hai'));
    fireEvent.click(within(form()).getByRole('button', { name: 'Lưu' }));

    expect(await screen.findByText(/Chưa lưu được nhóm: Nhóm không tồn tại hoặc đã ngừng hoạt động/)).toBeInTheDocument();
    expect(chip('Nhóm Hai')).toBeChecked();
    expect(showToast).not.toHaveBeenCalled();
  });

  it('nhóm đã ngừng hoạt động mà người này còn thuộc vẫn hiện (có nhãn) để gỡ được', () => {
    users = [make({ id: 'u1', displayName: 'An', role: 'STAFF', roles: ['STAFF'], teamIds: ['t3'] })];
    render(<UsersSection />);
    openEdit('An');
    expect(chip('Nhóm Cũ (ngừng hoạt động)')).toBeChecked();
  });

  it('tạo tài khoản: chọn nhiều vai trò + nhiều nhóm -> body roles[] + teamIds[], không có role/teamId đơn', async () => {
    render(<UsersSection />);
    fireEvent.click(screen.getByRole('button', { name: 'Thêm người dùng' }));
    const createForm = screen.getByRole('form', { name: 'Thêm người dùng' });
    fireEvent.change(within(createForm).getByLabelText(/Email đăng nhập/), { target: { value: 'New@Mail.vn' } });
    fireEvent.change(within(createForm).getByLabelText(/Mật khẩu/), { target: { value: 'Matkhau123' } });
    fireEvent.change(within(createForm).getByLabelText(/Tên hiển thị/), { target: { value: 'Người Mới' } });
    // Mặc định: Nhân viên + nhóm đầu tiên.
    expect(within(createForm).getByRole('checkbox', { name: 'Nhân viên' })).toBeChecked();
    expect(within(createForm).getByRole('checkbox', { name: 'Nhóm Một' })).toBeChecked();
    fireEvent.click(within(createForm).getByRole('checkbox', { name: 'Quản lý' }));
    fireEvent.click(within(createForm).getByRole('checkbox', { name: 'Nhóm Hai' }));
    fireEvent.click(within(createForm).getByRole('button', { name: 'Thêm' }));

    await waitFor(() => expect(api.createUser).toHaveBeenCalledTimes(1));
    expect(api.createUser).toHaveBeenCalledWith({ email: 'new@mail.vn', password: 'Matkhau123', displayName: 'Người Mới', roles: ['MANAGER', 'STAFF'], teamIds: ['t1', 't2'] });
  });

  it('tạo tài khoản chỉ Quản trị: không hiện chọn nhóm và không gửi teamIds', async () => {
    render(<UsersSection />);
    fireEvent.click(screen.getByRole('button', { name: 'Thêm người dùng' }));
    const createForm = screen.getByRole('form', { name: 'Thêm người dùng' });
    fireEvent.change(within(createForm).getByLabelText(/Email đăng nhập/), { target: { value: 'a@b.vn' } });
    fireEvent.change(within(createForm).getByLabelText(/Mật khẩu/), { target: { value: 'Matkhau123' } });
    fireEvent.change(within(createForm).getByLabelText(/Tên hiển thị/), { target: { value: 'Quản' } });
    fireEvent.click(within(createForm).getByRole('checkbox', { name: 'Quản trị' }));
    fireEvent.click(within(createForm).getByRole('checkbox', { name: 'Nhân viên' }));
    expect(within(createForm).queryByRole('checkbox', { name: 'Nhóm Một' })).not.toBeInTheDocument();
    fireEvent.click(within(createForm).getByRole('button', { name: 'Thêm' }));

    await waitFor(() => expect(api.createUser).toHaveBeenCalledWith({ email: 'a@b.vn', password: 'Matkhau123', displayName: 'Quản', roles: ['ADMIN'] }));
  });

  describe('Quản trị tự sửa chính mình', () => {
    const me = () => make({ id: 'me', displayName: 'Tôi', role: 'ADMIN', roles: ['ADMIN', 'STAFF'], teamId: 't1', teamIds: ['t1'] });
    beforeEach(() => {
      users = [me(), make({ id: 'u2', displayName: 'Khác', role: 'ADMIN', roles: ['ADMIN'], teamId: null, teamIds: [] })];
      useAuthStore.setState({ accessToken: 't', user: { _id: 'me', email: 'me@x.vn', displayName: 'Tôi', role: 'ADMIN', roles: ['ADMIN', 'STAFF'], teamId: 't1' } });
    });

    it('cảnh báo mất Quản trị; /teams (cần ADMIN) chạy TRƯỚC /roles; xong thì phiên đăng nhập cập nhật theo vai trò mới', async () => {
      render(<UsersSection />);
      openEdit('Tôi');
      fireEvent.click(chip('Quản trị'));
      expect(within(form()).getByRole('note')).toHaveTextContent('Bạn sắp bỏ vai trò Quản trị của chính mình');
      fireEvent.click(chip('Nhóm Hai'));
      fireEvent.click(within(form()).getByRole('button', { name: 'Lưu' }));

      await waitFor(() => expect(api.updateUserRoles).toHaveBeenCalledWith('me', ['STAFF']));
      expect(api.updateUserTeams).toHaveBeenCalledWith('me', ['t1', 't2']);
      expect(api.updateUserTeams.mock.invocationCallOrder[0]).toBeLessThan(api.updateUserRoles.mock.invocationCallOrder[0]);
      // Một thông điệp thống nhất qua đường chuyển hướng (không toast thường, để khỏi trùng toast lỗi "không có quyền").
      expect(showToast).not.toHaveBeenCalled();
      expect(peekQueuedRedirectNotice()).toMatch(/Đã lưu người dùng Tôi. Bạn không còn là Quản trị/);
      expect(useAuthStore.getState().user).toMatchObject({ role: 'STAFF', roles: ['STAFF'] });
    });

    it('đang sửa CHÍNH MÌNH thì công tắc "Đang hoạt động" bị vô hiệu (không tự khóa mình); sửa người khác thì bật được', () => {
      render(<UsersSection />);
      openEdit('Tôi');
      expect(within(form()).getByRole('switch', { name: 'Đang hoạt động' })).toBeDisabled();
      expect(within(form()).getByText('Bạn không thể tự khoá tài khoản của chính mình')).toBeInTheDocument();
      fireEvent.click(within(form()).getByRole('button', { name: 'Huỷ' }));
      openEdit('Khác');
      expect(within(form()).getByRole('switch', { name: 'Đang hoạt động' })).toBeEnabled();
    });

    it('bước cần quyền Quản trị bị 403 thì giải thích rõ nghĩa và KHÔNG gọi /roles (vẫn còn là Quản trị)', async () => {
      api.updateUserTeams.mockResolvedValueOnce(failure(403, 'INSUFFICIENT_ROLE', 'Bạn không có quyền thực hiện thao tác này'));
      render(<UsersSection />);
      openEdit('Tôi');
      fireEvent.click(chip('Quản trị'));
      fireEvent.click(chip('Nhóm Hai'));
      fireEvent.click(within(form()).getByRole('button', { name: 'Lưu' }));

      expect(await screen.findByText(/không còn quyền Quản trị để thực hiện bước này/)).toBeInTheDocument();
      expect(api.updateUserRoles).not.toHaveBeenCalled();
      expect(useAuthStore.getState().user?.roles).toEqual(['ADMIN', 'STAFF']);
    });

    it('LAST_ADMIN_REQUIRED từ /roles hiện nguyên lời máy chủ trong form', async () => {
      api.updateUserRoles.mockResolvedValueOnce(failure(409, 'LAST_ADMIN_REQUIRED', 'Hệ thống phải còn ít nhất một Quản trị đang hoạt động'));
      render(<UsersSection />);
      openEdit('Khác');
      fireEvent.click(chip('Nhân viên'));
      fireEvent.click(chip('Quản trị'));
      fireEvent.click(chip('Nhóm Một'));
      fireEvent.click(within(form()).getByRole('button', { name: 'Lưu' }));

      expect(await screen.findByText(/chưa lưu được vai trò: Hệ thống phải còn ít nhất một Quản trị đang hoạt động/i)).toBeInTheDocument();
      expect(api.updateUserTeams).not.toHaveBeenCalled();
    });

    it('Admin DUY NHẤT tự bỏ ADMIN: /roles tạm chạy đầu, /roles cuối bị LAST_ADMIN_REQUIRED -> phiên thành ADMIN+STAFF; Lưu lại không gửi lại bước tạm và /teams', async () => {
      users = [make({ id: 'me', displayName: 'Tôi', role: 'ADMIN', roles: ['ADMIN'], teamId: null, teamIds: [] })];
      useAuthStore.setState({ user: { _id: 'me', email: 'me@x.vn', displayName: 'Tôi', role: 'ADMIN', roles: ['ADMIN'], teamId: null } });
      api.updateUserRoles.mockImplementationOnce((id: string, roles: AdminUser['roles']) => respond(id, { roles, role: 'ADMIN' }));
      api.updateUserRoles.mockImplementationOnce(() => Promise.resolve(failure(409, 'LAST_ADMIN_REQUIRED', 'Hệ thống phải còn ít nhất một Quản trị đang hoạt động')));
      render(<UsersSection />);
      openEdit('Tôi');
      fireEvent.click(chip('Nhân viên'));
      fireEvent.click(chip('Quản trị'));
      fireEvent.click(chip('Nhóm Một'));
      fireEvent.click(within(form()).getByRole('button', { name: 'Lưu' }));

      expect(await screen.findByText('Đã lưu vai trò mới thêm, nhóm; chưa lưu được vai trò: Hệ thống phải còn ít nhất một Quản trị đang hoạt động. Bấm Lưu để thử lại.')).toBeInTheDocument();
      expect(api.updateUserRoles.mock.calls.map(([, roles]) => roles)).toEqual([['ADMIN', 'STAFF'], ['STAFF']]);
      expect(useAuthStore.getState().user).toMatchObject({ role: 'ADMIN', roles: ['ADMIN', 'STAFF'] });

      // Lưu lại (lần này thành công): chỉ còn bước /roles cuối.
      fireEvent.click(within(form()).getByRole('button', { name: 'Lưu' }));
      await waitFor(() => expect(useAuthStore.getState().user).toMatchObject({ role: 'STAFF', roles: ['STAFF'] }));
      expect(api.updateUserRoles.mock.calls.map(([, roles]) => roles)).toEqual([['ADMIN', 'STAFF'], ['STAFF'], ['STAFF']]);
      expect(api.updateUserTeams).toHaveBeenCalledTimes(1);
    });
  });

  it('lưu dở dang: báo rõ phần đã lưu/chưa lưu, form còn mở; bấm Lưu lại chỉ chạy phần còn thiếu', async () => {
    users = [make({ id: 'u1', displayName: 'An', role: 'STAFF', roles: ['STAFF'], teamIds: ['t1'] })];
    api.updateUserTeams.mockResolvedValueOnce(failure(400, 'VALIDATION_FAILED', 'Nhóm không tồn tại'));
    render(<UsersSection />);
    openEdit('An');
    fireEvent.click(chip('Quản lý'));
    fireEvent.click(chip('Nhóm Hai'));
    fireEvent.click(within(form()).getByLabelText('Đang hoạt động'));
    fireEvent.click(within(form()).getByRole('button', { name: 'Lưu' }));

    expect(await screen.findByText('Đã lưu vai trò; chưa lưu được nhóm: Nhóm không tồn tại (chưa thực hiện: trạng thái). Bấm Lưu để thử lại phần còn lại.')).toBeInTheDocument();
    expect(api.updateUserStatus).not.toHaveBeenCalled();
    expect(showToast).not.toHaveBeenCalled();

    fireEvent.click(within(form()).getByRole('button', { name: 'Lưu' }));
    await waitFor(() => expect(api.updateUserStatus).toHaveBeenCalledWith('u1', 'BLOCKED'));
    expect(api.updateUserRoles).toHaveBeenCalledTimes(1);
    expect(api.updateUserTeams).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(screen.queryByRole('form', { name: 'Sửa người dùng' })).not.toBeInTheDocument());
  });
});
