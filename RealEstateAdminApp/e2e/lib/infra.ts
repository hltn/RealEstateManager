/**
 * Dựng/dọn hạ tầng E2E: Mongo tạm (replica set), Redis db 15, MinIO bucket e2e-*, tiến trình backend + Vite.
 * Thư viện (mongodb-memory-server, ioredis, @aws-sdk/client-s3) lấy từ node_modules của backend để AdminApp
 * không phải thêm dependency; vì vậy cần `npm install` ở RealEstateBackendApp trước.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { PATHS, PORTS, REDIS, S3, URLS, adminEnv, assertIsolated, backendEnv } from '../env';
import { ensureBackendBuilt } from './backend-build';

const beRequire = createRequire(path.join(PATHS.backendDir, 'package.json'));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const lib = (name: string): any => beRequire(name);

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── Mongo tạm ───────────────────────────────────────────────────────────────
export async function startMongo() {
  const { MongoMemoryReplSet } = lib('mongodb-memory-server');
  const repl = await MongoMemoryReplSet.create({ replSet: { count: 1, name: 'rs0' }, instanceOpts: [{ ip: '127.0.0.1' }] });
  const uri = repl.getUri('e2e') as string;
  try {
    assertIsolated({ mongoUri: uri });
  } catch (e) {
    await repl.stop();
    throw e;
  }
  return { repl, uri };
}

// ── Redis db 15 ─────────────────────────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function withRedis<T>(fn: (r: any) => Promise<T>): Promise<T> {
  assertIsolated(); // đọc lại host/port/db/prefix thật trước MỌI thao tác Redis
  const Redis = lib('ioredis');
  const r = new Redis({ host: REDIS.host, port: REDIS.port, db: REDIS.db, lazyConnect: true, maxRetriesPerRequest: 1 });
  await r.connect();
  try {
    return await fn(r);
  } finally {
    r.disconnect();
  }
}
/** FLUSHDB chỉ xóa db của kết nối (db 15), không đụng db 0. */
export const flushRedis = () => withRedis((r) => r.flushdb());

// ── MinIO ───────────────────────────────────────────────────────────────────
export function s3Client() {
  assertIsolated(); // mọi client S3 (đọc/ghi/xóa) chỉ được trỏ vào endpoint loopback
  const { S3Client } = lib('@aws-sdk/client-s3');
  return new S3Client({
    endpoint: S3.endpoint,
    region: S3.region,
    forcePathStyle: true,
    credentials: { accessKeyId: S3.accessKeyId, secretAccessKey: S3.secretAccessKey },
  });
}

function assertE2eBucket(bucket: string) {
  assertIsolated(); // endpoint S3 phải là loopback trước mọi thao tác xóa/tạo bucket
  if (!bucket.startsWith('e2e-')) throw new Error(`[E2E] Từ chối thao tác bucket "${bucket}" (không bắt đầu bằng e2e-)`);
}

export async function emptyBucket(bucket: string): Promise<void> {
  assertE2eBucket(bucket);
  const { ListObjectsV2Command, DeleteObjectsCommand } = lib('@aws-sdk/client-s3');
  const s3 = s3Client();
  let token: string | undefined;
  do {
    const res = await s3.send(new ListObjectsV2Command({ Bucket: bucket, ContinuationToken: token }));
    const keys = (res.Contents ?? []).map((o: { Key: string }) => ({ Key: o.Key }));
    if (keys.length) await s3.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: keys } }));
    token = res.NextContinuationToken;
  } while (token);
}

export async function ensureBucket(bucket: string): Promise<void> {
  assertE2eBucket(bucket);
  const { CreateBucketCommand, HeadBucketCommand } = lib('@aws-sdk/client-s3');
  const s3 = s3Client();
  try {
    await s3.send(new HeadBucketCommand({ Bucket: bucket }));
  } catch {
    await s3.send(new CreateBucketCommand({ Bucket: bucket }));
  }
  await emptyBucket(bucket);
}

export async function dropBucket(bucket: string): Promise<void> {
  assertE2eBucket(bucket);
  const { DeleteBucketCommand } = lib('@aws-sdk/client-s3');
  try {
    await emptyBucket(bucket);
    await s3Client().send(new DeleteBucketCommand({ Bucket: bucket }));
  } catch {
    /* bucket đã không còn: bỏ qua */
  }
}

// ── Tiến trình ──────────────────────────────────────────────────────────────
/** Thử kết nối 1 địa chỉ cụ thể; lỗi (kể cả máy không có IPv6) coi là không bận. */
function isHostPortBusy(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const s = net.connect({ port, host });
    s.setTimeout(2000, () => {
      s.destroy();
      resolve(false);
    });
    s.once('connect', () => {
      s.destroy();
      resolve(true);
    });
    s.once('error', () => resolve(false));
  });
}

/** Cổng bận nếu có ai nghe ở IPv4 loopback HOẶC IPv6 loopback (Vite mồ côi hay bind `[::1]`). */
export async function isPortBusy(port: number): Promise<boolean> {
  const results = await Promise.all([isHostPortBusy(port, '127.0.0.1'), isHostPortBusy(port, '::1')]);
  return results.some(Boolean);
}

const ANSI_COLOR = new RegExp(String.fromCharCode(27) + '\\[[0-9;]*m', 'g');

/** In tối đa `lines` dòng cuối của file log trong `.runtime/logs` (để đính vào lỗi chẩn đoán). */
export function tailLog(name: string, lines = 40): string {
  const file = path.join(PATHS.logDir, `${name}.log`);
  try {
    const content = fs.readFileSync(file, 'utf8').trimEnd();
    // Bỏ mã màu ANSI của Nest cho dễ đọc trong báo cáo lỗi.
    const clean = content.replace(ANSI_COLOR, '');
    return `--- ${name}.log (${lines} dòng cuối) ---\n${clean.split(/\r?\n/).slice(-lines).join('\n')}`;
  } catch {
    return `--- ${name}.log: không đọc được (${file}) ---`;
  }
}

/** Chờ URL trả về HTTP < 500. Hết giờ/tiến trình chết sớm thì ném lỗi kèm phần cuối log để chẩn đoán. */
export async function waitHttp(url: string, timeoutMs: number, label: string, logName: string, child?: ChildProcess): Promise<void> {
  const t0 = Date.now();
  let lastErr = '';
  const diag = () => '\n' + tailLog(logName);
  while (Date.now() - t0 < timeoutMs) {
    if (child && child.exitCode !== null) throw new Error(`[E2E] ${label} thoát sớm (exit ${child.exitCode}), log: ${PATHS.logDir}${diag()}`);
    try {
      const res = await fetch(url);
      if (res.status < 500) return;
      lastErr = `HTTP ${res.status}`;
    } catch (e) {
      lastErr = String((e as Error).message);
    }
    await sleep(500);
  }
  throw new Error(`[E2E] ${label} không phản hồi sau ${timeoutMs}ms (${lastErr}), log: ${PATHS.logDir}${diag()}`);
}

/** Mở file log ghi đè và ghi dòng đầu (lệnh, cổng, thời điểm) để log không bao giờ rỗng khi chẩn đoán. */
function logStream(name: string, header: string): number {
  fs.mkdirSync(PATHS.logDir, { recursive: true });
  const fd = fs.openSync(path.join(PATHS.logDir, `${name}.log`), 'w');
  fs.writeSync(fd, `[E2E ${new Date().toISOString()}] ${header}\n`);
  return fd;
}

export function killTree(child: ChildProcess | undefined): void {
  if (!child || child.pid === undefined || child.exitCode !== null) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  else child.kill('SIGTERM');
}

/** Cổng 3100/5183 phải trống TRƯỚC khi làm bất kỳ thao tác nào: nếu bận, có thể một lần chạy khác đang giữ stack. */
export async function assertPortsFree(): Promise<void> {
  for (const [name, port] of [['backend', PORTS.backend], ['Admin', PORTS.admin]] as const) {
    if (await isPortBusy(port)) {
      throw new Error(`[E2E] Cổng ${port} (${name} E2E) đang bị chiếm, có thể do lần chạy trước bị dừng cứng hoặc lần chạy khác đang giữ stack. Tắt tiến trình đó rồi chạy lại.`);
    }
  }
}

export async function startBackend(mongoUri: string, onSpawn?: (c: ChildProcess) => void): Promise<ChildProcess> {
  assertIsolated({ mongoUri });
  if (await isPortBusy(PORTS.backend)) throw new Error(`[E2E] Cổng ${PORTS.backend} đang bị chiếm; không dựng được backend E2E`);
  ensureBackendBuilt(); // build RIÊNG vào .e2e-dist, không đụng dist dùng chung với backend dev
  fs.mkdirSync(PATHS.backendCwd, { recursive: true });
  const main = path.join(PATHS.backendDist, 'main.js');
  const out = logStream('backend', `spawn: node ${main} | cwd=${PATHS.backendCwd} | PORT=${PORTS.backend} | LOG_LEVEL=${backendEnv(mongoUri).LOG_LEVEL}`);
  const child = spawn(process.execPath, [main], {
    cwd: PATHS.backendCwd,
    env: backendEnv(mongoUri),
    stdio: ['ignore', out, out],
    windowsHide: true,
  });
  onSpawn?.(child);
  await waitHttp(`${URLS.api}/health/liveness`, 180_000, 'Backend', 'backend', child);
  return child;
}

export async function startAdmin(onSpawn?: (c: ChildProcess) => void): Promise<ChildProcess> {
  if (await isPortBusy(PORTS.admin)) throw new Error(`[E2E] Cổng ${PORTS.admin} đang bị chiếm; không dựng được Admin App E2E`);
  const vite = path.join(PATHS.adminDir, 'node_modules/vite/bin/vite.js');
  const out = logStream('admin', `spawn: node ${vite} --port ${PORTS.admin} --strictPort --host localhost | cwd=${PATHS.adminDir}`);
  const child = spawn(process.execPath, [vite, '--port', String(PORTS.admin), '--strictPort', '--host', 'localhost'], {
    cwd: PATHS.adminDir,
    env: adminEnv(),
    stdio: ['ignore', out, out],
    windowsHide: true,
  });
  onSpawn?.(child);
  await waitHttp(URLS.admin, 60_000, 'Admin App (Vite)', 'admin', child);
  return child;
}

/** Làm nóng Vite: yêu cầu trang và các module chính để lần biên dịch đầu không rơi vào test đầu tiên. */
export async function warmUp(): Promise<void> {
  const html = await (await fetch(`${URLS.admin}/login`)).text();
  const srcs = [...html.matchAll(/src="([^"]+)"/g)].map((m) => m[1]);
  for (const p of ['/src/main.tsx', '/src/App.tsx', '/src/screens/LoginScreen.tsx', ...srcs]) {
    await fetch(new URL(p, URLS.admin)).catch(() => undefined);
  }
}
