import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { computeKeyboardInset, useKeyboardInset } from './useKeyboardInset';

describe('computeKeyboardInset', () => {
  it('bàn phím iOS ~300px che đáy: trả phần bị che và chiều cao còn nhìn thấy', () => {
    expect(computeKeyboardInset(667, { height: 367, offsetTop: 0 })).toEqual({ bottomPx: 300, visibleHeightPx: 367 });
  });

  it('trừ độ lệch offsetTop khi Safari cuộn vùng nhìn thấy xuống', () => {
    expect(computeKeyboardInset(667, { height: 367, offsetTop: 100 })).toEqual({ bottomPx: 200, visibleHeightPx: 367 });
  });

  it('không có bàn phím hoặc chỉ thanh địa chỉ co giãn (< 80px): null', () => {
    expect(computeKeyboardInset(667, { height: 667, offsetTop: 0 })).toBeNull();
    expect(computeKeyboardInset(667, { height: 620, offsetTop: 0 })).toBeNull();
  });

  it('đang chụm phóng to (scale > 1): height co do zoom chứ không do bàn phím -> null', () => {
    expect(computeKeyboardInset(667, { height: 300, offsetTop: 0, scale: 2 })).toBeNull();
    expect(computeKeyboardInset(667, { height: 367, offsetTop: 0, scale: 1 })).toEqual({ bottomPx: 300, visibleHeightPx: 367 });
  });
});

/** visualViewport giả: ghi lại listener để kiểm tra đăng ký/gỡ và bắn sự kiện bằng tay. */
const installViewport = (initial: { height: number; offsetTop: number }) => {
  const listeners = new Map<string, Set<() => void>>();
  const viewport = {
    ...initial,
    scale: 1,
    addEventListener: vi.fn((type: string, handler: () => void) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(handler);
    }),
    removeEventListener: vi.fn((type: string, handler: () => void) => listeners.get(type)?.delete(handler)),
  };
  Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 667 });
  const count = (type: string) => listeners.get(type)?.size ?? 0;
  const fire = (type: string) => listeners.get(type)?.forEach((handler) => handler());
  return { viewport, count, fire };
};

describe('useKeyboardInset', () => {
  afterEach(() => {
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: undefined });
  });

  it('trình duyệt không có visualViewport (máy tính, jsdom): null và không lỗi', () => {
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: undefined });
    const { result } = renderHook(() => useKeyboardInset());
    expect(result.current).toBeNull();
  });

  it('theo dõi resize/scroll của visualViewport: bàn phím hiện -> có số đo, ẩn -> null', () => {
    const { viewport, fire } = installViewport({ height: 667, offsetTop: 0 });
    const { result } = renderHook(() => useKeyboardInset());
    expect(result.current).toBeNull();
    viewport.height = 367;
    act(() => fire('resize'));
    expect(result.current).toEqual({ bottomPx: 300, visibleHeightPx: 367 });
    viewport.height = 667;
    act(() => fire('resize'));
    expect(result.current).toBeNull();
  });

  it('không rò listener: gỡ đủ resize + scroll khi unmount, và không đăng ký khi isEnabled = false', () => {
    const { viewport, count } = installViewport({ height: 367, offsetTop: 0 });
    const { result, unmount } = renderHook(() => useKeyboardInset());
    expect(result.current).toEqual({ bottomPx: 300, visibleHeightPx: 367 });
    expect(count('resize')).toBe(1);
    expect(count('scroll')).toBe(1);
    unmount();
    expect(count('resize')).toBe(0);
    expect(count('scroll')).toBe(0);
    expect(viewport.removeEventListener).toHaveBeenCalledTimes(2);

    const disabled = installViewport({ height: 367, offsetTop: 0 });
    const { result: disabledResult } = renderHook(() => useKeyboardInset(false));
    expect(disabledResult.current).toBeNull();
    expect(disabled.count('resize')).toBe(0);
  });

  it('số đo không đổi thì giữ nguyên object (không render lại vô ích khi cuộn)', () => {
    const { fire } = installViewport({ height: 367, offsetTop: 0 });
    const { result } = renderHook(() => useKeyboardInset());
    const first = result.current;
    act(() => fire('scroll'));
    expect(result.current).toBe(first);
  });
});
