import { MongoClient } from 'mongodb';
import { sanitizeErrorMessage } from './migration-error.util';
import { EXIT_CODE, MigrationRunner } from './migration-runner';
import type { ExitCode } from './migration-runner';
import { PHASE_FILTERS } from './migration.types';
import type { Migration, MigrationActor, PhaseFilter } from './migration.types';

export const CLI_USAGE = `Cách dùng: node dist/migrations/cli.js <lệnh> [tùy chọn]

  status [--json]                      Chỉ đọc: version, đã áp dụng, đang chờ (kèm pha và số chờ post-up), khóa, lỗi gần nhất.
  up [--apply] [--by deploy|cli] [--phase pre-up|post-up|all]
                                       Mặc định dry-run. --apply mới chạy migration chờ (cần replica set).
                                       --phase chọn pha migration (mặc định all = mọi migration chờ). Chạy một pha mà
                                       còn migration pha kia chờ có số nhỏ hơn thì bị từ chối (mã 1).
  unlock                               Gỡ khóa còn sót (chỉ khi chắc chắn không có runner nào đang chạy).
  baseline [--apply] --version x.y.z [--commit sha]
                                       Chạy MỘT lần: ghi sổ 002..006 đã áp dụng + version. Mặc định dry-run.
  reconcile [--apply] [--by deploy|cli] [--skip-version] [--json] [--phase pre-up|post-up|all]
                                       Tự đối chiếu DB với phiên bản app: probe chỉ-đọc 002..006 rồi baseline (nếu cần),
                                       chạy migration chờ, ghi version. Mặc định dry-run; --skip-version không ghi version;
                                       --json in đúng MỘT dòng JSON ra stdout (log khác ra stderr).
                                       --phase chọn pha migration (mặc định all). Từ chối (mã 1) theo CẢ HAI chiều: chạy
                                       pre-up mà còn post-up chờ số nhỏ hơn (chạy --phase post-up trước), hoặc chạy post-up
                                       mà còn pre-up chờ số nhỏ hơn (chạy --phase pre-up trước).

Biến môi trường: MONGODB_URI (bắt buộc).
Mã thoát: 0 ok | 1 lỗi/từ chối | 2 sai cú pháp | 3 đang có khóa | 4 cần baseline/probe không đạt | 5 downgrade (app cũ hơn DB).`;

export interface CliDeps {
  /** Chuỗi kết nối Mongo (đã có database trong đường dẫn, như `MONGODB_URI` của backend). */
  mongoUri: string | undefined;
  migrations: readonly Migration[];
  app: { version: string; commit: string | null };
  out: (line: string) => void;
  err: (line: string) => void;
  /** Hạn chọn máy chủ Mongo (ms); mặc định 10 giây. Chỉ test cần rút ngắn. */
  serverSelectionTimeoutMs?: number;
}

interface ParsedArgs {
  command: string | undefined;
  apply: boolean;
  json: boolean;
  skipVersion: boolean;
  by: MigrationActor;
  phase: PhaseFilter;
  /** `true` nếu người dùng truyền `--phase` (để từ chối ở lệnh không hỗ trợ). */
  hasPhaseFlag: boolean;
  version: string | undefined;
  commit: string | undefined;
}

const VALUE_FLAGS = ['--by', '--version', '--commit', '--phase'] as const;
const BOOLEAN_FLAGS = [
  '--apply',
  '--json',
  '--skip-version',
  '--help',
] as const;

/** Phân tích argv; trả `string` (thông báo lỗi cú pháp) nếu không hợp lệ. */
const parseArgs = (argv: readonly string[]): ParsedArgs | string => {
  const parsed: ParsedArgs = {
    command: undefined,
    apply: false,
    json: false,
    skipVersion: false,
    by: 'cli',
    phase: 'all',
    hasPhaseFlag: false,
    version: undefined,
    commit: undefined,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) {
      if (parsed.command !== undefined) return `Tham số thừa: ${token}`;
      parsed.command = token;
    } else if ((BOOLEAN_FLAGS as readonly string[]).includes(token)) {
      if (token === '--apply') parsed.apply = true;
      if (token === '--json') parsed.json = true;
      if (token === '--skip-version') parsed.skipVersion = true;
      if (token === '--help') parsed.command = 'help';
    } else if ((VALUE_FLAGS as readonly string[]).includes(token)) {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('--')) {
        return `Thiếu giá trị cho ${token}`;
      }
      index += 1;
      if (token === '--version') parsed.version = value;
      if (token === '--commit') parsed.commit = value;
      if (token === '--phase') {
        if (!(PHASE_FILTERS as readonly string[]).includes(value)) {
          return '--phase chỉ nhận pre-up, post-up hoặc all';
        }
        parsed.phase = value as PhaseFilter;
        parsed.hasPhaseFlag = true;
      }
      if (token === '--by') {
        if (value !== 'deploy' && value !== 'cli') {
          return '--by chỉ nhận deploy hoặc cli';
        }
        parsed.by = value;
      }
    } else {
      return `Tùy chọn không hợp lệ: ${token}`;
    }
  }
  return parsed;
};

/** Gợi ý ngắn khi lỗi kết nối Mongo (KHÔNG chứa URI/mật khẩu). */
export const CONNECTION_HINT =
  'Gợi ý: kiểm tra (1) MongoDB đã chạy chưa; (2) MongoDB có chạy dạng replica set khớp tham số `replicaSet` ' +
  'trong MONGODB_URI không (Mongo đơn lẻ mà URI có `replicaSet=...` sẽ báo hết hạn chọn máy chủ); ' +
  '(3) thông tin xác thực trong MONGODB_URI có đúng không.';

/** Lỗi chọn máy chủ/mạng/xác thực của driver (code 18 = AuthenticationFailed). */
export const isConnectionError = (error: unknown): boolean => {
  if (!(error instanceof Error)) return false;
  if (
    [
      'MongoServerSelectionError',
      'MongoNetworkError',
      'MongoNetworkTimeoutError',
    ].includes(error.name)
  ) {
    return true;
  }
  return (error as { code?: unknown }).code === 18;
};

/**
 * Điểm vào logic CLI (tách khỏi `cli.ts` để test tích hợp gọi được mà không spawn tiến trình). Trả về mã thoát;
 * KHÔNG gọi `process.exit`. Lỗi bất ngờ (kết nối...) được lọc chuỗi kết nối trước khi in.
 */
export const runCli = async (
  argv: readonly string[],
  deps: CliDeps,
): Promise<ExitCode> => {
  const parsed = parseArgs(argv);
  if (typeof parsed === 'string') {
    deps.err(`${parsed}\n${CLI_USAGE}`);
    return EXIT_CODE.USAGE;
  }
  const commands = ['status', 'up', 'unlock', 'baseline', 'reconcile'];
  if (parsed.command === 'help') {
    deps.out(CLI_USAGE);
    return EXIT_CODE.OK;
  }
  if (!parsed.command || !commands.includes(parsed.command)) {
    deps.err(`Lệnh không hợp lệ hoặc thiếu.\n${CLI_USAGE}`);
    return EXIT_CODE.USAGE;
  }
  if (
    parsed.hasPhaseFlag &&
    parsed.command !== 'up' &&
    parsed.command !== 'reconcile'
  ) {
    deps.err(`--phase chỉ dùng với up hoặc reconcile.
${CLI_USAGE}`);
    return EXIT_CODE.USAGE;
  }
  if (!deps.mongoUri) {
    deps.err('Thiếu biến môi trường MONGODB_URI.');
    return EXIT_CODE.FAILURE;
  }

  const client = new MongoClient(deps.mongoUri, {
    serverSelectionTimeoutMS: deps.serverSelectionTimeoutMs ?? 10_000,
  });
  let connected = false;
  try {
    await client.connect();
    connected = true;
    const runner = new MigrationRunner({
      client,
      migrations: deps.migrations,
      app: deps.app,
      out: deps.out,
      err: deps.err,
    });
    switch (parsed.command) {
      case 'status':
        return await runner.status(parsed.json);
      case 'up':
        return await runner.up(parsed.apply, parsed.by, parsed.phase);
      case 'unlock':
        return await runner.unlock();
      case 'reconcile':
        return await runner.reconcile({
          apply: parsed.apply,
          by: parsed.by,
          skipVersion: parsed.skipVersion,
          json: parsed.json,
          phase: parsed.phase,
        });
      default:
        return await runner.baseline(
          parsed.apply,
          parsed.version,
          parsed.commit,
        );
    }
  } catch (error) {
    deps.err(`LỖI: ${sanitizeErrorMessage(error)}`);
    if (!connected || isConnectionError(error)) deps.err(CONNECTION_HINT);
    return EXIT_CODE.FAILURE;
  } finally {
    await client.close().catch(() => undefined);
  }
};
