/**
 * Cấu hình stack E2E CÔ LẬP. Mọi giá trị ở đây chỉ dùng cho E2E (an toàn để commit, không phải secret thật).
 * Có thể ghi đè bằng biến môi trường `E2E_*` (xem `.env.e2e.example`).
 *
 * Cổng/DB/bucket cố định khác hẳn stack dev (3000/5173, DB `mongodb`, Redis db 0, bucket `crm-*`).
 * `assertIsolated()` chặn mọi thao tác ghi nếu cấu hình trỏ nhầm vào stack dev.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const env = process.env;

export const PATHS = {
  e2eDir: here,
  adminDir: path.resolve(here, '..'),
  backendDir: path.resolve(here, '../../RealEstateBackendApp'),
  /**
   * Thư mục build RIÊNG của backend E2E. Phải nằm trong `RealEstateBackendApp` để `node_modules` của backend được phân giải;
   * TUYỆT ĐỐI khác `dist` (dist dùng chung với backend dev cổng 3000, nest-cli.json có `deleteOutDir: true`).
   */
  backendDist: path.resolve(here, '../../RealEstateBackendApp/.e2e-dist'),
  /** Cấu hình build riêng (nest-cli.e2e.json + tsconfig.e2e.json): outDir = `backendDist`, không đụng nest-cli.json chung. */
  backendBuildDir: path.resolve(here, 'backend-build'),
  /** Khóa chạy đồng thời (thư mục nguyên tử, bên trong có owner.json ghi PID). Khác với `e2e.lock` mà agent/người dùng có thể tự `mkdir` bao ngoài. */
  runLockDir: path.resolve(here, '.runtime/e2e.run.lock'),
  /** Thư mục chạy tạm của backend: KHÔNG có `.env` nên dotenv/ConfigModule không nạp `.env` dev (key AI, Google...). */
  backendCwd: path.resolve(here, '.runtime/backend-cwd'),
  runtimeDir: path.resolve(here, '.runtime'),
  stateFile: path.resolve(here, '.runtime/state.json'),
  logDir: path.resolve(here, '.runtime/logs'),
};

/** Kiểu `number` (không `as const`) để `assertIsolated` so sánh với cổng dev 3000/5173 có nghĩa. */
export const PORTS: { backend: number; admin: number } = { backend: 3100, admin: 5183 };
export const URLS = {
  backend: `http://localhost:${PORTS.backend}`,
  api: `http://localhost:${PORTS.backend}/api/v1`,
  admin: `http://localhost:${PORTS.admin}`,
};

/** Tiền tố key Redis của backend E2E (REDIS_KEY_PREFIX). */
export const REDIS_KEY_PREFIX = 'e2e:';

export const REDIS: { host: string; port: number; db: number; readonly url: string } = {
  host: env.E2E_REDIS_HOST ?? '127.0.0.1',
  port: Number(env.E2E_REDIS_PORT ?? 6379),
  /** Cố định db 15 (không có biến ghi đè): db 0 là của dev. `assertIsolated` kiểm lại từ URL thật gửi cho backend. */
  db: 15,
  get url(): string {
    return `redis://${this.host}:${this.port}/${this.db}`;
  },
};

export const S3 = {
  endpoint: env.E2E_S3_ENDPOINT ?? 'http://127.0.0.1:9000',
  region: 'us-east-1',
  // MinIO dev dùng chung 1 tài khoản gốc (mặc định minioadmin/minioadmin, xem docker-compose.dev.yml);
  // E2E chỉ đụng bucket `e2e-*`. Ghi đè bằng E2E_S3_ACCESS_KEY_ID / E2E_S3_SECRET_ACCESS_KEY nếu MinIO của bạn khác.
  accessKeyId: env.E2E_S3_ACCESS_KEY_ID ?? 'minioadmin',
  secretAccessKey: env.E2E_S3_SECRET_ACCESS_KEY ?? 'minioadmin',
  bucketAttachments: 'e2e-attachments',
  bucketExports: 'e2e-exports',
};

/** Mật khẩu tài khoản seed. CỐ ĐỊNH có chủ ý, chỉ hợp lệ trong stack E2E (xem `assertIsolated`). */
export const TEST_PASSWORD = 'Test@12345678';

export const ACCOUNTS = {
  admin: { email: 'admin.e2e@example.test', displayName: 'Admin E2E', role: 'ADMIN' },
  mgr1: { email: 'mgr1.e2e@example.test', displayName: 'Quản lý Một', role: 'MANAGER', team: 1 },
  staff1: { email: 'staff1.e2e@example.test', displayName: 'Nhân viên Một', role: 'STAFF', team: 1 },
  staff2: { email: 'staff2.e2e@example.test', displayName: 'Nhân viên Hai', role: 'STAFF', team: 2 },
} as const;
export type RoleKey = keyof typeof ACCOUNTS;

/** Secret test: chỉ có giá trị trong stack E2E. KHÔNG dùng lại ở bất kỳ môi trường thật nào. */
const TEST_JWT_SECRET = 'e2e-only-jwt-secret-0123456789abcdef0123456789abcdef';
const TEST_COOKIE_SECRET = 'e2e-only-cookie-secret-0123456789abcdef';
/** 32 byte base64: khóa PII E2E (sinh cố định cho tái lập; dữ liệu nằm trong Mongo tạm nên vô hại). */
const TEST_PII_KEY = Buffer.from('e2e-only-pii-key-32-bytes-long!!').toString('base64');

/** Biến môi trường cho backend. Đặt HẾT mọi khóa nhạy cảm của dev về rỗng/tắt. */
export function backendEnv(mongoUri: string): NodeJS.ProcessEnv {
  return {
    ...pick(env, ['PATH', 'Path', 'SystemRoot', 'TEMP', 'TMP', 'USERPROFILE', 'HOME', 'APPDATA']),
    NODE_ENV: 'development',
    PORT: String(PORTS.backend),
    MONGODB_URI: mongoUri,
    FRONTEND_URL: URLS.admin,
    JWT_SECRET: TEST_JWT_SECRET,
    JWT_ACCESS_EXPIRES_IN: '8h',
    JWT_REFRESH_EXPIRES_IN: '1d',
    COOKIE_SECRET: TEST_COOKIE_SECRET,
    ADMIN_EMAIL: ACCOUNTS.admin.email,
    ADMIN_PASSWORD: TEST_PASSWORD,
    ADMIN_DISPLAY_NAME: ACCOUNTS.admin.displayName,
    FEATURE_CRM_ENABLED: 'true',
    FEATURE_CRM_ATTACHMENTS: 'true',
    CRM_PII_ENCRYPTION_KEY: TEST_PII_KEY,
    CRM_PII_KEY_VERSION: '1',
    // Nới throttle đăng nhập (mặc định 5/phút) để spec F1 đăng nhập thật nhiều lần; chỉ dành cho E2E.
    AUTH_LOGIN_THROTTLE_LIMIT: '1000',
    REDIS_URL: REDIS.url,
    REDIS_KEY_PREFIX,
    S3_ENDPOINT: S3.endpoint,
    S3_REGION: S3.region,
    S3_ACCESS_KEY_ID: S3.accessKeyId,
    S3_SECRET_ACCESS_KEY: S3.secretAccessKey,
    S3_FORCE_PATH_STYLE: 'true',
    S3_BUCKET_ATTACHMENTS: S3.bucketAttachments,
    S3_BUCKET_EXPORTS: S3.bucketExports,
    // Tắt crawler/AI/Google: không key thật, không gọi mạng ra ngoài.
    DAILY_CRAWLER_ACTIVE: 'false',
    ACTIVE_AI_PLATFORM: '',
    FIRECRAWL_API_KEY: '',
    OPENROUTER_API_KEY: '',
    MUST1C_API_KEY: '',
    NINEROUTER_API_KEY: '',
    GOOGLE_CLIENT_ID: '',
    GOOGLE_CLIENT_SECRET: '',
    GOOGLE_REDIRECT_URI: '',
    LOG_DIR: PATHS.logDir,
    // `info` để backend.log/app-*.log đủ thông tin chẩn đoán khi backend không lên (mức `warn` từng làm log rỗng).
    LOG_LEVEL: 'info',
  };
}

/** Biến môi trường cho Vite dev server (biến có sẵn trong process.env thắng `.env` của dự án). */
export function adminEnv(): NodeJS.ProcessEnv {
  return {
    ...pick(env, ['PATH', 'Path', 'SystemRoot', 'TEMP', 'TMP', 'USERPROFILE', 'HOME', 'APPDATA']),
    VITE_API_URL: URLS.api,
    VITE_CRM_ENABLED: 'true',
    VITE_FEATURE_CRM_ATTACHMENTS: 'true',
    // Vite dev mặc định bật dữ liệu mẫu cho Báo cáo, Nhập/Xuất: ép tắt để thấy hành vi thật (như production).
    VITE_CRM_MOCK_REPORTS: 'false',
    VITE_CRM_MOCK_IMPORT_EXPORT: 'false',
  };
}

function pick(src: NodeJS.ProcessEnv, keys: string[]): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const k of keys) if (src[k] !== undefined) out[k] = src[k];
  return out;
}

/** Cờ boolean từ biến môi trường: chỉ '1' hoặc 'true' (không phân biệt hoa thường) mới bật; '0', 'false', rỗng, không đặt đều tắt. */
export const isTruthyFlag = (value: string | undefined): boolean => ['1', 'true'].includes((value ?? '').trim().toLowerCase());

const LOOPBACK_HOSTS = ['127.0.0.1', 'localhost', '::1', '[::1]'];
const isLoopback = (host: string): boolean => LOOPBACK_HOSTS.includes(host);
/** Cổng của stack dev: tuyệt đối không được trùng với cổng E2E. */
const DEV_PORTS = { backend: 3000, admin: 5173 };

/**
 * Hàng rào an toàn: từ chối mọi thao tác phá hủy/ghi nếu cấu hình THẬT (đã qua biến `E2E_*` ghi đè) trỏ ra ngoài phạm vi E2E.
 * Mỗi kiểm tra đọc từ giá trị mà backend/ioredis/S3 client sẽ thực sự dùng (URL đã dựng, env đã dựng), không so hằng với hằng.
 *
 * - Mongo (chỉ khi truyền `mongoUri`): host loopback, cổng KHÁC 27017, DB `e2e`.
 * - Redis: host loopback, db đúng 15, key prefix `e2e:`; cho dùng chung server Redis dev nhưng port/db đọc lại từ URL.
 * - S3: endpoint loopback, mọi bucket có tiền tố `e2e-`.
 * - Cổng backend/Admin khác 3000/5173 và nhất quán giữa env backend, env Vite, URL cấu hình.
 * Gọi ở MỌI nơi có thao tác phá hủy (flush Redis, xóa bucket/object, teardown, seed).
 */
export function assertIsolated(opts: { mongoUri?: string } = {}): void {
  const fail = (why: string): never => {
    throw new Error(`[E2E] Từ chối chạy: ${why}. Thao tác phá hủy/seed chỉ được phép trên stack cô lập (xem e2e/env.ts).`);
  };
  const parse = (raw: string | undefined, label: string): URL => {
    try {
      return new URL(raw ?? '');
    } catch {
      return fail(`${label} không phải URL hợp lệ ("${raw}")`);
    }
  };
  const be = backendEnv(opts.mongoUri ?? '');

  // ── Mongo ──
  if (opts.mongoUri !== undefined) {
    const u = parse(opts.mongoUri, 'MONGODB_URI');
    if (u.protocol !== 'mongodb:') fail('MONGODB_URI phải là mongodb://');
    if (!isLoopback(u.hostname)) fail(`Mongo host "${u.hostname}" không phải máy cục bộ`);
    if (!u.port || u.port === '27017') fail('Mongo đang dùng cổng 27017 (cổng của stack dev)');
    if (u.pathname.replace('/', '') !== 'e2e') fail(`tên DB phải là "e2e", đang là "${u.pathname}"`);
    if (be.MONGODB_URI !== opts.mongoUri) fail('env backend không dùng đúng MONGODB_URI của Mongo tạm');
  }

  // ── Redis: đọc lại từ URL thật backend nhận (REDIS_URL), đối chiếu với tham số ioredis sẽ dùng ──
  if (!Number.isInteger(REDIS.port) || REDIS.port < 1 || REDIS.port > 65535) fail(`E2E_REDIS_PORT không hợp lệ ("${env.E2E_REDIS_PORT}")`);
  const ru = parse(be.REDIS_URL, 'REDIS_URL');
  if (ru.protocol !== 'redis:') fail('REDIS_URL phải là redis://');
  if (!isLoopback(ru.hostname)) fail(`Redis host "${ru.hostname}" không phải loopback`);
  const redisDb = ru.pathname.replace('/', '');
  if (!/^\d+$/.test(redisDb) || Number(redisDb) !== 15) fail(`Redis phải dùng db 15, URL đang là db "${redisDb}"`);
  if (ru.hostname !== REDIS.host || Number(ru.port) !== REDIS.port || Number(redisDb) !== REDIS.db) {
    fail('tham số Redis (host/port/db) không khớp URL gửi cho backend; kiểm tra E2E_REDIS_HOST/E2E_REDIS_PORT');
  }
  if (REDIS.db !== 15) fail('Redis phải là db 15');
  if (!String(be.REDIS_KEY_PREFIX).startsWith('e2e:')) fail('REDIS_KEY_PREFIX của backend phải bắt đầu bằng "e2e:"');

  // ── S3 / MinIO ──
  const su = parse(S3.endpoint, 'E2E_S3_ENDPOINT');
  if (!isLoopback(su.hostname)) fail(`S3 endpoint "${su.hostname}" không phải loopback`);
  if (be.S3_ENDPOINT !== S3.endpoint) fail('S3_ENDPOINT của backend không khớp cấu hình E2E');
  for (const [label, bucket] of [
    ['bucketAttachments', S3.bucketAttachments],
    ['bucketExports', S3.bucketExports],
    ['S3_BUCKET_ATTACHMENTS', be.S3_BUCKET_ATTACHMENTS],
    ['S3_BUCKET_EXPORTS', be.S3_BUCKET_EXPORTS],
  ] as const) {
    if (!String(bucket).startsWith('e2e-')) fail(`${label} ("${bucket}") phải bắt đầu bằng "e2e-"`);
  }

  // ── Cổng backend / Admin ──
  if (Number(be.PORT) !== PORTS.backend) fail(`PORT của backend (${be.PORT}) không khớp cổng E2E ${PORTS.backend}`);
  if (PORTS.backend === DEV_PORTS.backend || PORTS.backend === DEV_PORTS.admin) fail(`cổng backend E2E ${PORTS.backend} trùng cổng dev`);
  if (PORTS.admin === DEV_PORTS.admin || PORTS.admin === DEV_PORTS.backend) fail(`cổng Admin E2E ${PORTS.admin} trùng cổng dev`);
  if (Number(parse(be.FRONTEND_URL, 'FRONTEND_URL').port) !== PORTS.admin) fail('FRONTEND_URL của backend không trỏ cổng Admin E2E');
  if (Number(parse(adminEnv().VITE_API_URL, 'VITE_API_URL').port) !== PORTS.backend) fail('VITE_API_URL của Admin không trỏ cổng backend E2E');
}
