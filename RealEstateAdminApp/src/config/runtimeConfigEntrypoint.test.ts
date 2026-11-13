import { describe, expect, it } from 'vitest';
import entrypointScript from '../../docker-entrypoint.d/40-runtime-config.sh?raw';
import { RUNTIME_BOOLEAN_KEYS } from './runtimeConfigSchema';

/**
 * Đối chiếu danh sách cờ của entrypoint nginx (`docker-entrypoint.d/40-runtime-config.sh`, biến `FLAG_KEYS`) với
 * `RUNTIME_BOOLEAN_KEYS` của FE (FR-15): hai nơi phải liệt kê cùng một tập khóa. Lệch (thêm khóa ở một phía) thì cờ bị bỏ
 * âm thầm ở production (entrypoint không phát khóa) hoặc FE nhận khóa mà image không bao giờ sinh ra.
 * Đọc bằng `?raw` (đường dẫn tương đối theo file test, không phụ thuộc thư mục chạy vitest; `import.meta.url` ở jsdom là http nên không dùng `fs`).
 */

/** Tách danh sách khóa trong `FLAG_KEYS="A B C"` (một dòng, dấu nháy kép, ngăn cách bằng khoảng trắng). */
const parseFlagKeys = (script: string): string[] => {
  const match = /^FLAG_KEYS="([^"]*)"\s*$/m.exec(script);
  if (!match) throw new Error('Không tìm thấy dòng FLAG_KEYS="..." trong 40-runtime-config.sh');
  return match[1].split(/\s+/).filter(Boolean);
};

describe('FR-15 entrypoint 40-runtime-config.sh khớp RUNTIME_BOOLEAN_KEYS', () => {
  const script = entrypointScript;

  it('FLAG_KEYS và RUNTIME_BOOLEAN_KEYS là cùng một tập khóa', () => {
    const shellKeys = parseFlagKeys(script);
    expect(new Set(shellKeys).size).toBe(shellKeys.length);
    expect([...shellKeys].sort()).toEqual([...RUNTIME_BOOLEAN_KEYS].sort());
  });

  it('API_URL (khóa URL) có mặt trong entrypoint', () => {
    expect(script).toMatch(/get_env API_URL\b/);
  });

  it('FRONTEND_URL (nguồn của appUrl) có mặt trong entrypoint', () => {
    expect(script).toMatch(/get_env FRONTEND_URL\b/);
  });

  describe('bộ tách parseFlagKeys (mutation: lệch một khóa thì tập khác nhau)', () => {
    it('thêm một khóa ở phía shell làm hai tập lệch nhau', () => {
      const mutated = script.replace(/^FLAG_KEYS="/m, 'FLAG_KEYS="CRM_EXTRA_KEY ');
      expect([...parseFlagKeys(mutated)].sort()).not.toEqual([...RUNTIME_BOOLEAN_KEYS].sort());
    });

    it('bớt một khóa ở phía shell làm hai tập lệch nhau', () => {
      const mutated = script.replace(/^FLAG_KEYS="CRM_ENABLED /m, 'FLAG_KEYS="');
      expect([...parseFlagKeys(mutated)].sort()).not.toEqual([...RUNTIME_BOOLEAN_KEYS].sort());
    });

    it('thiếu dòng FLAG_KEYS thì ném lỗi rõ ràng', () => {
      expect(() => parseFlagKeys('echo hi')).toThrow(/FLAG_KEYS/);
    });
  });
});
