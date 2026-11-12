import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CareTeamInvitee } from '@crm/api';
import { CareTeamInvitePicker } from './CareTeamInvitePicker';

const useCareTeamInvitees = vi.fn();
vi.mock('@crm/api', async () => {
  const actual = await vi.importActual<typeof import('@crm/api')>('@crm/api');
  return { ...actual, useCareTeamInvitees: (...args: unknown[]) => useCareTeamInvitees(...args) };
});

const invitee = (id: string, displayName: string, teamNames: string[] = []): CareTeamInvitee => ({ id, displayName, teamNames });
const result = (items: CareTeamInvitee[], totalPages = 1, overrides: Record<string, unknown> = {}) => ({
  data: { data: items, meta: { total: items.length, page: 1, limit: 20, totalPages } },
  isLoading: false,
  isFetching: false,
  isError: false,
  error: null,
  refetch: vi.fn(),
  ...overrides,
});

const hanh = invitee('u1', 'Hạnh', ['Nhóm A', 'Nhóm B']);
const minh = invitee('u2', 'Minh');

beforeEach(() => {
  vi.useFakeTimers();
  useCareTeamInvitees.mockReset();
  useCareTeamInvitees.mockReturnValue(result([hanh, minh]));
});
afterEach(() => vi.useRealTimers());

describe('CareTeamInvitePicker', () => {
  it('hiện "tên · nhóm" (nhiều nhóm nối bằng dấu phẩy), người không nhóm chỉ có tên', () => {
    render(<CareTeamInvitePicker customerId="c1" selected={[]} onChange={vi.fn()} maxSelectable={10} />);
    expect(screen.getByText('Hạnh · Nhóm A, Nhóm B')).toBeInTheDocument();
    expect(screen.getByText('Minh')).toBeInTheDocument();
  });

  it('gọi hook với customerId, từ khoá rỗng, trang 1; không có email/SĐT trên giao diện', () => {
    const { container } = render(<CareTeamInvitePicker customerId="c1" selected={[]} onChange={vi.fn()} maxSelectable={10} />);
    expect(useCareTeamInvitees).toHaveBeenLastCalledWith('c1', '', 1);
    expect(container.textContent).not.toMatch(/@|\d{9,}/);
  });

  it('tìm kiếm có debounce: chưa đủ thời gian thì chưa đổi truy vấn, sau 300ms mới gọi với từ khoá đã cắt khoảng trắng', () => {
    render(<CareTeamInvitePicker customerId="c1" selected={[]} onChange={vi.fn()} maxSelectable={10} />);
    fireEvent.change(screen.getByLabelText('Tìm người để mời'), { target: { value: '  Hạ ' } });
    act(() => void vi.advanceTimersByTime(200));
    expect(useCareTeamInvitees).not.toHaveBeenCalledWith('c1', 'Hạ', expect.anything());
    act(() => void vi.advanceTimersByTime(150));
    expect(useCareTeamInvitees).toHaveBeenLastCalledWith('c1', 'Hạ', 1);
  });

  it('ô tìm giới hạn 50 ký tự (khớp endpoint)', () => {
    render(<CareTeamInvitePicker selected={[]} onChange={vi.fn()} maxSelectable={10} />);
    expect(screen.getByLabelText('Tìm người để mời')).toHaveAttribute('maxlength', '50');
  });

  it('phân trang: hiện Trang x/y, Sau/Trước đổi trang gọi hook với page mới; trang 1 khoá nút Trước', () => {
    useCareTeamInvitees.mockReturnValue(result([hanh], 3));
    render(<CareTeamInvitePicker customerId="c1" selected={[]} onChange={vi.fn()} maxSelectable={10} />);
    expect(screen.getByText('Trang 1/3')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Trang trước' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Trang sau' }));
    expect(useCareTeamInvitees).toHaveBeenLastCalledWith('c1', '', 2);
    fireEvent.click(screen.getByRole('button', { name: 'Trang trước' }));
    expect(useCareTeamInvitees).toHaveBeenLastCalledWith('c1', '', 1);
  });

  it('chỉ 1 trang thì không hiện điều khiển phân trang', () => {
    render(<CareTeamInvitePicker customerId="c1" selected={[]} onChange={vi.fn()} maxSelectable={10} />);
    expect(screen.queryByRole('button', { name: 'Trang sau' })).toBeNull();
  });

  it('đổi từ khoá thì về trang 1', () => {
    useCareTeamInvitees.mockReturnValue(result([hanh], 3));
    render(<CareTeamInvitePicker customerId="c1" selected={[]} onChange={vi.fn()} maxSelectable={10} />);
    fireEvent.click(screen.getByRole('button', { name: 'Trang sau' }));
    expect(useCareTeamInvitees).toHaveBeenLastCalledWith('c1', '', 2);
    fireEvent.change(screen.getByLabelText('Tìm người để mời'), { target: { value: 'Mi' } });
    act(() => void vi.advanceTimersByTime(400));
    expect(useCareTeamInvitees).toHaveBeenLastCalledWith('c1', 'Mi', 1);
  });

  it('đổi từ khoá rồi quay lại từ khoá cũ: về trang 1, không giữ trang cũ', () => {
    useCareTeamInvitees.mockReturnValue(result([hanh], 3));
    render(<CareTeamInvitePicker customerId="c1" selected={[]} onChange={vi.fn()} maxSelectable={10} />);
    const input = screen.getByLabelText('Tìm người để mời');
    fireEvent.change(input, { target: { value: 'Mi' } });
    act(() => void vi.advanceTimersByTime(400));
    fireEvent.click(screen.getByRole('button', { name: 'Trang sau' }));
    fireEvent.click(screen.getByRole('button', { name: 'Trang sau' }));
    expect(useCareTeamInvitees).toHaveBeenLastCalledWith('c1', 'Mi', 3);
    fireEvent.change(input, { target: { value: 'Ha' } });
    act(() => void vi.advanceTimersByTime(400));
    expect(useCareTeamInvitees).toHaveBeenLastCalledWith('c1', 'Ha', 1);
    fireEvent.change(input, { target: { value: 'Mi' } });
    act(() => void vi.advanceTimersByTime(400));
    expect(useCareTeamInvitees).toHaveBeenLastCalledWith('c1', 'Mi', 1);
    expect(screen.getByText('Trang 1/3')).toBeInTheDocument();
  });

  it('chọn nhiều: tích thêm người, bỏ tích người đã chọn', () => {
    const onChange = vi.fn();
    const { rerender } = render(<CareTeamInvitePicker customerId="c1" selected={[]} onChange={onChange} maxSelectable={10} />);
    fireEvent.click(screen.getByRole('checkbox', { name: /Minh/ }));
    expect(onChange).toHaveBeenLastCalledWith([minh]);
    rerender(<CareTeamInvitePicker customerId="c1" selected={[hanh]} onChange={onChange} maxSelectable={10} />);
    fireEvent.click(screen.getByRole('checkbox', { name: /Hạnh/ }));
    expect(onChange).toHaveBeenLastCalledWith([]);
  });

  it('đủ maxSelectable thì ô chưa chọn bị khoá và có thông báo; ô đã chọn vẫn bỏ chọn được', () => {
    const onChange = vi.fn();
    render(<CareTeamInvitePicker customerId="c1" selected={[hanh, invitee('u3', 'Lan')]} onChange={onChange} maxSelectable={2} />);
    expect(screen.getByText('Đã chọn tối đa 2 người.')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /Minh/ })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: /Hạnh/ })).toBeEnabled();
    fireEvent.click(screen.getByRole('checkbox', { name: /Hạnh/ }));
    expect(onChange).toHaveBeenLastCalledWith([invitee('u3', 'Lan')]);
  });

  it('chưa đủ maxSelectable thì chọn thêm được và giữ người đã chọn (kể cả khác trang)', () => {
    const onChange = vi.fn();
    render(<CareTeamInvitePicker customerId="c1" selected={[invitee('u9', 'Tuấn')]} onChange={onChange} maxSelectable={2} />);
    fireEvent.click(screen.getByRole('checkbox', { name: /Minh/ }));
    expect(onChange).toHaveBeenLastCalledWith([invitee('u9', 'Tuấn'), minh]);
  });

  it('maxSelectable = 1: dùng radio trong một nhóm; chọn người khác thay người đã chọn', () => {
    const onChange = vi.fn();
    render(<CareTeamInvitePicker customerId="c1" selected={[hanh]} onChange={onChange} maxSelectable={1} />);
    expect(screen.getByRole('radiogroup')).toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.getByRole('radio', { name: /Hạnh/ })).toBeChecked();
    const names = new Set(screen.getAllByRole('radio').map((radio) => radio.getAttribute('name')));
    expect(names.size).toBe(1);
    fireEvent.click(screen.getByRole('radio', { name: /Minh/ }));
    expect(onChange).toHaveBeenLastCalledWith([minh]);
  });

  it('chọn nhiều (maxSelectable > 1): checkbox, không phải radio', () => {
    render(<CareTeamInvitePicker customerId="c1" selected={[]} onChange={vi.fn()} maxSelectable={3} />);
    expect(screen.queryByRole('radiogroup')).toBeNull();
    expect(screen.queryByRole('radio')).toBeNull();
    expect(screen.getAllByRole('checkbox')).toHaveLength(2);
  });

  it('shouldAutoFocus: focus vào ô tìm khi mở; mặc định không giành focus', () => {
    const { unmount } = render(<CareTeamInvitePicker customerId="c1" selected={[]} onChange={vi.fn()} maxSelectable={10} shouldAutoFocus />);
    expect(screen.getByLabelText('Tìm người để mời')).toHaveFocus();
    unmount();
    render(<CareTeamInvitePicker customerId="c1" selected={[]} onChange={vi.fn()} maxSelectable={10} />);
    expect(screen.getByLabelText('Tìm người để mời')).not.toHaveFocus();
  });

  it('pinnedOption: hiện trên cùng, vẫn hiện khi danh sách rỗng, chọn được và giữ id gốc', () => {
    useCareTeamInvitees.mockReturnValue(result([]));
    const onChange = vi.fn();
    const self = invitee('me', 'Chính tôi');
    render(<CareTeamInvitePicker customerId="c1" selected={[]} onChange={onChange} maxSelectable={1} pinnedOption={self} />);
    expect(screen.getAllByRole('radio')[0]).toHaveAccessibleName('Chính tôi');
    fireEvent.click(screen.getByRole('radio', { name: 'Chính tôi' }));
    expect(onChange).toHaveBeenLastCalledWith([self]);
  });

  it('chip đã chọn có nút bỏ chọn', () => {
    const onChange = vi.fn();
    render(<CareTeamInvitePicker customerId="c1" selected={[invitee('u9', 'Tuấn')]} onChange={onChange} maxSelectable={10} />);
    fireEvent.click(screen.getByRole('button', { name: 'Bỏ chọn Tuấn' }));
    expect(onChange).toHaveBeenLastCalledWith([]);
  });

  it('trạng thái tải / lỗi (có Thử lại) / rỗng', () => {
    useCareTeamInvitees.mockReturnValue(result([], 1, { isLoading: true }));
    const { rerender } = render(<CareTeamInvitePicker customerId="c1" selected={[]} onChange={vi.fn()} maxSelectable={10} />);
    expect(screen.getByRole('status')).toHaveTextContent('Đang tải');

    const refetch = vi.fn();
    useCareTeamInvitees.mockReturnValue(result([], 1, { isError: true, refetch }));
    rerender(<CareTeamInvitePicker customerId="c1" selected={[]} onChange={vi.fn()} maxSelectable={10} />);
    fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
    expect(refetch).toHaveBeenCalledTimes(1);

    useCareTeamInvitees.mockReturnValue(result([]));
    rerender(<CareTeamInvitePicker customerId="c1" selected={[]} onChange={vi.fn()} maxSelectable={10} />);
    expect(screen.getByText('Không còn người nào để mời.')).toBeInTheDocument();
  });

  it('isDisabled khoá ô tìm và các ô chọn', () => {
    render(<CareTeamInvitePicker customerId="c1" selected={[]} onChange={vi.fn()} maxSelectable={10} isDisabled />);
    expect(screen.getByLabelText('Tìm người để mời')).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: /Minh/ })).toBeDisabled();
  });
});
