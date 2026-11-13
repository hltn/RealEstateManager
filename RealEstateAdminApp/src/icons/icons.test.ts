/**
 * FR-09 (Thống nhất môi trường): thư mục `icons/` chỉ giữ 18 icon còn dùng; không có file svg mồ côi
 * (không được `index.ts` nhập) và không có tên xuất ra mà thiếu file.
 */
import { describe, expect, it } from 'vitest';
import * as icons from './index';

// Chỉ lấy danh sách đường dẫn (không nạp nội dung svg) để so với `index.ts`.
const svgFiles = Object.keys(import.meta.glob('./*.svg', { query: '?url', import: 'default' }));
const indexSource = Object.values(
  import.meta.glob<string>('./index.ts', { query: '?raw', import: 'default', eager: true }),
)[0];

const EXPECTED_ICON_NAMES = [
  'CalenderIcon',
  'ChevronDownIcon',
  'CloseIcon',
  'DocsIcon',
  'EnvelopeIcon',
  'EyeCloseIcon',
  'EyeIcon',
  'FileIcon',
  'GroupIcon',
  'HorizontaLDots',
  'ListIcon',
  'LockIcon',
  'PieChartIcon',
  'PlugInIcon',
  'PlusIcon',
  'TableIcon',
  'UserCircleIcon',
  'UserIcon',
];

describe('FR-09: bộ icon sau khi dọn 38 icon không dùng', () => {
  it('FR-09: index.ts xuất đúng 18 tên còn dùng', () => {
    expect(Object.keys(icons).sort()).toEqual(EXPECTED_ICON_NAMES);
  });

  it('FR-09: mỗi tên xuất ra là một component dùng được (không undefined)', () => {
    for (const name of EXPECTED_ICON_NAMES) {
      expect(icons[name as keyof typeof icons], name).toBeDefined();
    }
  });

  it('FR-09: thư mục có đúng 18 file svg và mọi file đều được index.ts nhập (không file mồ côi)', () => {
    expect(svgFiles).toHaveLength(18);
    const orphans = svgFiles.filter((file) => !indexSource.includes(`"${file}?react"`));
    expect(orphans).toEqual([]);
  });

  it('FR-09: calendar.svg (icon trùng calender-line) đã bị xóa', () => {
    expect(svgFiles).not.toContain('./calendar.svg');
  });
});
