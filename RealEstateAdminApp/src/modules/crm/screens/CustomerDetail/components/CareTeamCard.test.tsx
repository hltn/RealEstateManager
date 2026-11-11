/** Nhóm chăm sóc v1.0.5: PRIMARY cố định, chỉ MỜI thành viên phụ (tối đa 10), đặt PRIMARY lần đầu cho khách chưa có nhóm. */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CareTeamInvitee, CareTeamMemberView, CustomerDetail } from '@crm/api';
import { useAuthStore } from '../../../../../stores/auth.store';
import { CareTeamCard } from './CareTeamCard';

const addCareTeamMembers = vi.fn();
const removeCareTeamMember = vi.fn();
const showToast = vi.fn();
const useCareTeamInvitees = vi.fn();
const actorRef = { current: { userId: 'admin-1', role: 'ADMIN' as 'ADMIN' | 'MANAGER' | 'STAFF', teamId: null as string | null, managedTeamIds: [] as string[] } };

vi.mock('@crm/api', async () => {
  const actual = await vi.importActual<typeof import('@crm/api')>('@crm/api');
  return { ...actual, useCrmApi: () => ({ addCareTeamMembers, removeCareTeamMember }), useCareTeamInvitees: (...args: unknown[]) => useCareTeamInvitees(...args), useCrmActor: () => actorRef.current };
});
vi.mock('@crm/store', () => ({ useCrmActions: () => ({ showToast }) }));

const invitees: CareTeamInvitee[] = [
  { id: 'u-new', displayName: 'Lan', teamNames: ['Nhóm A'] },
  { id: 'u-new2', displayName: 'Tuấn', teamNames: [] },
];

const member = (id: string, role: 'PRIMARY' | 'MEMBER', extra: Partial<CareTeamMemberView['user']> = {}): CareTeamMemberView => ({
  user: { id, displayName: `Tên ${id}`, fullName: `Họ Tên ${id}`, jobTitle: 'Chuyên viên', ...extra },
  role,
  addedAt: '2026-10-01T00:00:00.000Z',
  addedBy: { id: 'admin', displayName: 'Admin' },
});

const customerOf = (careTeam: CareTeamMemberView[], permissions: Partial<CustomerDetail['permissions']> = {}): CustomerDetail =>
  ({
    id: 'c1',
    careTeam,
    permissions: { canEdit: true, canManageCareTeam: true, canSetInitialPrimary: false, canDelete: false, canRevealNationalId: false, ...permissions },
  }) as unknown as CustomerDetail;

const members = (count: number) => Array.from({ length: count }, (_, index) => member(`m${index}`, 'MEMBER'));

/** Đặt role của tài khoản đăng nhập (nguồn quyết định "Chính tôi": role MANAGER/STAFF, không phải role đại diện của actor). */
const signInAs = (roles: string[]) => useAuthStore.setState({ accessToken: 't', user: { _id: actorRef.current.userId, email: 'a@b.vn', displayName: 'An', role: roles[0], roles } as never, isInitialized: true });

afterEach(() => useAuthStore.setState({ accessToken: null, user: null, isInitialized: true }));

beforeEach(() => {
  actorRef.current = { userId: 'admin-1', role: 'ADMIN', teamId: null, managedTeamIds: [] };
  signInAs(['ADMIN']);
  addCareTeamMembers.mockReset();
  removeCareTeamMember.mockReset();
  showToast.mockReset();
  useCareTeamInvitees.mockReset();
  useCareTeamInvitees.mockReturnValue({ data: { data: invitees, meta: { total: 2, page: 1, limit: 20, totalPages: 1 } }, isLoading: false, isFetching: false, isError: false, error: null, refetch: vi.fn() });
});

describe('CareTeamCard - PRIMARY cố định', () => {
  it('PRIMARY có nhãn "Chủ khách", không có nút đổi/gỡ PRIMARY; MEMBER có nút gỡ', () => {
    render(<CareTeamCard customer={customerOf([member('p', 'PRIMARY'), member('m1', 'MEMBER')])} />);
    expect(screen.getByText('Chủ khách')).toBeInTheDocument();
    expect(screen.getByText(/không đổi hoặc gỡ được/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Gỡ Tên p/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Đổi|chuyển/i })).toBeNull();
    expect(screen.getByRole('button', { name: 'Gỡ Tên m1 khỏi nhóm chăm sóc' })).toBeInTheDocument();
  });

  it('thành viên có tài khoản bị khóa hiện nhãn "đã khóa"', () => {
    render(<CareTeamCard customer={customerOf([member('p', 'PRIMARY', { isLocked: true }), member('m1', 'MEMBER')])} />);
    expect(screen.getAllByText('đã khóa')).toHaveLength(1);
  });

  it('không có luồng xin tham gia: không nút "Xin tham gia"/"Đề nghị"/"Duyệt"', () => {
    render(<CareTeamCard customer={customerOf([member('p', 'PRIMARY')], { canManageCareTeam: false })} />);
    expect(screen.queryByRole('button', { name: /xin|đề nghị|duyệt|từ chối/i })).toBeNull();
  });
});

describe('CareTeamCard - quyền mời / gỡ', () => {
  it('Staff là PRIMARY (canManageCareTeam) thấy nút Mời', () => {
    render(<CareTeamCard customer={customerOf([member('p', 'PRIMARY'), member('m1', 'MEMBER')])} />);
    expect(screen.getByRole('button', { name: 'Mời người' })).toBeEnabled();
  });

  it('Staff là MEMBER (không canManageCareTeam) không thấy Mời, không có nút gỡ, không có bộ đếm', () => {
    render(<CareTeamCard customer={customerOf([member('p', 'PRIMARY'), member('m1', 'MEMBER')], { canManageCareTeam: false })} />);
    expect(screen.queryByRole('button', { name: 'Mời người' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Gỡ/ })).toBeNull();
    expect(screen.queryByText(/thành viên phụ$/)).toBeNull();
  });

  it('khách chưa có PRIMARY: không cho Mời (cần đặt người chăm sóc chính trước)', () => {
    render(<CareTeamCard customer={customerOf([])} />);
    expect(screen.queryByRole('button', { name: 'Mời người' })).toBeNull();
  });
});

describe('CareTeamCard - giới hạn 10 thành viên phụ', () => {
  it('hiện x/10 thành viên phụ (PRIMARY không tính)', () => {
    render(<CareTeamCard customer={customerOf([member('p', 'PRIMARY'), ...members(3)])} />);
    expect(screen.getByText('3/10 thành viên phụ')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mời người' })).toBeEnabled();
  });

  it('đủ 10/10: nút Mời bị khoá và có lời giải thích', () => {
    render(<CareTeamCard customer={customerOf([member('p', 'PRIMARY'), ...members(10)])} />);
    expect(screen.getByText('10/10 thành viên phụ')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mời người' })).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('đã đủ 10 thành viên phụ');
  });

  it('còn 1 chỗ: chỉ mời được đúng 1 người (chọn người khác thì thay người trước)', async () => {
    addCareTeamMembers.mockResolvedValue({ ok: true, data: undefined });
    render(<CareTeamCard customer={customerOf([member('p', 'PRIMARY'), ...members(9)])} />);
    fireEvent.click(screen.getByRole('button', { name: 'Mời người' }));
    fireEvent.click(screen.getByRole('radio', { name: /Lan/ }));
    fireEvent.click(screen.getByRole('radio', { name: /Tuấn/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Mời 1 người' }));
    await waitFor(() => expect(addCareTeamMembers).toHaveBeenCalledWith('c1', { userIds: ['u-new2'] }));
  });

  it('còn đúng 1 chỗ: có dòng gợi ý chọn người khác sẽ thay người đã chọn; còn nhiều chỗ thì không có', () => {
    const { unmount } = render(<CareTeamCard customer={customerOf([member('p', 'PRIMARY'), ...members(9)])} />);
    fireEvent.click(screen.getByRole('button', { name: 'Mời người' }));
    expect(screen.getByText(/Còn đúng 1 chỗ/)).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Lan/ })).toBeInTheDocument();
    unmount();
    render(<CareTeamCard customer={customerOf([member('p', 'PRIMARY'), ...members(8)])} />);
    fireEvent.click(screen.getByRole('button', { name: 'Mời người' }));
    expect(screen.queryByText(/Còn đúng 1 chỗ/)).toBeNull();
  });

  it('còn 2 chỗ: chọn người thứ 3 bị khoá', () => {
    useCareTeamInvitees.mockReturnValue({
      data: { data: [...invitees, { id: 'u-3', displayName: 'Bảo', teamNames: [] }], meta: { total: 3, page: 1, limit: 20, totalPages: 1 } },
      isLoading: false,
      isFetching: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });
    render(<CareTeamCard customer={customerOf([member('p', 'PRIMARY'), ...members(8)])} />);
    fireEvent.click(screen.getByRole('button', { name: 'Mời người' }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Lan/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Tuấn/ }));
    expect(screen.getByRole('checkbox', { name: /Bảo/ })).toBeDisabled();
  });

  it('server trả CARE_TEAM_LIMIT_EXCEEDED: hiện lời báo, giữ khung mời và lựa chọn', async () => {
    addCareTeamMembers.mockResolvedValue({ ok: false, error: { statusCode: 422, errorCode: 'CARE_TEAM_LIMIT_EXCEEDED', message: 'raw' } });
    render(<CareTeamCard customer={customerOf([member('p', 'PRIMARY'), member('m1', 'MEMBER')])} />);
    fireEvent.click(screen.getByRole('button', { name: 'Mời người' }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Lan/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Mời 1 người' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('đã đủ 10 thành viên phụ');
    expect(screen.getByRole('button', { name: 'Mời 1 người' })).toBeInTheDocument();
    expect(showToast).not.toHaveBeenCalled();
  });
});

describe('CareTeamCard - mời và gỡ', () => {
  it('chỉ tải danh sách người khi mở khung mời (không gọi query lúc mở hồ sơ)', () => {
    render(<CareTeamCard customer={customerOf([member('p', 'PRIMARY')])} />);
    expect(useCareTeamInvitees).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Mời người' }));
    expect(useCareTeamInvitees).toHaveBeenCalledWith('c1', '', 1);
  });

  it('mời nhiều người: gọi addCareTeamMembers với userIds, không có primaryUserId; thành công thì đóng khung và báo', async () => {
    addCareTeamMembers.mockResolvedValue({ ok: true, data: undefined });
    render(<CareTeamCard customer={customerOf([member('p', 'PRIMARY')])} />);
    fireEvent.click(screen.getByRole('button', { name: 'Mời người' }));
    expect(screen.getByRole('button', { name: 'Mời' })).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: /Lan/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Tuấn/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Mời 2 người' }));
    await waitFor(() => expect(addCareTeamMembers).toHaveBeenCalledWith('c1', { userIds: ['u-new', 'u-new2'] }));
    await waitFor(() => expect(screen.queryByLabelText('Tìm người để mời')).toBeNull());
    expect(showToast).toHaveBeenCalledWith({ title: 'Đã mời 2 người vào nhóm chăm sóc' });
  });

  it('Huỷ đóng khung mời và bỏ lựa chọn', () => {
    render(<CareTeamCard customer={customerOf([member('p', 'PRIMARY')])} />);
    fireEvent.click(screen.getByRole('button', { name: 'Mời người' }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Lan/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Huỷ' }));
    expect(screen.queryByLabelText('Tìm người để mời')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Mời người' }));
    expect(screen.getByRole('checkbox', { name: /Lan/ })).not.toBeChecked();
  });

  it('gỡ MEMBER gọi removeCareTeamMember; lỗi hiện toast lỗi theo mã', async () => {
    removeCareTeamMember.mockResolvedValue({ ok: false, error: { statusCode: 409, errorCode: 'PRIMARY_LOCKED', message: 'raw' } });
    render(<CareTeamCard customer={customerOf([member('p', 'PRIMARY'), member('m1', 'MEMBER')])} />);
    fireEvent.click(screen.getByRole('button', { name: 'Gỡ Tên m1 khỏi nhóm chăm sóc' }));
    await waitFor(() => expect(removeCareTeamMember).toHaveBeenCalledWith('c1', 'm1'));
    await waitFor(() => expect(showToast).toHaveBeenCalledWith({ type: 'error', title: expect.stringContaining('cố định') }));
  });

  it('gỡ MEMBER thành công báo toast', async () => {
    removeCareTeamMember.mockResolvedValue({ ok: true, data: undefined });
    render(<CareTeamCard customer={customerOf([member('p', 'PRIMARY'), member('m1', 'MEMBER')])} />);
    fireEvent.click(screen.getByRole('button', { name: 'Gỡ Tên m1 khỏi nhóm chăm sóc' }));
    await waitFor(() => expect(showToast).toHaveBeenCalledWith({ title: 'Đã gỡ Tên m1 khỏi nhóm chăm sóc' }));
  });
});

describe('CareTeamCard - trợ năng: focus', () => {
  it('mở khung mời: focus vào ô tìm; đóng bằng Huỷ: focus trở về nút "Mời người"', async () => {
    render(<CareTeamCard customer={customerOf([member('p', 'PRIMARY')])} />);
    fireEvent.click(screen.getByRole('button', { name: 'Mời người' }));
    expect(screen.getByLabelText('Tìm người để mời')).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: 'Huỷ' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Mời người' })).toHaveFocus());
  });

  it('mời thành công đóng khung: focus trở về nút "Mời người"', async () => {
    addCareTeamMembers.mockResolvedValue({ ok: true, data: undefined });
    render(<CareTeamCard customer={customerOf([member('p', 'PRIMARY')])} />);
    fireEvent.click(screen.getByRole('button', { name: 'Mời người' }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Lan/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Mời 1 người' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Mời người' })).toHaveFocus());
  });

  it('đặt PRIMARY thành công: nút đặt PRIMARY biến mất, focus chuyển sang nút "Mời người" (không rơi về body)', async () => {
    addCareTeamMembers.mockResolvedValue({ ok: true, data: undefined });
    const { rerender } = render(<CareTeamCard customer={customerOf([], { canSetInitialPrimary: true })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Đặt người chăm sóc chính' }));
    fireEvent.click(screen.getByRole('radio', { name: /Lan/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Đặt làm người chăm sóc chính' }));
    await waitFor(() => expect(addCareTeamMembers).toHaveBeenCalled());
    // Dữ liệu khách tải lại: đã có PRIMARY -> nút đặt PRIMARY biến mất, nút "Mời người" xuất hiện.
    rerender(<CareTeamCard customer={customerOf([member('u-new', 'PRIMARY')])} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Mời người' })).toHaveFocus());
    expect(screen.queryByRole('button', { name: 'Đặt người chăm sóc chính' })).toBeNull();
  });

  it('mở lại khung khác trước khi dữ liệu tải lại: không cướp focus về nút cũ', async () => {
    addCareTeamMembers.mockResolvedValue({ ok: true, data: undefined });
    const { rerender } = render(<CareTeamCard customer={customerOf([], { canSetInitialPrimary: true })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Đặt người chăm sóc chính' }));
    fireEvent.click(screen.getByRole('radio', { name: /Lan/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Đặt làm người chăm sóc chính' }));
    await waitFor(() => expect(addCareTeamMembers).toHaveBeenCalled());
    fireEvent.click(await screen.findByRole('button', { name: 'Đặt người chăm sóc chính' }));
    const search = screen.getByLabelText('Tìm người để mời');
    rerender(<CareTeamCard customer={customerOf([member('u-new', 'PRIMARY')])} />);
    expect(search).toHaveFocus();
  });

  it('khung đặt người chăm sóc chính: focus vào ô tìm, đóng thì trả focus về nút "Đặt người chăm sóc chính"', async () => {
    render(<CareTeamCard customer={customerOf([], { canSetInitialPrimary: true })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Đặt người chăm sóc chính' }));
    expect(screen.getByLabelText('Tìm người để mời')).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: 'Huỷ' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Đặt người chăm sóc chính' })).toHaveFocus());
  });

  it('chọn người chăm sóc chính dùng radio (chọn một), không phải checkbox', () => {
    render(<CareTeamCard customer={customerOf([], { canSetInitialPrimary: true })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Đặt người chăm sóc chính' }));
    expect(screen.getByRole('radiogroup')).toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.getAllByRole('radio').length).toBeGreaterThanOrEqual(2);
  });
});

describe('CareTeamCard - lựa chọn "Chính tôi" khi đặt người chăm sóc chính', () => {
  it.each([
    ['MANAGER', ['MANAGER']],
    ['ADMIN kiêm MANAGER', ['ADMIN', 'MANAGER']],
    ['ADMIN kiêm STAFF', ['ADMIN', 'STAFF']],
  ])('%s: có lựa chọn "Chính tôi" trên cùng; chọn thì gửi primaryUserId = id người gọi', async (_name, roles) => {
    actorRef.current = { userId: 'me-9', role: roles[0] as 'ADMIN' | 'MANAGER', teamId: null, managedTeamIds: [] };
    signInAs(roles);
    addCareTeamMembers.mockResolvedValue({ ok: true, data: undefined });
    render(<CareTeamCard customer={customerOf([], { canSetInitialPrimary: true })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Đặt người chăm sóc chính' }));
    expect(screen.getAllByRole('radio')[0]).toHaveAccessibleName('Chính tôi');
    fireEvent.click(screen.getByRole('radio', { name: 'Chính tôi' }));
    fireEvent.click(screen.getByRole('button', { name: 'Đặt làm người chăm sóc chính' }));
    await waitFor(() => expect(addCareTeamMembers).toHaveBeenCalledWith('c1', { userIds: ['me-9'], primaryUserId: 'me-9' }));
    expect(showToast).toHaveBeenCalledWith({ title: 'Đã đặt người chăm sóc chính' });
  });

  it('ADMIN thuần: KHÔNG có "Chính tôi" (backend từ chối USER_NOT_ASSIGNABLE)', () => {
    actorRef.current = { userId: 'me-9', role: 'ADMIN', teamId: null, managedTeamIds: [] };
    signInAs(['ADMIN']);
    render(<CareTeamCard customer={customerOf([], { canSetInitialPrimary: true })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Đặt người chăm sóc chính' }));
    expect(screen.queryByText('Chính tôi')).toBeNull();
    expect(screen.getAllByRole('radio').length).toBeGreaterThanOrEqual(2);
  });

  it('"Chính tôi" thay người khác đã chọn (chỉ một PRIMARY)', async () => {
    actorRef.current = { userId: 'me-9', role: 'MANAGER', teamId: null, managedTeamIds: [] };
    signInAs(['MANAGER']);
    addCareTeamMembers.mockResolvedValue({ ok: true, data: undefined });
    render(<CareTeamCard customer={customerOf([], { canSetInitialPrimary: true })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Đặt người chăm sóc chính' }));
    fireEvent.click(screen.getByRole('radio', { name: /Lan/ }));
    fireEvent.click(screen.getByRole('radio', { name: 'Chính tôi' }));
    fireEvent.click(screen.getByRole('button', { name: 'Đặt làm người chăm sóc chính' }));
    await waitFor(() => expect(addCareTeamMembers).toHaveBeenCalledWith('c1', { userIds: ['me-9'], primaryUserId: 'me-9' }));
  });

  it('không đăng nhập (không có role): không thấy "Chính tôi"', () => {
    useAuthStore.setState({ user: null });
    render(<CareTeamCard customer={customerOf([], { canSetInitialPrimary: true })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Đặt người chăm sóc chính' }));
    expect(screen.queryByText('Chính tôi')).toBeNull();
  });

  it('Nhân viên đặt PRIMARY (khi cờ quyền bật) vẫn có "Chính tôi" theo role STAFF (BE nhận STAFF)', () => {
    actorRef.current = { userId: 'staff-1', role: 'STAFF', teamId: 't', managedTeamIds: [] };
    signInAs(['STAFF']);
    render(<CareTeamCard customer={customerOf([], { canSetInitialPrimary: true })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Đặt người chăm sóc chính' }));
    expect(screen.getByRole('radio', { name: 'Chính tôi' })).toBeInTheDocument();
  });

  it('Nhân viên không có quyền đặt PRIMARY: không có nút nên không có "Chính tôi"', () => {
    actorRef.current = { userId: 'staff-1', role: 'STAFF', teamId: 't', managedTeamIds: [] };
    render(<CareTeamCard customer={customerOf([], { canSetInitialPrimary: false })} />);
    expect(screen.queryByRole('button', { name: 'Đặt người chăm sóc chính' })).toBeNull();
    expect(screen.queryByText('Chính tôi')).toBeNull();
  });

  it('khung mời thành viên phụ (không phải đặt PRIMARY) không có "Chính tôi"', () => {
    render(<CareTeamCard customer={customerOf([member('p', 'PRIMARY')])} />);
    fireEvent.click(screen.getByRole('button', { name: 'Mời người' }));
    expect(screen.queryByText('Chính tôi')).toBeNull();
  });
});

describe('CareTeamCard - đặt người chăm sóc chính lần đầu', () => {
  it('nhóm rỗng + canSetInitialPrimary: hiện nút; gửi primaryUserId đúng một người', async () => {
    addCareTeamMembers.mockResolvedValue({ ok: true, data: undefined });
    render(<CareTeamCard customer={customerOf([], { canSetInitialPrimary: true, canManageCareTeam: true })} />);
    expect(screen.getByText('Chưa phân người chăm sóc.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Đặt người chăm sóc chính' }));
    expect(screen.getByText(/Chỉ đặt được một lần/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: /Lan/ }));
    // Chọn người khác thì thay người trước (chỉ một PRIMARY).
    fireEvent.click(screen.getByRole('radio', { name: /Tuấn/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Đặt làm người chăm sóc chính' }));
    await waitFor(() => expect(addCareTeamMembers).toHaveBeenCalledWith('c1', { userIds: ['u-new2'], primaryUserId: 'u-new2' }));
    expect(showToast).toHaveBeenCalledWith({ title: 'Đã đặt người chăm sóc chính' });
  });

  it('nhóm rỗng nhưng không có canSetInitialPrimary (vd Staff): không hiện nút', () => {
    render(<CareTeamCard customer={customerOf([], { canSetInitialPrimary: false })} />);
    expect(screen.queryByRole('button', { name: 'Đặt người chăm sóc chính' })).toBeNull();
  });

  it('đã có nhóm thì không cho đặt lại PRIMARY dù có cờ quyền', () => {
    render(<CareTeamCard customer={customerOf([member('p', 'PRIMARY')], { canSetInitialPrimary: true })} />);
    expect(screen.queryByRole('button', { name: 'Đặt người chăm sóc chính' })).toBeNull();
  });

  it('lỗi từ server (vd PRIMARY_LOCKED do đua tay) hiện trong khung, không đóng', async () => {
    addCareTeamMembers.mockResolvedValue({ ok: false, error: { statusCode: 409, errorCode: 'PRIMARY_LOCKED', message: 'raw' } });
    render(<CareTeamCard customer={customerOf([], { canSetInitialPrimary: true })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Đặt người chăm sóc chính' }));
    fireEvent.click(screen.getByRole('radio', { name: /Lan/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Đặt làm người chăm sóc chính' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('cố định');
  });
});
