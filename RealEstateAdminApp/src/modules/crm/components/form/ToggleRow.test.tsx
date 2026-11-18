import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ToggleRow } from './ToggleRow';

describe('ToggleRow: nhãn bên trái, công tắc gạt bên phải', () => {
  it('công tắc có role="switch", tên theo tiêu đề và aria-checked theo trạng thái', () => {
    const { rerender } = render(<ToggleRow title="Tạo lịch hẹn" isChecked={false} onChange={vi.fn()} />);
    expect(screen.getByRole('switch', { name: 'Tạo lịch hẹn' })).toHaveAttribute('aria-checked', 'false');
    rerender(<ToggleRow title="Tạo lịch hẹn" isChecked onChange={vi.fn()} />);
    expect(screen.getByRole('switch', { name: 'Tạo lịch hẹn' })).toHaveAttribute('aria-checked', 'true');
  });

  it('bấm công tắc báo giá trị đảo ngược; công tắc là phần tử cuối (bên phải) của hàng, nhãn + mô tả ở khối đầu', async () => {
    const onChange = vi.fn();
    render(<ToggleRow title="Tạo lịch hẹn" description="Mô tả ngắn" isChecked={false} onChange={onChange} className="mt-2" />);
    const toggle = screen.getByRole('switch');
    const row = toggle.parentElement as HTMLElement;
    expect(row).toHaveClass('justify-between', 'mt-2');
    expect(row.lastElementChild).toBe(toggle);
    expect(row.firstElementChild).toHaveTextContent('Tạo lịch hẹn');
    expect(row.firstElementChild).toHaveTextContent('Mô tả ngắn');
    await userEvent.click(toggle);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('a11y: công tắc trỏ aria-describedby tới đoạn mô tả (id riêng cho từng hàng); không có mô tả thì không có aria-describedby', () => {
    const { rerender } = render(
      <>
        <ToggleRow title="Tuỳ chọn A" description="Mô tả của A" isChecked={false} onChange={vi.fn()} />
        <ToggleRow title="Tuỳ chọn B" description="Mô tả của B" isChecked={false} onChange={vi.fn()} />
      </>,
    );
    const describedByA = screen.getByRole('switch', { name: 'Tuỳ chọn A' }).getAttribute('aria-describedby') as string;
    const describedByB = screen.getByRole('switch', { name: 'Tuỳ chọn B' }).getAttribute('aria-describedby') as string;
    expect(describedByA).toBeTruthy();
    expect(describedByA).not.toBe(describedByB);
    expect(document.getElementById(describedByA)).toHaveTextContent('Mô tả của A');
    expect(screen.getByRole('switch', { name: 'Tuỳ chọn A' })).toHaveAccessibleDescription('Mô tả của A');
    rerender(<ToggleRow title="Không mô tả" isChecked={false} onChange={vi.fn()} />);
    expect(screen.getByRole('switch', { name: 'Không mô tả' })).not.toHaveAttribute('aria-describedby');
  });

  it('không có mô tả thì không vẽ dòng mô tả rỗng', () => {
    render(<ToggleRow title="Chỉ tiêu đề" isChecked={false} onChange={vi.fn()} />);
    expect(screen.getByText('Chỉ tiêu đề').parentElement?.children).toHaveLength(1);
  });
});
