import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ copyTextToClipboard: vi.fn(), success: vi.fn(), error: vi.fn() }));
vi.mock('@crm/lib/clipboard', () => ({ copyTextToClipboard: mocks.copyTextToClipboard }));
vi.mock('react-hot-toast', () => ({ default: { success: mocks.success, error: mocks.error } }));

import { CustomerCodeCopyButton } from './CustomerCodeCopyButton';

const flush = () => act(async () => {});

describe('CustomerCodeCopyButton', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.copyTextToClipboard.mockReset().mockResolvedValue(true);
    mocks.success.mockClear();
    mocks.error.mockClear();
  });
  afterEach(() => vi.useRealTimers());

  it('là <button type="button"> có aria-label tên mã, không có chữ hướng dẫn, chip cao 32px và vùng bấm nới ~40px cho ngón tay', () => {
    render(<CustomerCodeCopyButton code="KH-000053" />);
    const button = screen.getByRole('button', { name: 'Sao chép mã khách KH-000053' });
    expect(button).toHaveAttribute('type', 'button');
    expect(button).toHaveClass('min-h-8');
    // Vùng bấm nới ~40px bằng pseudo-element con của nút (jsdom không tính layout nên kiểm class).
    expect(button).toHaveClass('relative', 'before:absolute', 'before:-inset-y-1.25', 'before:inset-x-0');
    expect(button.textContent).toBe('KH-000053');
    expect(button.querySelector('svg.lucide-copy')).not.toBeNull();
    expect(button.querySelector('svg.lucide-check')).toBeNull();
  });

  it('bấm: clipboard nhận ĐÚNG mã (không kèm "Mã khách"), icon thành Check xanh 1.5s rồi trở lại Copy, có toast thành công', async () => {
    render(<CustomerCodeCopyButton code="KH-000053" />);
    const button = screen.getByRole('button');
    fireEvent.click(button);
    await flush();
    expect(mocks.copyTextToClipboard).toHaveBeenCalledExactlyOnceWith('KH-000053');
    expect(mocks.success).toHaveBeenCalledWith('Đã sao chép KH-000053', expect.objectContaining({ duration: 1500 }));
    expect(button.querySelector('svg.lucide-check')).toHaveClass('text-success-600');
    expect(button.querySelector('svg.lucide-copy')).toBeNull();
    act(() => void vi.advanceTimersByTime(1500));
    expect(button.querySelector('svg.lucide-copy')).not.toBeNull();
    expect(button.querySelector('svg.lucide-check')).toBeNull();
  });

  it('chép lỗi: toast lỗi, icon GIỮ Copy (không báo thành công giả), không crash', async () => {
    mocks.copyTextToClipboard.mockResolvedValue(false);
    render(<CustomerCodeCopyButton code="KH-000053" />);
    fireEvent.click(screen.getByRole('button'));
    await flush();
    expect(mocks.error).toHaveBeenCalledTimes(1);
    expect(mocks.success).not.toHaveBeenCalled();
    expect(screen.getByRole('button').querySelector('svg.lucide-check')).toBeNull();
  });

  it('bấm KHÔNG nổi bọt lên cha và đã preventDefault (không mở chi tiết thẻ, không theo liên kết)', async () => {
    const onParentClick = vi.fn();
    render(
      <div onClick={onParentClick}>
        <CustomerCodeCopyButton code="KH-000053" />
      </div>,
    );
    const isNotPrevented = fireEvent.click(screen.getByRole('button'));
    await flush();
    expect(onParentClick).not.toHaveBeenCalled();
    expect(isNotPrevented).toBe(false);
  });

  it('isCompact: chip gọn min-h-6 (cho hàng bảng), không dùng min-h-8', () => {
    render(<CustomerCodeCopyButton code="KH-000053" isCompact />);
    const button = screen.getByRole('button');
    expect(button).toHaveClass('min-h-6');
    expect(button).not.toHaveClass('min-h-8');
    // Chip gọn giữ nguyên, không nới vùng bấm (tránh chạm lấn sang ô/hàng bên cạnh).
    expect(button).not.toHaveClass('before:absolute');
  });

  it('className tùy chỉnh THAY kiểu chip mặc định (không chồng hai kiểu) nhưng vẫn có phản hồi hover/active', () => {
    render(<CustomerCodeCopyButton code="KH-000053" className="rounded-full bg-gray-100 text-xs" />);
    const button = screen.getByRole('button');
    expect(button).toHaveClass('bg-gray-100', 'text-xs', 'hover:ring-1');
    expect(button).not.toHaveClass('min-h-8', 'border', 'bg-gray-50', 'before:absolute');
  });

  it('mã dài hơn 6 số được chép nguyên vẹn', async () => {
    render(<CustomerCodeCopyButton code="KH-1000000" />);
    fireEvent.click(screen.getByRole('button', { name: 'Sao chép mã khách KH-1000000' }));
    await flush();
    expect(mocks.copyTextToClipboard).toHaveBeenCalledWith('KH-1000000');
  });
});
