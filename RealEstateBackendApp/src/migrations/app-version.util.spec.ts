import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { readAppVersion } from './app-version.util';

describe('readAppVersion', () => {
  let root: string;
  let baseDir: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'app-version-'));
    // Giả lập image: <root>/dist/migrations là nơi cli.js chạy; <root>/package.json là /app/package.json.
    baseDir = join(root, 'dist', 'migrations');
    mkdirSync(baseDir, { recursive: true });
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('ưu tiên dist/version.json (kèm commit)', () => {
    writeFileSync(
      join(root, 'dist', 'version.json'),
      JSON.stringify({ version: '1.2.3', commit: 'abc1234' }),
    );
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({ version: '9.9.9' }),
    );
    const info = readAppVersion(baseDir, root, {});
    expect(info.version).toBe('1.2.3');
    expect(info.commit).toBe('abc1234');
    expect(info.source).toContain('version.json');
  });

  it('fallback package.json khi không có dist/version.json; commit lấy từ GIT_COMMIT', () => {
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({ version: '1.0.2' }),
    );
    const info = readAppVersion(baseDir, root, { GIT_COMMIT: 'e6099c0' });
    expect(info).toMatchObject({ version: '1.0.2', commit: 'e6099c0' });
  });

  it('bỏ qua version.json hỏng rồi fallback package.json', () => {
    writeFileSync(join(root, 'dist', 'version.json'), '{không phải json');
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({ version: '1.0.2' }),
    );
    expect(readAppVersion(baseDir, root, {}).version).toBe('1.0.2');
  });

  it('ném lỗi rõ ràng khi không có file nào', () => {
    expect(() => readAppVersion(baseDir, root, {})).toThrow(/số phiên bản app/);
  });

  it('đọc được package.json thật của backend từ src/migrations', () => {
    const info = readAppVersion(__dirname, root, {});
    expect(info.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(info.source).toMatch(/package\.json$/);
  });
});
