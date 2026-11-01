import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const toastApi = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('react-hot-toast', () => ({ default: toastApi }));

import RedirectWithNotice, { NO_PERMISSION_MESSAGE, clearQueuedRedirectNotice, peekQueuedRedirectNotice, queueRedirectNotice } from './RedirectWithNotice';

const renderRedirect = () =>
  render(
    <MemoryRouter>
      <RedirectWithNotice to="/crm/today" />
    </MemoryRouter>,
  );

beforeEach(() => {
  toastApi.success.mockReset();
  toastApi.error.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  clearQueuedRedirectNotice();
});

describe('RedirectWithNotice', () => {
  it('thông báo xếp hàng hết hạn sau đúng 10 giây (9,999 giây còn, 10,001 giây hết)', () => {
    vi.useFakeTimers();
    queueRedirectNotice('Đã lưu. Bạn không còn là Quản trị.');
    vi.advanceTimersByTime(9_999);
    expect(peekQueuedRedirectNotice()).toBe('Đã lưu. Bạn không còn là Quản trị.');
    vi.advanceTimersByTime(2);
    expect(peekQueuedRedirectNotice()).toBeNull();
  });

  it('mặc định báo lỗi "không có quyền"', () => {
    renderRedirect();
    expect(toastApi.error).toHaveBeenCalledWith(NO_PERMISSION_MESSAGE, expect.anything());
  });

  it('tự hạ quyền: chỉ hiện thông điệp đã xếp hàng (thành công), không có toast lỗi; dùng một lần', async () => {
    queueRedirectNotice('Đã lưu. Bạn không còn là Quản trị.');
    renderRedirect();
    expect(toastApi.success).toHaveBeenCalledWith('Đã lưu. Bạn không còn là Quản trị.', expect.anything());
    expect(toastApi.error).not.toHaveBeenCalled();

    await new Promise((resolve) => setTimeout(resolve, 0));
    renderRedirect();
    expect(toastApi.error).toHaveBeenCalledTimes(1);
  });
});
