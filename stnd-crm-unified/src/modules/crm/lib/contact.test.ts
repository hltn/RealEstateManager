import { afterEach, describe, expect, it, vi } from 'vitest';
import { openTelLink, openZaloChat, toTelHref, toZaloHref } from './contact';

describe('lib/contact: null-safe', () => {
  afterEach(() => vi.restoreAllMocks());

  it.each([null, undefined, ''])('không có link gọi/Zalo khi SĐT là %j', (value) => {
    expect(toTelHref(value)).toBe('');
    expect(toZaloHref(value)).toBe('');
  });

  it('openZaloChat không mở tab khi không có SĐT', () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    openZaloChat(null);
    openZaloChat(undefined);
    expect(open).not.toHaveBeenCalled();
  });

  it('openTelLink không ném lỗi và không đổi địa chỉ khi không có SĐT', () => {
    const before = window.location.href;
    expect(() => openTelLink(null)).not.toThrow();
    expect(window.location.href).toBe(before);
  });

  it('tạo link đúng khi có số', () => {
    expect(toTelHref('0912 345 678')).toBe('tel:0912345678');
    expect(toZaloHref('+84912345678')).toBe('https://zalo.me/0912345678');
  });

  it('openZaloChat mở Zalo khi có số', () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    openZaloChat('+84912345678');
    expect(open).toHaveBeenCalledWith('https://zalo.me/0912345678', '_blank', 'noopener,noreferrer');
  });
});
