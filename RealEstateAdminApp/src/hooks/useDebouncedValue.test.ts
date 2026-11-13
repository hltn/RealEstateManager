/** FR-10: hook debounce hợp nhất, mặc định 400ms ở ngoài CRM. */
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDebouncedValue } from './useDebouncedValue';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

const advance = (ms: number) => {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
};

describe('FR-10: useDebouncedValue (hook gốc)', () => {
  it('FR-10: trả ngay giá trị ban đầu', () => {
    const { result } = renderHook(() => useDebouncedValue('a'));
    expect(result.current).toBe('a');
  });

  it('FR-10: mặc định 400ms - chưa đổi ở 399ms, đổi đúng ở 400ms', () => {
    const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value), {
      initialProps: { value: 'a' },
    });
    rerender({ value: 'b' });
    advance(399);
    expect(result.current).toBe('a');
    advance(1);
    expect(result.current).toBe('b');
  });

  it('FR-10: tôn trọng tham số delayMs truyền vào', () => {
    const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value, 100), {
      initialProps: { value: 'a' },
    });
    rerender({ value: 'b' });
    advance(99);
    expect(result.current).toBe('a');
    advance(1);
    expect(result.current).toBe('b');
  });

  it('FR-10: đổi liên tiếp thì chỉ lấy giá trị cuối, mỗi lần đổi tính lại thời gian chờ', () => {
    const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value), {
      initialProps: { value: 'a' },
    });
    rerender({ value: 'b' });
    advance(300);
    rerender({ value: 'c' });
    advance(300);
    expect(result.current).toBe('a');
    advance(100);
    expect(result.current).toBe('c');
  });

  it('FR-10: unmount thì hủy timer, không cập nhật state sau đó', () => {
    const { rerender, unmount } = renderHook(({ value }) => useDebouncedValue(value), {
      initialProps: { value: 'a' },
    });
    rerender({ value: 'b' });
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
