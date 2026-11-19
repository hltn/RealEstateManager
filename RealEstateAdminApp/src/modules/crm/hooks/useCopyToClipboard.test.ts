import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ copyTextToClipboard: vi.fn() }));
vi.mock('@crm/lib/clipboard', () => ({ copyTextToClipboard: mocks.copyTextToClipboard }));

import { useCopyToClipboard } from './useCopyToClipboard';

describe('useCopyToClipboard', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.copyTextToClipboard.mockReset().mockResolvedValue(true);
  });
  afterEach(() => vi.useRealTimers());

  it('chép thành công: isCopied=true đúng 1.5s rồi tự tắt (1499ms vẫn bật, 1500ms đã tắt)', async () => {
    const { result } = renderHook(() => useCopyToClipboard());
    expect(result.current.isCopied).toBe(false);
    let isSuccess = false;
    await act(async () => {
      isSuccess = await result.current.copy('KH-000053');
    });
    expect(isSuccess).toBe(true);
    expect(mocks.copyTextToClipboard).toHaveBeenCalledWith('KH-000053');
    expect(result.current.isCopied).toBe(true);
    act(() => void vi.advanceTimersByTime(1499));
    expect(result.current.isCopied).toBe(true);
    act(() => void vi.advanceTimersByTime(1));
    expect(result.current.isCopied).toBe(false);
  });

  it('chép thất bại: trả false và KHÔNG bật isCopied', async () => {
    mocks.copyTextToClipboard.mockResolvedValue(false);
    const { result } = renderHook(() => useCopyToClipboard());
    let isSuccess = true;
    await act(async () => {
      isSuccess = await result.current.copy('KH-000053');
    });
    expect(isSuccess).toBe(false);
    expect(result.current.isCopied).toBe(false);
  });

  it('bấm lại khi đang hiện Check: tính lại mốc 1.5s từ lần bấm sau', async () => {
    const { result } = renderHook(() => useCopyToClipboard());
    await act(async () => void (await result.current.copy('a')));
    act(() => void vi.advanceTimersByTime(1000));
    await act(async () => void (await result.current.copy('a')));
    act(() => void vi.advanceTimersByTime(1000));
    expect(result.current.isCopied).toBe(true);
    act(() => void vi.advanceTimersByTime(500));
    expect(result.current.isCopied).toBe(false);
  });

  it('unmount khi timer đang chạy: dọn timer, không còn timer treo', async () => {
    const { result, unmount } = renderHook(() => useCopyToClipboard());
    await act(async () => void (await result.current.copy('a')));
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('unmount trước khi chép xong: không bật timer mới', async () => {
    let resolveCopy: (value: boolean) => void = () => {};
    mocks.copyTextToClipboard.mockReturnValue(new Promise<boolean>((resolve) => (resolveCopy = resolve)));
    const { result, unmount } = renderHook(() => useCopyToClipboard());
    let pending: Promise<boolean> = Promise.resolve(false);
    act(() => {
      pending = result.current.copy('a');
    });
    unmount();
    resolveCopy(true);
    await pending;
    expect(vi.getTimerCount()).toBe(0);
  });
});
