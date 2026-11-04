import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import toast, { Toaster } from 'react-hot-toast';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { registerServiceWorkerMock } = vi.hoisted(() => ({ registerServiceWorkerMock: vi.fn() }));
vi.mock('./registerServiceWorker', () => ({ registerServiceWorker: registerServiceWorkerMock }));

import PwaUpdatePrompt from './PwaUpdatePrompt';

describe('PwaUpdatePrompt', () => {
  const dispose = vi.fn();
  const applyUpdate = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    // jsdom không có matchMedia; react-hot-toast cần nó để đọc prefers-reduced-motion.
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: false, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    registerServiceWorkerMock.mockReset().mockReturnValue(dispose);
    applyUpdate.mockClear();
    dispose.mockClear();
  });

  afterEach(() => {
    toast.remove();
    vi.unstubAllGlobals();
  });

  const renderPrompt = () =>
    render(
      <>
        <Toaster />
        <PwaUpdatePrompt />
      </>,
    );

  /** Giả lập service worker báo có bản mới. */
  const notifyUpdateAvailable = () => act(() => registerServiceWorkerMock.mock.calls[0][0](applyUpdate));

  it('chưa có bản mới thì không hiện toast', () => {
    renderPrompt();
    expect(registerServiceWorkerMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Có phiên bản mới')).not.toBeInTheDocument();
  });

  it('có bản mới: hiện toast và CHƯA cập nhật cho tới khi bấm "Cập nhật"', async () => {
    renderPrompt();
    notifyUpdateAvailable();

    expect(await screen.findByText('Có phiên bản mới')).toBeInTheDocument();
    expect(applyUpdate).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Cập nhật' }));
    expect(applyUpdate).toHaveBeenCalledTimes(1);
  });

  it('"Để sau" đóng toast mà không cập nhật', async () => {
    renderPrompt();
    notifyUpdateAvailable();

    await userEvent.click(await screen.findByRole('button', { name: 'Để sau' }));
    expect(applyUpdate).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(screen.queryByText('Có phiên bản mới')).not.toBeInTheDocument(), { timeout: 3000 });
  });

  it('báo bản mới nhiều lần vẫn chỉ có một toast', async () => {
    renderPrompt();
    notifyUpdateAvailable();
    notifyUpdateAvailable();

    expect(await screen.findAllByText('Có phiên bản mới')).toHaveLength(1);
  });

  it('unmount thì gỡ việc theo dõi cập nhật', () => {
    const { unmount } = renderPrompt();
    unmount();
    expect(dispose).toHaveBeenCalledTimes(1);
  });
});
