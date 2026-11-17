/**
 * Bộ icon `icons/` giữ cả icon chưa dùng tới (tài nguyên dự phòng), nên test không ép số lượng.
 * Chỉ bảo vệ tính toàn vẹn: mọi tên xuất ra từ `index.ts` dùng được, và mọi svg mà `index.ts` nhập đều có file.
 */
import { describe, expect, it } from 'vitest';
import * as icons from './index';

// Chỉ lấy danh sách đường dẫn (không nạp nội dung svg) để so với `index.ts`.
const svgFiles = Object.keys(import.meta.glob('./*.svg', { query: '?url', import: 'default' }));
const indexSource = Object.values(
  import.meta.glob<string>('./index.ts', { query: '?raw', import: 'default', eager: true }),
)[0];

describe('bộ icon (giữ cả icon chưa dùng)', () => {
  it('mỗi tên xuất ra từ index.ts là một component dùng được (không undefined)', () => {
    const names = Object.keys(icons);
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      expect(icons[name as keyof typeof icons], name).toBeDefined();
    }
  });

  it('mọi svg mà index.ts nhập đều có file trong thư mục (không import thiếu file)', () => {
    const imported = [...indexSource.matchAll(/from\s+"(\.\/[^"]+\.svg)\?react"/g)].map((m) => m[1]);
    expect(imported.length).toBeGreaterThan(0);
    expect(imported.filter((file) => !svgFiles.includes(file))).toEqual([]);
  });
});
