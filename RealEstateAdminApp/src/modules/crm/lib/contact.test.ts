import { afterEach, describe, expect, it, vi } from 'vitest';
import { openTelLink, openZaloChat, toTelHref, toZaloHref } from './contact';

afterEach(() => vi.restoreAllMocks());

describe('toTelHref / toZaloHref (khách có thể chưa có SĐT, v1.0.5)', () => {
  it('có số: tạo link gọi và link Zalo', () => {
    expect(toTelHref('0912 345 678')).toBe('tel:0912345678');
    expect(toTelHref('+84 912 345 678')).toBe('tel:+84912345678');
    expect(toZaloHref('+84912345678')).toBe('https://zalo.me/0912345678');
  });

  it.each([[null], [undefined], [''], ['   '], ['abc']])('%j: trả chuỗi rỗng, không ném lỗi', (phone) => {
    expect(() => toTelHref(phone)).not.toThrow();
    expect(toTelHref(phone)).toBe('');
    expect(() => toZaloHref(phone)).not.toThrow();
    expect(toZaloHref(phone)).toBe('');
  });
});

describe('openZaloChat / openTelLink', () => {
  it('SĐT null/rỗng: không mở cửa sổ, không điều hướng', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    expect(() => openZaloChat(null)).not.toThrow();
    expect(() => openZaloChat(undefined)).not.toThrow();
    expect(() => openZaloChat('')).not.toThrow();
    expect(open).not.toHaveBeenCalled();
    expect(() => openTelLink(null)).not.toThrow();
  });

  it('có SĐT: mở Zalo ở tab mới, có noopener', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    openZaloChat('0912 345 678');
    expect(open).toHaveBeenCalledWith('https://zalo.me/0912345678', '_blank', 'noopener,noreferrer');
  });
});
