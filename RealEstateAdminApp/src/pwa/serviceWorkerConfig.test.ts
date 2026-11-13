import { describe, expect, it } from 'vitest';
import { filterPrecacheEntries, isDeniedNavigationPath, isPrecacheExcluded, NAVIGATION_DENYLIST } from './serviceWorkerConfig';

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

describe('isPrecacheExcluded / filterPrecacheEntries: env.js (FR-15)', () => {
  it.each(['env.js', '/env.js', '//env.js', 'env.js?v=123', 'env.js#frag', '/env.js?a=1#b', 'manifest.webmanifest', 'manifest.webmanifest?x=1'])('loại %s khỏi precache', (url) => {
    expect(isPrecacheExcluded(url)).toBe(true);
  });

  it.each(['assets/index-abc.js', 'assets/env.js', 'env.json', 'env.jsx', 'myenv.js', 'env-abc123.js', 'offline.html', 'assets/manifest-icons.js'])('giữ %s trong precache', (url) => {
    expect(isPrecacheExcluded(url)).toBe(false);
  });

  it('filterPrecacheEntries bỏ env.js ở cả dạng chuỗi lẫn object, giữ nguyên thứ tự các mục còn lại', () => {
    expect(filterPrecacheEntries(['a.js', 'env.js', 'b.css', '/env.js?v=2'])).toEqual(['a.js', 'b.css']);
    const entries = [
      { url: 'assets/index-abc.js', revision: null },
      { url: 'env.js', revision: 'r' },
      { url: 'offline.html', revision: 'y' },
    ];
    expect(filterPrecacheEntries(entries).map((entry) => entry.url)).toEqual(['assets/index-abc.js', 'offline.html']);
  });
});
