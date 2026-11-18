import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ReminderSelectField, ScheduleDateTimeFields } from './ScheduleDateTimeFields';

describe('ScheduleDateTimeFields: Ngày diễn ra + Giờ dùng chung form Tạo lịch hẹn và Nhật ký', () => {
  const renderFields = (overrides: Partial<Parameters<typeof ScheduleDateTimeFields>[0]> = {}) => {
    const onDateChange = vi.fn();
    const onTimeChange = vi.fn();
    render(<ScheduleDateTimeFields dateId="d1" timeId="t1" date="2026-10-26" time="09:00" onDateChange={onDateChange} onTimeChange={onTimeChange} {...overrides} />);
    return { onDateChange, onTimeChange };
  };

  it('nhãn gắn đúng ô theo id truyền vào; hiện thứ-ngày dài dưới ô ngày', () => {
    renderFields();
    expect(screen.getByLabelText(/Ngày diễn ra/)).toHaveAttribute('id', 'd1');
    expect(screen.getByLabelText(/Ngày diễn ra/)).toHaveValue('2026-10-26');
    expect(screen.getByLabelText(/Giờ \(giờ Việt Nam\)/)).toHaveAttribute('id', 't1');
    expect(screen.getByLabelText(/Giờ \(giờ Việt Nam\)/)).toHaveValue('09:00');
    expect(screen.getByText('Thứ Hai, 26 tháng 10, 2026')).toBeVisible();
  });

  it('đổi giờ gọi onTimeChange; chọn ngày trên lịch gọi onDateChange với khoá YYYY-MM-DD', () => {
    const { onDateChange, onTimeChange } = renderFields();
    fireEvent.change(screen.getByLabelText(/Giờ \(giờ Việt Nam\)/), { target: { value: '14:45' } });
    expect(onTimeChange).toHaveBeenCalledWith('14:45');
    const dateInput = screen.getByLabelText(/Ngày diễn ra/) as HTMLInputElement & { _flatpickr: { setDate: (value: string, shouldTrigger: boolean) => void } };
    act(() => dateInput._flatpickr.setDate('2026-11-02', true));
    expect(onDateChange).toHaveBeenCalledWith('2026-11-02');
  });

  it('lỗi hiện cạnh đúng ô và gắn aria-invalid cho ô giờ', () => {
    renderFields({ dateError: 'Ngày sai', timeError: 'Giờ sai' });
    expect(screen.getByText('Ngày sai')).toBeVisible();
    expect(screen.getByText('Giờ sai')).toBeVisible();
    expect(screen.getByLabelText(/Giờ \(giờ Việt Nam\)/)).toHaveAttribute('aria-invalid', 'true');
  });
});

describe('ReminderSelectField: Nhắc trước', () => {
  it('liệt kê các mốc nhắc, chọn đúng giá trị hiện tại và báo số phút khi đổi', async () => {
    const onChange = vi.fn();
    render(<ReminderSelectField id="r1" value={60} onChange={onChange} />);
    const select = screen.getByRole('combobox', { name: 'Nhắc trước' });
    expect(select).toHaveAttribute('id', 'r1');
    expect(select).toHaveValue('60');
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual(['Trước 15 phút', 'Trước 30 phút', 'Trước 1 tiếng', 'Trước 2 tiếng', 'Trước 1 ngày']);
    await userEvent.selectOptions(select, '1440');
    expect(onChange).toHaveBeenCalledWith(1440);
  });
});
