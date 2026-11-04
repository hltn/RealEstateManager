import { describe, expect, it } from 'vitest';
import { filterPrecacheEntries, isDeniedNavigationPath, NAVIGATION_DENYLIST } from './serviceWorkerConfig';

describe('isDeniedNavigationPath (service worker không được chạm /api)', () => {
  it.each(['/api/v1/auth/me', '/api/v1/crm/customers/123/attachments/abc', '/api/'])('chặn %s', (pathname) => {
    expect(isDeniedNavigationPath(pathname)).toBe(true);
  });

  it.each(['/', '/login', '/crm/today', '/crm/customers/api', '/apis/x', '/apiary', '/offline.html'])('cho phép %s', (pathname) => {
    expect(isDeniedNavigationPath(pathname)).toBe(false);
  });

  it('denylist neo ở gốc: một đường dẫn có "/api/" ở giữa vẫn là route SPA bình thường', () => {
    expect(NAVIGATION_DENYLIST.some((pattern) => pattern.test('/crm/api/notes'))).toBe(false);
  });
});

describe('filterPrecacheEntries', () => {
  it('bỏ manifest.webmanifest (dạng object và dạng chuỗi), giữ nguyên các mục còn lại theo thứ tự', () => {
    const entries = [
      { url: 'assets/index-abc.js', revision: null },
      { url: 'manifest.webmanifest', revision: 'x' },
      { url: 'offline.html', revision: 'y' },
    ];
    expect(filterPrecacheEntries(entries).map((entry) => entry.url)).toEqual(['assets/index-abc.js', 'offline.html']);
    expect(filterPrecacheEntries(['a.js', 'manifest.webmanifest', 'b.css'])).toEqual(['a.js', 'b.css']);
  });

  it('không loại nhầm file có tên chứa "manifest" nhưng khác', () => {
    expect(filterPrecacheEntries(['assets/manifest-icons.js'])).toEqual(['assets/manifest-icons.js']);
  });
});
