import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import toast, { Toaster } from 'react-hot-toast';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ChunkLoadErrorNotifier from './ChunkLoadErrorNotifier';

const TOAST_TITLE = 'Ứng dụng đã có phiên bản mới';

/** Bắn `vite:preloadError` như Vite (cancelable) và trả về sự kiện để kiểm `defaultPrevented`. */
const firePreloadError = (): Event => {
  const event = new Event('vite:preloadError', { cancelable: true });
  act(() => {
    window.dispatchEvent(event);
  });
  return event;
};

describe('ChunkLoadErrorNotifier', () => {
  const reload = vi.fn();

  beforeEach(() => {
    // jsdom không có matchMedia (react-hot-toast cần) và không cho spy trực tiếp window.location.reload.
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: false, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    vi.stubGlobal('location', { ...window.location, reload });
    reload.mockClear();
  });

  afterEach(() => {
    toast.remove();
    vi.unstubAllGlobals();
  });

  const renderNotifier = () =>
    render(
      <>
        <Toaster />
        <ChunkLoadErrorNotifier />
      </>,
    );

  it('chưa có lỗi thì không hiện toast', () => {
    renderNotifier();
    expect(screen.queryByText(TOAST_TITLE)).not.toBeInTheDocument();
  });

  it('có lỗi tải chunk: chặn lỗi mặc định, hiện toast và KHÔNG tự reload', async () => {
    renderNotifier();
    const event = firePreloadError();

    expect(event.defaultPrevented).toBe(true);
    expect(await screen.findByText(TOAST_TITLE)).toBeInTheDocument();
    expect(reload).not.toHaveBeenCalled();
  });

  it('bắn nhiều lần vẫn chỉ có một toast', async () => {
    renderNotifier();
    firePreloadError();
    firePreloadError();
    firePreloadError();

    expect(await screen.findAllByText(TOAST_TITLE)).toHaveLength(1);
  });

  it('bấm "Tải lại" mới gọi reload', async () => {
    renderNotifier();
    firePreloadError();

    await userEvent.click(await screen.findByRole('button', { name: 'Tải lại' }));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('"Đóng" tắt toast mà không reload', async () => {
    renderNotifier();
    firePreloadError();

    await userEvent.click(await screen.findByRole('button', { name: 'Đóng' }));
    expect(reload).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(screen.queryByText(TOAST_TITLE)).not.toBeInTheDocument(), { timeout: 3000 });
  });

  it('unmount thì gỡ listener: lỗi sau đó không còn bị chặn', () => {
    const { unmount } = renderNotifier();
    unmount();

    const event = firePreloadError();
    expect(event.defaultPrevented).toBe(false);
  });
});
