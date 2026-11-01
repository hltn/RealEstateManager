import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { getAreaSearchTerms } from '@crm/lib/areaMatch';
import { SearchableSelect } from './SearchableSelect';

const OPTIONS = [
  { value: 'hn', label: 'Hà Nội' },
  { value: 'hue', label: 'Huế' },
  { value: 'hp', label: 'Hải Phòng' },
  { value: 'dn', label: 'Đà Nẵng' },
  { value: 'ht', label: 'Hà Tĩnh' },
  { value: 'th', label: 'Thanh Hóa' },
  { value: 'hcm', label: 'TP. Hồ Chí Minh' },
];

const Harness = ({ initial = '', onChange = vi.fn(), withAliases = false }: { initial?: string; onChange?: (value: string) => void; withAliases?: boolean }) => {
  const [value, setValue] = useState(initial);
  return (
    <>
      <label htmlFor="area">Khu vực</label>
      <SearchableSelect
        id="area"
        options={OPTIONS}
        value={value}
        emptyLabel="Chọn khu vực"
        listLabel="Danh sách khu vực"
        getSearchTerms={withAliases ? getAreaSearchTerms : undefined}
        onChange={(next) => {
          setValue(next);
          onChange(next);
        }}
      />
    </>
  );
};

const optionLabels = () => screen.getAllByRole('option').map((option) => option.textContent);

describe('SearchableSelect (ô chọn khu vực có tìm kiếm)', () => {
  it('gõ không dấu / không phân biệt hoa thường vẫn lọc đúng: "ha noi" -> Hà Nội; "da nang" -> Đà Nẵng', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const input = screen.getByRole('combobox', { name: 'Khu vực' });
    await user.type(input, 'HA noi');
    expect(optionLabels()).toEqual(['Hà Nội']);
    await user.clear(input);
    await user.type(input, 'da nang');
    expect(optionLabels()).toEqual(['Đà Nẵng']);
  });

  it('không có kết quả: báo "Không tìm thấy", không có option nào', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(screen.getByRole('combobox'), 'xyz');
    expect(screen.queryAllByRole('option')).toHaveLength(0);
    expect(screen.getByText('Không tìm thấy kết quả phù hợp.')).toBeVisible();
  });

  it('bàn phím: mũi tên chọn dòng, Enter xác nhận, ô hiện nhãn đã chọn và danh sách đóng', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const input = screen.getByRole('combobox');
    await user.click(input);
    // Dòng đầu là "Chọn khu vực" (bỏ chọn); mũi tên xuống 2 lần -> Huế.
    await user.keyboard('{ArrowDown}{ArrowDown}');
    expect(input).toHaveAttribute('aria-activedescendant', 'area-option-2');
    await user.keyboard('{Enter}');
    expect(onChange).toHaveBeenCalledWith('hue');
    expect(input).toHaveValue('Huế');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('Escape đóng danh sách và giữ nguyên lựa chọn cũ, bỏ từ khoá đang gõ', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness initial="hn" onChange={onChange} />);
    const input = screen.getByRole('combobox');
    await user.click(input);
    await user.type(input, 'hue');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(input).toHaveValue('Hà Nội');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('chọn dòng "Chọn khu vực" thì bỏ chọn (giá trị rỗng)', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness initial="hn" onChange={onChange} />);
    await user.click(screen.getByRole('combobox'));
    await user.click(screen.getByRole('option', { name: 'Chọn khu vực' }));
    expect(onChange).toHaveBeenCalledWith('');
    expect(screen.getByRole('combobox')).toHaveValue('');
  });

  it('chọn bằng chuột sau khi lọc', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    await user.type(screen.getByRole('combobox'), 'hai');
    await user.click(screen.getByRole('option', { name: 'Hải Phòng' }));
    expect(onChange).toHaveBeenCalledWith('hp');
  });

  it('Enter khi đang mở danh sách không làm gửi form', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn((event: { preventDefault: () => void }) => event.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <Harness />
      </form>,
    );
    await user.click(screen.getByRole('combobox'));
    await user.keyboard('{Enter}');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('mục bắt đầu bằng từ khoá xếp trước, mục chỉ chứa từ khoá xếp sau: "ha" -> Hà Nội, Hà Tĩnh trước Thanh Hóa', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(screen.getByRole('combobox'), 'ha');
    // Hà Nội, Hà Tĩnh bắt đầu bằng "ha"; Hải Phòng cũng bắt đầu bằng "ha" (hai); Thanh Hóa chỉ chứa "ha" ở giữa từ -> cuối.
    expect(optionLabels()).toEqual(['Hà Nội', 'Hải Phòng', 'Hà Tĩnh', 'Thanh Hóa']);
  });

  it('bí danh: "hcm" và "sai gon" ra TP. Hồ Chí Minh khi truyền getSearchTerms', async () => {
    const user = userEvent.setup();
    render(<Harness withAliases />);
    const input = screen.getByRole('combobox');
    await user.type(input, 'hcm');
    expect(optionLabels()).toEqual(['TP. Hồ Chí Minh']);
    await user.clear(input);
    await user.type(input, 'sai g');
    expect(optionLabels()).toEqual(['TP. Hồ Chí Minh']);
  });

  it('danh sách có tên truy cập và không nhận focus Tab (Tab đi tiếp, danh sách đóng)', async () => {
    const user = userEvent.setup();
    render(
      <>
        <Harness />
        <button type="button">Tiếp theo</button>
      </>,
    );
    await user.click(screen.getByRole('combobox'));
    const listbox = screen.getByRole('listbox', { name: 'Danh sách khu vực' });
    expect(listbox).toHaveAttribute('tabindex', '-1');
    await user.tab();
    expect(screen.getByRole('button', { name: 'Tiếp theo' })).toHaveFocus();
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('nhấn chuột vào vùng trống/thanh cuộn của danh sách không làm ô mất focus (không bị đóng)', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('combobox'));
    const listbox = screen.getByRole('listbox');
    // fireEvent trả false khi sự kiện bị preventDefault -> trình duyệt không chuyển focus khỏi ô nhập.
    expect(fireEvent.mouseDown(listbox)).toBe(false);
    expect(screen.getByRole('combobox')).toHaveFocus();
    expect(screen.getByRole('listbox')).toBeVisible();
  });

  it('chọn xong gõ tiếp thì THAY nhãn cũ chứ không nối vào đuôi ("Hà Nội" + "h" không thành "Hà Nộih")', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const input = screen.getByRole('combobox');
    await user.type(input, 'ha noi');
    await user.click(screen.getByRole('option', { name: 'Hà Nội' }));
    expect(input).toHaveValue('Hà Nội');
    await user.keyboard('d');
    expect(input).toHaveValue('d');
    expect(optionLabels()).toEqual(['Đà Nẵng']);
  });
});
