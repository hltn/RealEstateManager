/**
 * Build backend cho E2E vào thư mục RIÊNG (`RealEstateBackendApp/.e2e-dist`), KHÔNG BAO GIỜ ghi vào `dist`.
 * Lý do: `dist` dùng chung với backend dev cổng 3000 (.claude/scripts/start-backend.cjs nạp dist/main) và
 * nest-cli.json có `deleteOutDir: true` nên `npm run build` sẽ xóa dist đang chạy.
 *
 * Cách làm: gọi thẳng Nest CLI với cấu hình riêng trong e2e/backend-build/
 *   - nest-cli.e2e.json: giống nest-cli.json (swc, copy asset json) nhưng chỉ dùng cho E2E;
 *   - tsconfig.e2e.json: extends tsconfig.build.json, đổi `outDir` sang `.e2e-dist`.
 * `deleteOutDir` trong bản riêng chỉ xóa `.e2e-dist`.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { PATHS, isTruthyFlag } from '../env';

const STAMP = '.e2e-build-stamp';
const mainJs = () => path.join(PATHS.backendDist, 'main.js');

/** Bỏ qua build chỉ khi đúng '1' hoặc 'true' ('0', 'false', rỗng đều KHÔNG phải bật). */
export function isSkipBuildRequested(value: string | undefined = process.env.E2E_SKIP_BUILD): boolean {
  return isTruthyFlag(value);
}

/** mtime lớn nhất của file đầu vào ảnh hưởng build: src (.ts không spec, .json), package.json, tsconfig*, nest-cli, cấu hình build riêng. */
function newestInputMtime(): number {
  const walk = (dir: string): number =>
    fs.readdirSync(dir, { withFileTypes: true }).reduce((max, e) => {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) return Math.max(max, walk(p));
      const isInput = (e.name.endsWith('.ts') && !e.name.endsWith('.spec.ts') && !e.name.endsWith('.d.ts')) || e.name.endsWith('.json');
      return isInput ? Math.max(max, fs.statSync(p).mtimeMs) : max;
    }, 0);
  const fixed = ['package.json', 'tsconfig.json', 'tsconfig.build.json', 'nest-cli.json']
    .map((f) => path.join(PATHS.backendDir, f))
    .filter((p) => fs.existsSync(p));
  return Math.max(walk(path.join(PATHS.backendDir, 'src')), walk(PATHS.backendBuildDir), ...fixed.map((p) => fs.statSync(p).mtimeMs));
}

/** Build còn mới nếu có main.js + dấu build và không file đầu vào nào mới hơn thời điểm BẮT ĐẦU lần build đó. */
export function isBuildFresh(): boolean {
  const stamp = path.join(PATHS.backendDist, STAMP);
  if (!fs.existsSync(mainJs()) || !fs.existsSync(stamp)) return false;
  return newestInputMtime() <= fs.statSync(stamp).mtimeMs;
}

/** Chặn tuyệt đối việc vô tình trỏ build vào `dist` dùng chung hoặc ra ngoài thư mục backend. */
function assertSafeOutDir(): void {
  const sharedDist = path.resolve(PATHS.backendDir, 'dist');
  const out = path.resolve(PATHS.backendDist);
  const insideBackend = out.startsWith(path.resolve(PATHS.backendDir) + path.sep);
  if (out === sharedDist || !insideBackend || path.basename(out) !== '.e2e-dist') {
    throw new Error(`[E2E] Từ chối build: thư mục build E2E "${out}" không hợp lệ (phải là RealEstateBackendApp/.e2e-dist, khác dist)`);
  }
}

/** Đảm bảo `.e2e-dist/main.js` tồn tại và còn mới; build khi cần. Không bao giờ chạm tới `dist`. */
export function ensureBackendBuilt(): void {
  assertSafeOutDir();
  if (isBuildFresh()) {
    console.log('[E2E] build backend riêng (.e2e-dist) còn mới, bỏ qua build.');
    return;
  }
  if (isSkipBuildRequested()) {
    if (!fs.existsSync(mainJs())) throw new Error('[E2E] E2E_SKIP_BUILD bật nhưng chưa có .e2e-dist/main.js; bỏ biến này để build lần đầu');
    console.log('[E2E] E2E_SKIP_BUILD bật: dùng .e2e-dist hiện có dù có thể cũ hơn mã nguồn.');
    return;
  }

  // Ảnh chụp dist dùng chung trước build để chứng minh build E2E không đụng tới nó.
  const sharedMain = path.join(PATHS.backendDir, 'dist/main.js');
  const mtimeOf = (p: string) => (fs.existsSync(p) ? fs.statSync(p).mtimeMs : -1);
  const before = mtimeOf(sharedMain);

  console.log('[E2E] build backend vào .e2e-dist (lần đầu có thể mất vài phút)...');
  const startedAt = new Date();
  fs.rmSync(path.join(PATHS.backendDist, STAMP), { force: true });
  // Nest CLI nối đường dẫn -c/-p với cwd nên phải truyền đường dẫn tương đối so với thư mục backend.
  const rel = (p: string) => path.relative(PATHS.backendDir, p);
  const nestBin = path.join(PATHS.backendDir, 'node_modules/@nestjs/cli/bin/nest.js');
  const r = spawnSync(
    process.execPath,
    [nestBin, 'build', '-c', rel(path.join(PATHS.backendBuildDir, 'nest-cli.e2e.json')), '-p', rel(path.join(PATHS.backendBuildDir, 'tsconfig.e2e.json'))],
    { cwd: PATHS.backendDir, stdio: 'inherit', windowsHide: true },
  );
  if (r.status !== 0) throw new Error(`[E2E] nest build (cấu hình E2E) thất bại, mã thoát ${r.status}`);
  if (!fs.existsSync(mainJs())) throw new Error('[E2E] build xong nhưng thiếu .e2e-dist/main.js');
  if (mtimeOf(sharedMain) !== before) {
    throw new Error('[E2E] CẢNH BÁO: dist/main.js dùng chung bị đổi trong lúc build E2E; kiểm tra e2e/backend-build/tsconfig.e2e.json');
  }

  // Dấu build mang thời điểm BẮT ĐẦU: file nguồn sửa trong lúc build sẽ khiến lần sau build lại.
  const stamp = path.join(PATHS.backendDist, STAMP);
  fs.writeFileSync(stamp, startedAt.toISOString());
  fs.utimesSync(stamp, startedAt, startedAt);
}
