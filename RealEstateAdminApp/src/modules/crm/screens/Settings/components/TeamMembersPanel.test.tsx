import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { AdminUser, TeamMember } from '@crm/types/crm';
import { listAddableUsers } from '../settingsForms';
import { TeamMembersPanel } from './TeamMembersPanel';

const api = { addTeamMember: vi.fn(), removeTeamMember: vi.fn() };
const showToast = vi.fn();
let members: TeamMember[] = [];

vi.mock('@crm/api', () => ({
  useCrmApi: () => api,
  useTeamMembers: () => ({ data: { data: members, meta: { total: members.length, page: 1, limit: 10, totalPages: 1 } }, isLoading: false, isFetching: false, isError: false, error: null, refetch: vi.fn() }),
}));
vi.mock('@crm/store', () => ({ useCrmActions: () => ({ showToast }) }));

const member = (patch: Partial<TeamMember>): TeamMember => ({ id: 'm1', displayName: 'Hạnh', role: 'MANAGER', roles: ['MANAGER'], isActive: true, isManager: false, ...patch });
const user = (patch: Partial<AdminUser>): AdminUser => ({ id: 'u1', fullName: 'An', displayName: 'An', role: 'STAFF', jobTitle: '', teamId: null, isActive: true, roles: ['STAFF'], teamIds: [], ...patch });
const team = { id: 't1', name: 'Nhóm Một', isActive: true };

describe('listAddableUsers', () => {
  it('chỉ người đang hoạt động, có Quản lý/Nhân viên và chưa thuộc nhóm', () => {
    const users = [user({ id: 'ok' }), user({ id: 'in', teamIds: ['t1'] }), user({ id: 'off', isActive: false }), user({ id: 'admin', role: 'ADMIN', roles: ['ADMIN'] }), user({ id: 'adm-staff', role: 'ADMIN', roles: ['ADMIN', 'STAFF'], teamIds: ['t2'] })];
    expect(listAddableUsers(users, 't1').map((u) => u.id)).toEqual(['ok', 'adm-staff']);
  });
});

describe('TeamMembersPanel', () => {
  beforeEach(() => {
    api.addTeamMember.mockReset().mockResolvedValue({ ok: true, data: { displayName: 'An' } });
    api.removeTeamMember.mockReset().mockResolvedValue({ ok: true, data: undefined });
    showToast.mockReset();
    members = [member({ id: 'm1', displayName: 'Hạnh', isManager: true }), member({ id: 'm2', displayName: 'Thảo', role: 'STAFF', roles: ['STAFF', 'EDITOR'] })];
  });

  it('hiện thành viên với đủ vai trò và badge Quản lý nhóm theo isManager; Quản lý (không phải Admin) chỉ xem: không có Thêm/Gỡ', () => {
    render(<TeamMembersPanel team={team} canManage={false} users={[]} />);
    const rows = screen.getAllByRole('listitem');
    expect(within(rows[0]).getByText('Quản lý nhóm')).toBeInTheDocument();
    expect(within(rows[1]).getByText('Nhân viên')).toBeInTheDocument();
    expect(within(rows[1]).getByText('Biên tập')).toBeInTheDocument();
    expect(within(rows[1]).queryByText('Quản lý nhóm')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Gỡ/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Thêm thành viên' })).not.toBeInTheDocument();
  });

  it('Admin gỡ người là Quản lý của nhóm: confirm nói rõ vẫn là Quản lý, gỡ xong có toast tương tự', async () => {
    render(<TeamMembersPanel team={team} canManage users={[]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Gỡ Hạnh khỏi nhóm' }));
    expect(await screen.findByText(/Người này vẫn là Quản lý của nhóm/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Gỡ khỏi nhóm' }));
    await waitFor(() => expect(api.removeTeamMember).toHaveBeenCalledWith('t1', 'm1'));
    expect(showToast).toHaveBeenCalledWith({ title: expect.stringContaining('Người này vẫn là Quản lý của nhóm') });
  });

  it('gỡ thất bại (vd 404) báo lỗi bằng toast và không báo thành công', async () => {
    api.removeTeamMember.mockResolvedValue({ ok: false, error: { statusCode: 404, errorCode: 'RESOURCE_NOT_FOUND', message: 'Không tìm thấy nhóm' } });
    render(<TeamMembersPanel team={team} canManage users={[]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Gỡ Thảo khỏi nhóm' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Gỡ khỏi nhóm' }));
    await waitFor(() => expect(showToast).toHaveBeenCalledWith({ type: 'error', title: 'Không tìm thấy nhóm' }));
  });

  it('Admin thêm thành viên: chọn người chưa thuộc nhóm rồi Thêm; lỗi 400 hiện ngay trong panel', async () => {
    const users = [user({ id: 'u1', displayName: 'An', roles: ['STAFF', 'EDITOR'] }), user({ id: 'u2', displayName: 'Bình', teamIds: ['t1'] })];
    render(<TeamMembersPanel team={team} canManage users={users} />);
    const addButton = screen.getByRole('button', { name: 'Thêm thành viên' });
    expect(addButton).toBeDisabled();
    fireEvent.focus(screen.getByRole('combobox', { name: 'Chọn người để thêm vào nhóm' }));
    fireEvent.mouseDown(await screen.findByRole('option', { name: 'An (Nhân viên, Biên tập)' }));
    expect(screen.queryByRole('option', { name: /Bình/ })).not.toBeInTheDocument();
    api.addTeamMember.mockResolvedValueOnce({ ok: false, error: { statusCode: 400, errorCode: 'VALIDATION_FAILED', message: 'Người dùng không có vai trò Quản lý/Nhân viên' } });
    fireEvent.click(addButton);
    expect(await screen.findByText('Người dùng không có vai trò Quản lý/Nhân viên')).toBeInTheDocument();
    expect(api.addTeamMember).toHaveBeenCalledWith('t1', 'u1');
    expect(showToast).not.toHaveBeenCalled();

    fireEvent.click(addButton);
    await waitFor(() => expect(showToast).toHaveBeenCalledWith({ title: 'Đã thêm An vào nhóm "Nhóm Một"' }));
  });
});
