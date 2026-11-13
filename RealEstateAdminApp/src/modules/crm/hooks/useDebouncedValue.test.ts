/** FR-10: wrapper CRM của hook debounce hợp nhất, giữ mặc định 250ms. */
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CRM_DEBOUNCE_MS, useDebouncedValue } from './useDebouncedValue';

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

describe('FR-10: useDebouncedValue (wrapper CRM)', () => {
  it('FR-10: hằng số mặc định CRM là 250ms', () => {
    expect(CRM_DEBOUNCE_MS).toBe(250);
  });

  it('FR-10: mặc định 250ms - chưa đổi ở 249ms, đổi đúng ở 250ms (khác 400ms của hook gốc)', () => {
    const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value), {
      initialProps: { value: 'a' },
    });
    rerender({ value: 'b' });
    advance(249);
    expect(result.current).toBe('a');
    advance(1);
    expect(result.current).toBe('b');
  });

  it('FR-10: caller truyền delayMs riêng (vd. 350ms) thì wrapper không ghi đè', () => {
    const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value, 350), {
      initialProps: { value: 'a' },
    });
    rerender({ value: 'b' });
    advance(250);
    expect(result.current).toBe('a');
    advance(100);
    expect(result.current).toBe('b');
  });

  it('FR-10: đổi liên tiếp chỉ lấy giá trị cuối', () => {
    const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value), {
      initialProps: { value: 'a' },
    });
    rerender({ value: 'b' });
    advance(200);
    rerender({ value: 'c' });
    advance(200);
    expect(result.current).toBe('a');
    advance(50);
    expect(result.current).toBe('c');
  });
});
