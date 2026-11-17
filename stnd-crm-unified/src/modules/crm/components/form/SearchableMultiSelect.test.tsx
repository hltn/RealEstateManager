import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { clampListHeight } from '@crm/hooks/useVisibleListMaxHeight';
import { SearchableMultiSelect } from './SearchableMultiSelect';

const PROJECTS = [
  { value: 'qt', label: 'Q Terra' },
  { value: 'td', label: 'Thảo Điền Green' },
  { value: 'vh', label: 'Vinhomes Grand Park' },
  { value: 'hc', label: 'Hà Đô Centrosa' },
  { value: 'tl', label: 'The Landmark' },
];

const Harness = ({ initial = [], onToggle = vi.fn() }: { initial?: string[]; onToggle?: (value: string) => void }) => {
  const [selected, setSelected] = useState<string[]>(initial);
  return (
    <form>
      <SearchableMultiSelect
        id="projects"
        legend="Dự án quan tâm (chọn được nhiều)"
        listLabel="Danh sách dự án"
        options={PROJECTS}
        selected={selected}
        onToggle={(value) => {
          onToggle(value);
          setSelected((current) => (current.includes(value) ? current.filter((item) => item !== value) : [...current, value]));
        }}
      />
    </form>
  );
};

const optionLabels = () => screen.getAllByRole('option').map((option) => option.textContent);

type MutableElementProto = { scrollIntoView?: unknown };

afterEach(() => {
  Object.defineProperty(window, 'visualViewport', { configurable: true, value: undefined });
  delete (HTMLElement.prototype as MutableElementProto).scrollIntoView;
});

describe('SearchableMultiSelect (PT-019): Dự án quan tâm dạng selectbox đa chọn có tìm kiếm', () => {
  it('nhãn gắn với ô tìm kiếm; bấm vào ô thì mở danh sách đủ dự án và báo aria-multiselectable', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const input = screen.getByRole('combobox', { name: /Dự án quan tâm/ });
    expect(input).toHaveAttribute('aria-expanded', 'false');
    await user.click(input);
    expect(input).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('listbox', { name: 'Danh sách dự án' })).toHaveAttribute('aria-multiselectable', 'true');
    expect(optionLabels()).toEqual(PROJECTS.map((project) => project.label));
  });

  it('gõ lọc theo tên, ưu tiên KHÔNG DẤU: "thao dien" ra Thảo Điền; "ha do" ra Hà Đô', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const input = screen.getByRole('combobox');
    await user.type(input, 'thao dien');
    expect(optionLabels()).toEqual(['Thảo Điền Green']);
    await user.clear(input);
    await user.type(input, 'ha do');
    expect(optionLabels()).toEqual(['Hà Đô Centrosa']);
  });

  it('xếp mục bắt đầu bằng từ khoá lên trước, rồi mục có từ bắt đầu bằng từ khoá, cuối cùng mục chỉ chứa', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(screen.getByRole('combobox'), 't');
    // rank 0: "Thảo Điền Green", "The Landmark" (giữ thứ tự gốc); rank 1: "Q Terra"; rank 2: "Hà Đô Centrosa" (t giữa từ); không chứa t: Vinhomes.
    expect(optionLabels()).toEqual(['Thảo Điền Green', 'The Landmark', 'Q Terra', 'Hà Đô Centrosa']);
  });

  it('không có kết quả: hiện thông báo, không có option', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(screen.getByRole('combobox'), 'zzz');
    expect(screen.queryAllByRole('option')).toHaveLength(0);
    expect(screen.getByText('Không tìm thấy kết quả phù hợp.')).toBeInTheDocument();
  });

  it('chọn NHIỀU dự án: danh sách vẫn mở, từ khoá được xoá, hiện chip theo thứ tự chọn và đánh dấu aria-selected', async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    render(<Harness onToggle={onToggle} />);
    const input = screen.getByRole('combobox');
    await user.type(input, 'terra');
    await user.click(screen.getByRole('option', { name: 'Q Terra' }));
    expect(onToggle).toHaveBeenLastCalledWith('qt');
    expect(input).toHaveValue('');
    expect(input).toHaveAttribute('aria-expanded', 'true');
    await user.click(screen.getByRole('option', { name: /Vinhomes/ }));
    expect(onToggle).toHaveBeenLastCalledWith('vh');
    const chips = screen.getByRole('list', { name: 'Đã chọn' });
    expect(within(chips).getAllByRole('listitem').map((item) => item.textContent)).toEqual(['Q Terra', 'Vinhomes Grand Park']);
    expect(screen.getByRole('option', { name: 'Q Terra' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('option', { name: 'The Landmark' })).toHaveAttribute('aria-selected', 'false');
  });

  it('bấm lại mục đã chọn trong danh sách thì bỏ chọn; nút X trên chip cũng bỏ chọn', async () => {
    const user = userEvent.setup();
    render(<Harness initial={['qt', 'td']} />);
    await user.click(screen.getByRole('button', { name: 'Bỏ chọn Q Terra' }));
    expect(screen.queryByRole('button', { name: 'Bỏ chọn Q Terra' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Bỏ chọn Thảo Điền Green' })).toBeInTheDocument();
    await user.click(screen.getByRole('combobox'));
    await user.click(screen.getByRole('option', { name: 'Thảo Điền Green' }));
    expect(screen.queryByRole('list', { name: 'Đã chọn' })).toBeNull();
  });

  it('bàn phím: ArrowDown + Enter chọn mục đang tô sáng và KHÔNG gửi form; Esc đóng danh sách', async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    const onSubmit = vi.fn((event: Event) => event.preventDefault());
    render(<Harness onToggle={onToggle} />);
    document.querySelector('form')?.addEventListener('submit', onSubmit);
    const input = screen.getByRole('combobox');
    await user.click(input);
    await user.keyboard('{ArrowDown}{Enter}');
    expect(onToggle).toHaveBeenCalledWith('td');
    expect(onSubmit).not.toHaveBeenCalled();
    await user.keyboard('{Escape}');
    expect(input).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('bàn phím: ArrowDown/ArrowUp cuộn dòng đang tô sáng vào vùng nhìn thấy; rê chuột thì KHÔNG cuộn', async () => {
    const scrollIntoView = vi.fn();
    (HTMLElement.prototype as MutableElementProto).scrollIntoView = scrollIntoView;
    const user = userEvent.setup();
    render(<Harness />);
    const input = screen.getByRole('combobox');
    await user.click(input);
    expect(scrollIntoView).not.toHaveBeenCalled();
    await user.keyboard('{ArrowDown}{ArrowDown}');
    expect(input).toHaveAttribute('aria-activedescendant', 'projects-option-2');
    expect(scrollIntoView).toHaveBeenLastCalledWith({ block: 'nearest' });
    scrollIntoView.mockClear();
    await user.hover(screen.getByRole('option', { name: 'The Landmark' }));
    expect(input).toHaveAttribute('aria-activedescendant', 'projects-option-4');
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it('không có kết quả lọc: ArrowDown/Enter không chọn gì, không lỗi; xoá từ khoá thì dòng đầu được tô sáng lại', async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    render(<Harness onToggle={onToggle} />);
    const input = screen.getByRole('combobox');
    await user.type(input, 'zzz');
    expect(screen.getByText('Không tìm thấy kết quả phù hợp.')).toBeInTheDocument();
    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}');
    expect(onToggle).not.toHaveBeenCalled();
    expect(input).not.toHaveAttribute('aria-activedescendant');
    await user.clear(input);
    expect(input).toHaveAttribute('aria-activedescendant', 'projects-option-0');
  });

  it('bấm ra ngoài thì đóng danh sách và xoá từ khoá', async () => {
    const user = userEvent.setup();
    render(
      <>
        <Harness />
        <button type="button">Ngoài</button>
      </>,
    );
    const input = screen.getByRole('combobox');
    await user.type(input, 'terra');
    await user.click(screen.getByRole('button', { name: 'Ngoài' }));
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(input).toHaveValue('');
  });

  it('ô tìm kiếm dùng chữ 16px trên điện thoại (text-base) để iOS Safari không tự phóng to khi focus', () => {
    render(<Harness />);
    const input = screen.getByRole('combobox');
    expect(input).toHaveClass('text-base', 'md:text-sm');
    expect(input).not.toHaveClass('text-sm');
  });

  it('dự án đã chọn nhưng không còn trong danh sách (đã ẩn) thì không vẽ chip lỗi', () => {
    render(<Harness initial={['ghost']} />);
    expect(screen.queryByRole('list', { name: 'Đã chọn' })).toBeNull();
  });
});

describe('SearchableMultiSelect: bàn phím ảo iOS không che danh sách (visualViewport)', () => {
  const mockViewport = (height: number, anchorBottom: number) => {
    Object.defineProperty(window, 'visualViewport', {
      configurable: true,
      value: { height, offsetTop: 0, addEventListener: vi.fn(), removeEventListener: vi.fn() },
    });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ bottom: anchorBottom, top: anchorBottom - 44, left: 0, right: 0, width: 0, height: 44, x: 0, y: 0, toJSON: () => ({}) });
  };

  afterEach(() => vi.restoreAllMocks());

  it('không rò listener: đăng ký resize/scroll khi mở và gỡ ĐÚNG các hàm đó khi đóng hoặc gỡ component', async () => {
    mockViewport(340, 120);
    const viewport = window.visualViewport as unknown as { addEventListener: ReturnType<typeof vi.fn>; removeEventListener: ReturnType<typeof vi.fn> };
    const user = userEvent.setup();
    const { unmount } = render(<Harness />);
    expect(viewport.addEventListener).not.toHaveBeenCalled();
    await user.click(screen.getByRole('combobox'));
    expect(viewport.addEventListener.mock.calls.map((call) => call[0]).sort()).toEqual(['resize', 'scroll']);
    await user.keyboard('{Escape}');
    expect(viewport.removeEventListener.mock.calls.map((call) => call[0]).sort()).toEqual(['resize', 'scroll']);
    for (const [type, handler] of viewport.addEventListener.mock.calls) {
      expect(viewport.removeEventListener).toHaveBeenCalledWith(type, handler);
    }
    // Mở lại rồi gỡ component khi đang mở: cũng phải gỡ hết.
    await user.click(screen.getByRole('combobox'));
    expect(viewport.addEventListener).toHaveBeenCalledTimes(4);
    unmount();
    expect(viewport.removeEventListener).toHaveBeenCalledTimes(4);
  });

  it('clampListHeight: kẹp trong [144, 256]', () => {
    expect(clampListHeight(50)).toBe(144);
    expect(clampListHeight(200.4)).toBe(200);
    expect(clampListHeight(900)).toBe(256);
  });

  it('còn chỗ trống phía trên bàn phím: giới hạn chiều cao danh sách đúng chỗ trống, KHÔNG cuộn trang', async () => {
    // Vùng nhìn thấy cao 340px (đã trừ bàn phím), đáy ô nhập ở 120px -> chỗ trống 340-120-8 = 212px.
    mockViewport(340, 120);
    const scrollIntoView = vi.fn();
    (HTMLElement.prototype as MutableElementProto).scrollIntoView = scrollIntoView;
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('combobox'));
    expect(screen.getByRole('listbox')).toHaveStyle({ maxHeight: '212px' });
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it('chỗ trống quá thấp (ô nhập nằm sát/dưới bàn phím): cuộn khối lên đầu vùng nhìn thấy và vẫn giữ danh sách tối thiểu 144px', async () => {
    mockViewport(340, 300);
    const scrollIntoView = vi.fn();
    (HTMLElement.prototype as MutableElementProto).scrollIntoView = scrollIntoView;
    const user = userEvent.setup();
    render(<Harness />);
    fireEvent.focus(screen.getByRole('combobox'));
    await user.click(screen.getByRole('combobox'));
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'start', behavior: 'smooth' });
    expect(screen.getByRole('listbox')).toHaveStyle({ maxHeight: '144px' });
  });
});
