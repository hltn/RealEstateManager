import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

export interface AppVersionInfo {
  version: string;
  commit: string | null;
  /** File đã đọc ra số phiên bản (để in ra cho người vận hành đối chiếu). */
  source: string;
}

const readJson = (path: string): Record<string, unknown> | null => {
  if (!existsSync(path)) return null;
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
    return parsed && typeof parsed === 'object'
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
};

const asNonEmptyString = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : null;

/**
 * Đường dẫn ứng viên theo thứ tự ưu tiên. `baseDir` là thư mục chứa file đang chạy (`dist/migrations`, hoặc
 * `src/migrations` khi chạy bằng ts-node):
 *   1) `<baseDir>/../version.json`  = `dist/version.json` (Dockerfile sinh ở stage builder, có thể kèm `commit`)
 *   2) `<baseDir>/../../package.json` = `/app/package.json` trong image (nếu Dockerfile copy package.json)
 *   3) `<cwd>/package.json`
 */
export const appVersionCandidates = (
  baseDir: string,
  cwd: string,
): Array<{ path: string; kind: 'version.json' | 'package.json' }> => [
  { path: resolve(baseDir, '..', 'version.json'), kind: 'version.json' },
  { path: resolve(baseDir, '..', '..', 'package.json'), kind: 'package.json' },
  { path: resolve(cwd, 'package.json'), kind: 'package.json' },
];

/** Đọc số phiên bản app. `GIT_COMMIT` (env) được dùng làm commit khi file không có `commit`. */
export const readAppVersion = (
  baseDir: string = __dirname,
  cwd: string = process.cwd(),
  env: NodeJS.ProcessEnv = process.env,
): AppVersionInfo => {
  for (const candidate of appVersionCandidates(baseDir, cwd)) {
    const json = readJson(candidate.path);
    const version = json ? asNonEmptyString(json.version) : null;
    if (!json || !version) continue;
    const commit =
      asNonEmptyString(json.commit) ?? asNonEmptyString(env.GIT_COMMIT);
    return { version, commit, source: candidate.path };
  }
  throw new Error(
    'Không đọc được số phiên bản app: thiếu dist/version.json và package.json (có trường "version").',
  );
};
