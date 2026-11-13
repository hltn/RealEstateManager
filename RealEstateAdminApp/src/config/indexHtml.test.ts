import { describe, expect, it } from 'vitest';
import indexHtml from '../../index.html?raw';

/**
 * Test tĩnh `index.html` (FR-15): `runtimeConfig.ts` đọc `window.__APP_CONFIG__` MỘT LẦN khi nạp module, nên `/env.js`
 * phải là script thường CHẶN (không `defer`/`async`/`type="module"`) và đứng TRƯỚC script app. Đảo thứ tự hoặc thêm
 * `defer` sẽ khiến app đọc cấu hình rỗng (mọi cờ tắt, API_URL mặc định) mà không báo lỗi nào.
 */
const SCRIPT_TAG_PATTERN = /<script\b[^>]*>/gi;
const scriptTags = indexHtml.match(SCRIPT_TAG_PATTERN) ?? [];
const indexOfTag = (predicate: (tag: string) => boolean): number => scriptTags.findIndex(predicate);

describe('FR-15 index.html: /env.js nạp trước script app', () => {
  const envIndex = indexOfTag((tag) => /\bsrc="\/env\.js"/.test(tag));
  const appIndex = indexOfTag((tag) => /\bsrc="\/src\/main\.tsx"/.test(tag));

  it('có đúng một thẻ <script src="/env.js"> và một script app /src/main.tsx', () => {
    expect(scriptTags.filter((tag) => /\bsrc="\/env\.js"/.test(tag))).toHaveLength(1);
    expect(scriptTags.filter((tag) => /\bsrc="\/src\/main\.tsx"/.test(tag))).toHaveLength(1);
  });

  it('/env.js đứng TRƯỚC script app trong thứ tự tài liệu', () => {
    expect(envIndex).toBeGreaterThanOrEqual(0);
    expect(appIndex).toBeGreaterThanOrEqual(0);
    expect(envIndex).toBeLessThan(appIndex);
  });

  it('/env.js là script thường chặn: không type="module", không defer, không async', () => {
    const tag = scriptTags[envIndex];
    expect(tag).not.toMatch(/\btype\s*=/i);
    expect(tag).not.toMatch(/\bdefer\b/i);
    expect(tag).not.toMatch(/\basync\b/i);
  });

  it('/env.js nằm trong <head> (trước <body> chứa script app)', () => {
    const envPosition = indexHtml.indexOf('src="/env.js"');
    expect(envPosition).toBeGreaterThan(indexHtml.indexOf('<head>'));
    expect(envPosition).toBeLessThan(indexHtml.indexOf('</head>'));
  });
});
